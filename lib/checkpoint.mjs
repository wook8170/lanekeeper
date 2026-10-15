// Checkpoint: a work-in-progress commit on a lane branch, so that a limit, a
// compaction or a finished subagent never leaves uncommitted work behind.
// Only lane branches are touched. Protected and other branches, merges in
// progress and repositories without changes are skipped. Nothing is pushed.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { matchAny } from '../hooks/scripts/safety/common.mjs'
import { getPath, stateDir } from './config.mjs'
import { readJson } from './runtime.mjs'

const run = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const tryRun = (cwd, args) => {
  try {
    return run(cwd, args)
  } catch {
    return null
  }
}

export function checkpointDir(cwd, resolved, event, now = new Date()) {
  const branch = tryRun(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'])
  if (!branch) return { skipped: 'detached' }
  const git = getPath(resolved.config, 'project.git') || {}
  if (matchAny(branch, git.protected_branches || [], { wide: true })) return { skipped: 'protected', branch }
  if (!matchAny(branch, [git.lane_branch_pattern || 'wb/*/l*'])) return { skipped: 'not-lane', branch }
  const gitDir = path.resolve(cwd, tryRun(cwd, ['rev-parse', '--git-dir']) || '.git')
  for (const f of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD']) if (fs.existsSync(path.join(gitDir, f))) return { skipped: 'in-progress', branch }
  if (!(tryRun(cwd, ['status', '--porcelain']) || '')) return { skipped: 'clean', branch }
  run(cwd, ['add', '-A'])
  run(cwd, ['commit', '-q', '--no-verify', '-m', `wip(wb): checkpoint at ${event} ${now.toISOString()}`])
  return { committed: true, branch, head: run(cwd, ['rev-parse', '--short', 'HEAD']) }
}

// Directories to checkpoint: the hook's cwd, plus the worktree of the lane
// whose agent id stopped (from lanes.json), when it differs.
export function checkpointTargets(input, root) {
  const dirs = new Set([input.cwd || root])
  const sd = stateDir(root)
  const lanes = (sd && readJson(path.join(sd, 'lanes.json'))?.lanes) || []
  for (const l of lanes) if (input.agent_id && l.agent_id === input.agent_id && l.worktree && fs.existsSync(l.worktree)) dirs.add(l.worktree)
  return [...dirs]
}
