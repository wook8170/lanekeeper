// Progress board: wave and lane table, one-line status line, per-lane metrics.
import fs from 'node:fs'
import { readWaves, readMetrics, readDispatch } from './waves.mjs'
import { readLanes } from './ledger.mjs'

export const ago = (iso, now = Date.now()) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h${m % 60}m` : `${Math.floor(m / 1440)}d`
}
const kfmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
export const tokenTotal = (tk) => (tk.input || 0) + (tk.output || 0) + (tk.cache_read || 0) + (tk.cache_creation || 0)

// Rows for the board: ledger lane + lanes.json (worktree) + live agent + metrics.
export function boardRows(sd, now = Date.now()) {
  const waves = readWaves(sd).waves
  let registry = []
  try {
    registry = readLanes(sd).lanes
  } catch {}
  const active = Object.values(readDispatch(sd).active || {})
  const metrics = readMetrics(sd)
  const rows = []
  for (const w of waves) {
    for (const l of w.lanes) {
      const reg = registry.find((r) => r.id === l.lane)
      rows.push({
        wave: w.id,
        lane: l.lane,
        status: l.status,
        task: l.task,
        model: l.model,
        rounds: l.rounds,
        returns: l.returns,
        todos: { done: l.todos.filter((t) => t.done).length, total: l.todos.length },
        verify: { pass: l.verifications.filter((v) => v.result === 'pass').length, fail: l.verifications.filter((v) => v.result === 'fail').length },
        tokens: tokenTotal(l.tokens),
        updated: l.updated,
        idle_min: Math.round((now - Date.parse(l.updated)) / 60000),
        agent_live: active.some((a) => a.lane === l.lane),
        worktree: reg?.worktree || null,
        worktree_exists: reg?.worktree ? fs.existsSync(reg.worktree) : null,
        runs: metrics.filter((m) => m.event === 'stop' && m.lane === l.lane).length,
      })
    }
  }
  return rows
}

export function renderBoard(rows, t, now = Date.now()) {
  if (!rows.length) return t('board.empty')
  const head = ['wave/lane', t('board.col.status'), t('board.col.model'), t('board.col.task'), t('board.col.rounds'), t('board.col.todo'), t('board.col.verify'), t('board.col.tokens'), t('board.col.idle')]
  const body = rows.map((r) => [
    `${r.wave}/${r.lane}`,
    `${t(`board.status.${r.status}`)}${r.agent_live ? '*' : ''}`,
    r.model || '-',
    r.task || '-',
    `${r.rounds}/${r.returns}`,
    `${r.todos.done}/${r.todos.total}`,
    `${r.verify.pass}/${r.verify.fail}`,
    kfmt(r.tokens),
    ago(r.updated, now),
  ])
  const width = head.map((h, i) => Math.max(...[h, ...body.map((b) => b[i])].map((s) => [...String(s)].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0))))
  const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - [...String(s)].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)))
  const line = (cells) => cells.map((c, i) => pad(c, width[i])).join('  ').trimEnd()
  const counts = {}
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1
  const summary = Object.entries(counts).map(([k, v]) => `${t(`board.status.${k}`)} ${v}`).join(' · ')
  return [line(head), ...body.map(line), '', `${summary}  (${t('board.legend')})`].join('\n')
}

// One line for subagentStatusLine.
export function statusLine(rows, t, max = 3) {
  if (!rows.length) return t('board.statusline.none')
  const open = rows.filter((r) => r.status !== 'done')
  const live = rows.filter((r) => r.agent_live).length
  const parts = open.slice(0, 4).map((r) => `${r.lane}:${t(`board.status.${r.status}`)}`)
  return `lanekeeper ${live}/${max} ${t('board.statusline.live')} · ${parts.join(' ')}${open.length > 4 ? ` +${open.length - 4}` : ''}${open.length ? '' : ` ${t('board.statusline.alldone')}`}`
}
