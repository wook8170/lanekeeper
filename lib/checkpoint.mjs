// Checkpoint: a work-in-progress commit (tracked files only) on a lane branch, so that a limit, a
// compaction or a finished subagent never leaves uncommitted work behind.
// Only lane branches are touched. Protected and other branches, merges in
// progress and repositories without changes are skipped. Nothing is pushed.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { matchAny } from '../hooks/scripts/safety/common.mjs'
import { getPath, stateDir } from './config.mjs'
import { readJson, notify } from './runtime.mjs'

const run = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const tryRun = (cwd, args) => {
  try {
    return run(cwd, args)
  } catch {
    return null
  }
}

// Files never committed by a checkpoint, even when tracked.
const SECRET_RE = [/^\.env/, /\.pem$/, /\.key$/, /^id_/, /credentials/i, /\.p12$/]
export const isSecretPath = (p) => SECRET_RE.some((re) => re.test(path.basename(p)))

// Commit tracked changes only (git add -u semantics via a pathspec commit), never
// untracked files or secret-looking files; project hooks run (no --no-verify).
// What was left out is recorded in <stateDir>/checkpoint.json and notified.
export function checkpointDir(cwd, resolved, event, now = new Date(), { env = process.env, notifyFn = notify } = {}) {
  const branch = tryRun(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'])
  if (!branch) return { skipped: 'detached' }
  const git = getPath(resolved.config, 'project.git') || {}
  if (matchAny(branch, git.protected_branches || [], { wide: true })) return { skipped: 'protected', branch }
  if (!matchAny(branch, [git.lane_branch_pattern || 'wb/*/l*'])) return { skipped: 'not-lane', branch }
  const gitDir = path.resolve(cwd, tryRun(cwd, ['rev-parse', '--git-dir']) || '.git')
  for (const f of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD']) if (fs.existsSync(path.join(gitDir, f))) return { skipped: 'in-progress', branch }
  const status = (tryRun(cwd, ['status', '--porcelain']) || '').split('\n').filter(Boolean)
  if (!status.length) return { skipped: 'clean', branch }
  const untracked = status.filter((l) => l.startsWith('??')).map((l) => l.slice(3))
  const changed = (tryRun(cwd, ['diff', '--name-only', 'HEAD']) || '').split('\n').filter(Boolean)
  const secrets = changed.filter(isSecretPath)
  const files = changed.filter((f) => !isSecretPath(f))
  const result = { branch, untracked, secrets }
  if (files.length) {
    try {
      run(cwd, ['commit', '-q', '-m', `wip(wb): checkpoint at ${event} ${now.toISOString()}`, '--', ...files])
      result.committed = true
      result.head = run(cwd, ['rev-parse', '--short', 'HEAD'])
    } catch (e) {
      result.skipped = 'commit-failed'
      result.reason = String(e.stderr || e.message || e).slice(0, 500)
    }
  } else result.skipped = 'nothing-tracked'
  if (untracked.length || secrets.length || result.skipped === 'commit-failed') {
    const sd = stateDir(cwd)
    if (sd) {
      fs.mkdirSync(sd, { recursive: true })
      fs.writeFileSync(path.join(sd, 'checkpoint.json'), JSON.stringify({ at: now.toISOString(), event, branch, untracked: untracked.slice(0, 50), untracked_count: untracked.length, secrets_skipped: secrets, skipped: result.skipped || null, reason: result.reason || null }, null, 2) + '\n')
    }
    const parts = []
    if (untracked.length) parts.push(`${untracked.length} untracked file(s) not committed`)
    if (secrets.length) parts.push(`secret-like file(s) excluded: ${secrets.join(', ')}`)
    if (result.skipped === 'commit-failed') parts.push('commit failed (project hook?); checkpoint skipped')
    notifyFn('wb checkpoint', parts.join('; '), { env })
  }
  return result
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
