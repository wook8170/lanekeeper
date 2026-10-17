// Real-world lookups for the guards (git, lsof, gh). Tests replace these.
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { procListeners } from '../../../lib/procs.mjs'

function run(bin, args, { cwd, env, timeout = 4000 } = {}) {
  try {
    return execFileSync(bin, args, {
      cwd,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
    }).trim()
  } catch {
    return null
  }
}

const gitIn = (t, args) => run('git', [...t.globalOpts, ...args], { cwd: t.cwd, env: t.env })

export const realGit = {
  info(t) {
    const out = gitIn(t, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'])
    if (!out) return null
    const [top, gitDir, common] = out.split('\n')
    const commonDir = path.resolve(t.cwd, common)
    const branch = gitIn(t, ['symbolic-ref', '-q', '--short', 'HEAD']) || null
    const head = gitIn(t, ['rev-parse', '-q', '--verify', 'HEAD']) || null
    return { top, gitDir, commonDir, stateDir: path.join(commonDir, 'wb'), branch, head, linked: path.resolve(gitDir) !== path.resolve(commonDir) }
  },
  revParse(t, ref) {
    return gitIn(t, ['rev-parse', '-q', '--verify', `${ref}^{commit}`]) || null
  },
  upstream(t) {
    return gitIn(t, ['rev-parse', '-q', '--abbrev-ref', '--symbolic-full-name', '@{u}']) || null
  },
  alias(t, name) {
    const v = gitIn(t, ['config', '--get', `alias.${name}`])
    return v === null ? undefined : v
  },
  // changed paths from..to, or null when `from` is not an ancestor of `to`
  changedSince(t, from, to) {
    if (gitIn(t, ['merge-base', '--is-ancestor', from, to]) === null) return null
    const out = gitIn(t, ['diff', '--name-only', from, to])
    return out === null ? null : out.split('\n').filter(Boolean)
  },
  isRev(t, name) {
    return !!gitIn(t, ['rev-parse', '-q', '--verify', `${name}^{commit}`]) || !!gitIn(t, ['rev-parse', '-q', '--verify', `refs/remotes/origin/${name}`])
  },
}

// Ports a PID listens on; without lsof they come from /proc (Linux); null when neither is available.
export function realListenPorts(pid) {
  const out = run('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'])
  // lsof exits 1 when the process has no matching socket
  if (out === null) {
    if (hasLsof()) return []
    return fs.existsSync('/proc/net/tcp') ? procListeners().get(Number(pid)) || [] : null
  }
  const ports = []
  for (const line of out.split('\n')) {
    const m = /^n.*:(\d+)$/.exec(line)
    if (m) ports.push(Number(m[1]))
  }
  return ports
}

function hasLsof() {
  try {
    execFileSync('sh', ['-c', 'command -v lsof'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// Base branch and head commit of the PR that `gh pr merge <args>` targets.
export function realPr(t, args) {
  const sel = args.find((a) => !a.startsWith('-'))
  const out = run('gh', ['pr', 'view', ...(sel ? [sel] : []), '--json', 'baseRefName,headRefOid'], { cwd: t.cwd, timeout: 8000 })
  if (!out) return null
  try {
    const j = JSON.parse(out)
    return { base: j.baseRefName, headOid: j.headRefOid }
  } catch {
    return null
  }
}
