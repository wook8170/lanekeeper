// Resume report: progress.md newest section, git state, lane ledger and a list
// of stale items to report before new work starts.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { excerpt, isStale } from './handoff.mjs'
import { readWaves, readDispatch, PENDING_TTL_MS } from './waves.mjs'
import { readLanes } from './ledger.mjs'

const git = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}
const lines = (s) => (s ? s.split('\n').filter(Boolean) : [])

// Verdict of one lane for resuming: done | live | review | dead | pending | blocked | failed | recent
export function laneVerdict(l, { agentLive, now, staleMin }) {
  if (l.status === 'done') return 'done'
  if (agentLive) return 'live'
  if (l.status === 'review') return 'review'
  if (l.status === 'running') return (now - Date.parse(l.updated)) / 60000 >= staleMin ? 'dead' : 'recent'
  return l.status
}

export function buildResume({ cwd, state, progressFile = 'progress.md', staleMin = 20, now = Date.now() }) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']) || cwd
  const out = { cwd: top, progress: null, git: null, lanes: [], stale: [], next: [] }

  const pf = path.join(top, progressFile)
  if (fs.existsSync(pf)) {
    out.progress = { file: progressFile, excerpt: excerpt(fs.readFileSync(pf, 'utf8')), mtime: fs.statSync(pf).mtime.toISOString() }
    if (isStale(top, progressFile)) out.stale.push({ code: 'progress_stale', vars: { file: progressFile } })
  } else out.stale.push({ code: 'progress_missing', vars: { file: progressFile } })

  const wt = []
  let cur
  for (const l of lines(git(top, ['worktree', 'list', '--porcelain']))) {
    if (l.startsWith('worktree ')) wt.push((cur = { path: l.slice(9) }))
    else if (l.startsWith('branch ')) cur.branch = l.slice(7).replace(/^refs\/heads\//, '')
  }
  out.git = {
    branch: git(top, ['symbolic-ref', '-q', '--short', 'HEAD']),
    status: lines(git(top, ['status', '--short'])),
    worktrees: wt,
    log: lines(git(top, ['log', '-5', '--format=%h %ct %s'])).map((x) => {
      const [h, ct, ...s] = x.split(' ')
      return { hash: h, at: new Date(Number(ct) * 1000).toISOString(), subject: s.join(' ') }
    }),
  }

  if (!state) return out
  const registry = readLanes(state).lanes
  const dispatch = readDispatch(state)
  const active = Object.values(dispatch.active || {})
  for (const w of readWaves(state).waves) {
    for (const l of w.lanes) {
      const reg = registry.find((r) => r.id === l.lane)
      const verdict = laneVerdict(l, { agentLive: active.some((a) => a.lane === l.lane), now, staleMin })
      const wtOk = reg?.worktree ? fs.existsSync(reg.worktree) : null
      const dirty = wtOk ? lines(git(reg.worktree, ['status', '--porcelain'])).length : null
      const last = wtOk ? lines(git(reg.worktree, ['log', '-1', '--format=%h %s']))[0] || null : null
      out.lanes.push({ wave: w.id, lane: l.lane, status: l.status, verdict, model: l.model, brief: l.brief, rounds: l.rounds, returns: l.returns, remaining: l.todos.filter((t) => !t.done).map((t) => t.text), worktree: reg?.worktree || null, worktree_exists: wtOk, dirty, last_commit: last })
      if (verdict === 'dead') out.stale.push({ code: 'lane_dead', vars: { lane: l.lane, min: Math.round((now - Date.parse(l.updated)) / 60000) } })
      if (verdict !== 'done' && reg?.worktree && !wtOk) out.stale.push({ code: 'worktree_missing', vars: { lane: l.lane, path: reg.worktree } })
      if (dirty) out.stale.push({ code: 'lane_dirty', vars: { lane: l.lane, count: dirty } })
      if (verdict === 'dead' || verdict === 'pending' || verdict === 'review' || verdict === 'failed' || verdict === 'blocked') out.next.push({ action: verdict === 'review' ? 'review' : 'redispatch', wave: w.id, lane: l.lane, verdict })
    }
  }
  const known = new Set(registry.map((r) => path.resolve(r.worktree || '')))
  for (const r of registry) {
    if (r.worktree && !fs.existsSync(r.worktree) && !out.lanes.some((x) => x.lane === r.id)) out.stale.push({ code: 'worktree_missing', vars: { lane: r.id, path: r.worktree } })
  }
  const mainPath = out.git.worktrees[0]?.path
  for (const w of wt) if (w.path !== mainPath && !known.has(path.resolve(w.path))) out.stale.push({ code: 'worktree_unregistered', vars: { path: w.path, branch: w.branch || '-' } })
  for (const p of dispatch.pending || []) if (now - Date.parse(p.at) >= PENDING_TTL_MS) out.stale.push({ code: 'dispatch_orphan', vars: { type: p.agent_type, lane: p.lane || '-' } })
  for (const [id, a] of Object.entries(dispatch.active || {})) if ((now - Date.parse(a.started)) / 60000 >= staleMin * 3) out.stale.push({ code: 'agent_stuck', vars: { id, lane: a.lane || '-', min: Math.round((now - Date.parse(a.started)) / 60000) } })
  return out
}

// Text a controller can hand to a new agent for a lane that has to run again.
export function resumePrompt(rec, t) {
  const rem = rec.remaining.length ? rec.remaining.map((x) => `- ${x}`).join('\n') : t('resume.no_todo')
  return [
    t('resume.prompt.head', { lane: rec.lane, wave: rec.wave }),
    rec.brief ? t('resume.prompt.brief', { brief: rec.brief }) : t('resume.prompt.nobrief'),
    rec.worktree ? t('resume.prompt.worktree', { path: rec.worktree, last: rec.last_commit || '-' }) : '',
    t('resume.prompt.todo'),
    rem,
    t('resume.prompt.rule'),
  ].filter(Boolean).join('\n')
}
