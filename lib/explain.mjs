// /wb:explain support: what is blocked or waiting right now, why, and what to do.
// Reads state only; changes nothing.
import fs from 'node:fs'
import { buildResume } from './resume.mjs'
import { readLanes } from './ledger.mjs'
import { readLimits } from './limits.mjs'
import { limitsFile } from './runtime.mjs'
import { slotSettings, status as slotStatus } from './slots.mjs'
import { expandHome, getPath } from './config.mjs'
import { globToRe } from './style.mjs'
import { hhmm } from './route.mjs'
import { gateLocked } from '../hooks/scripts/safety/grant.mjs'
import { handoffSettings } from './handoff.mjs'

// Item levels: block (nothing moves until fixed), wait (clears by itself or needs a decision), note.
export function collect({ cwd, root, resolved, state, env = process.env, now = Date.now(), staleMin }) {
  const items = []
  const add = (id, level, vars = {}, rule = null) => items.push({ id, level, vars, rule })
  const cfg = resolved.config

  if (resolved.errors.length) {
    const e = resolved.errors[0]
    add('config_broken', 'block', { file: e.file, key: e.path, count: resolved.errors.length }, 'safety-fails-closed')
  }

  const lim = readLimits(limitsFile(resolved, env))
  for (const [model, v] of Object.entries(lim.models)) {
    if (Date.parse(v.until) > now) add(model === '*' ? 'limit_all' : 'limit', 'wait', { model, until: hhmm(v.until), scope: v.scope }, 'model-routing')
  }

  if (state && gateLocked(state)) add('gate_lock', 'wait', {}, 'gate-lock')

  const hs = handoffSettings(getPath(cfg, 'personal.handoff') || {})
  const report = buildResume({ cwd, state, progressFile: hs.file, maxLines: hs.maxLines, archiveDir: hs.archiveDir, staleMin: staleMin ?? getPath(cfg, 'project.waves.stale_min') ?? 20, now })
  for (const l of report.lanes) {
    if (l.verdict === 'dead') add('lane_dead', 'block', { lane: l.lane, min: report.stale.find((x) => x.code === 'lane_dead' && x.vars.lane === l.lane)?.vars.min ?? 0 })
    else if (l.verdict === 'blocked') add('lane_blocked', 'block', { lane: l.lane })
    else if (l.verdict === 'failed') add('lane_failed', 'block', { lane: l.lane })
    else if (l.verdict === 'review') add('lane_review', 'wait', { lane: l.lane })
  }
  for (const s of report.stale) {
    if (s.code === 'progress_stale' || s.code === 'progress_missing' || s.code === 'progress_oversize') add(s.code, 'note', s.vars, 'progress-handoff')
    else if (s.code === 'lane_dirty' || s.code === 'worktree_missing' || s.code === 'worktree_unregistered') add(s.code, 'note', s.vars, 'worktree-cleanup')
  }

  const cap = getPath(cfg, 'machine.lanes.max') ?? 3
  const live = state ? readLanes(state).lanes.filter((r) => r.worktree && fs.existsSync(r.worktree)).length : 0
  if (live >= cap) add('lanes_full', 'wait', { count: live, max: cap }, 'lane-cap')

  try {
    const settings = slotSettings(resolved, (p) => expandHome(p, env.HOME))
    for (const k of slotStatus(settings)) {
      const busy = k.held.filter((h) => !h.stale).length
      if (k.count > 0 && busy >= k.count) add('slots_busy', 'wait', { kind: k.kind, count: busy }, 'heavy-runs-in-slots')
    }
  } catch {}

  const prot = getPath(cfg, 'project.git.protected_branches') || []
  const branch = report.git?.branch
  if (branch && prot.some((g) => globToRe(g).test(branch))) add('on_protected', 'note', { branch }, 'protected-branch-owner-grant')

  return { items, branch: branch || null, lanes: report.lanes.length }
}

// Plain-language lines for one item: what, why, fix.
export function itemLines(it, t) {
  const lines = [`${t(`xp.level.${it.level}`)} ${t(`xp.${it.id}.what`, it.vars)}`]
  lines.push(`  ${t('rules.why')}: ${t(`xp.${it.id}.why`, it.vars)}`)
  lines.push(`  ${t('xp.fix')}: ${t(`xp.${it.id}.fix`, it.vars)}`)
  if (it.rule) lines.push(`  ${t('xp.rule', { id: it.rule })}`)
  return lines
}

export function summary(items, t) {
  const n = (l) => items.filter((i) => i.level === l).length
  if (!items.length) return t('xp.clear')
  return t('xp.summary', { block: n('block'), wait: n('wait'), note: n('note') })
}
