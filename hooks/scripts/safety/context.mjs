// Real-world lookups for the guards (git, lsof, gh). Tests replace these.
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { procListeners } from '../../../lib/procs.mjs'
import { stateInfo } from '../../../lib/naming.mjs'
import { cleanRemoteUrl } from './grant.mjs'

function run(bin, args, { cwd, env, timeout = 4000 } = {}) {
  try {
    return execFileSync(bin, args, {
      cwd,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
      maxBuffer: 64 * 1024 * 1024,
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
    return { top, gitDir, commonDir, stateDir: stateInfo(commonDir).dir, branch, head, linked: path.resolve(gitDir) !== path.resolve(commonDir) }
  },
  // A repository before its first commit: HEAD points at a branch, no ref of any kind exists under
  // refs/, and this is the main checkout. False for a detached HEAD, a broken ref, an orphan branch,
  // a linked worktree and a failed lookup, which `rev-parse HEAD` alone cannot tell apart from this.
  unborn(t) {
    const ref = gitIn(t, ['symbolic-ref', '-q', 'HEAD'])
    if (!ref?.startsWith('refs/heads/') || gitIn(t, ['for-each-ref', '--count=1', '--format=%(refname)']) !== '') return false
    const out = gitIn(t, ['rev-parse', '--absolute-git-dir', '--git-common-dir'])
    if (!out) return false
    const [gitDir, common] = out.split('\n')
    return fs.realpathSync(gitDir) === fs.realpathSync(path.resolve(t.cwd, common))
  },
  // The tree the staged content would become. Null when it has none, as during a conflict.
  writeTree(t) {
    return gitIn(t, ['write-tree']) || null
  },
  subject(t, sha) {
    return gitIn(t, ['log', '-1', '--format=%s', sha])
  },
  // Staged paths, each as `<status> <path>`. Null when the lookup failed.
  staged(t) {
    const out = gitIn(t, ['-c', 'core.quotepath=off', 'diff', '--cached', '--name-status', '--no-renames'])
    return out === null ? null : out.split('\n').filter(Boolean).map((l) => l.replace('\t', ' '))
  },
  configGet(t, key) {
    return (gitIn(t, ['config', '--get-all', key]) || '').split('\n').filter(Boolean)
  },
  // The value git would read for a true-or-false setting, 'true' for a key with no value too -> 'true'|'false'|null.
  configBool(t, key) {
    return gitIn(t, ['config', '--type=bool', '--get', key]) || null
  },
  // The remote `git push` uses for this branch when none is named.
  defaultRemote(t, branch) {
    const keys = [...(branch ? [`branch.${branch}.pushRemote`] : []), 'remote.pushDefault', ...(branch ? [`branch.${branch}.remote`] : [])]
    for (const k of keys) {
      const v = realGit.configGet(t, k)
      if (v.length) return v.at(-1)
    }
    return 'origin'
  },
  isRemote(t, name) {
    return gitIn(t, ['remote', 'get-url', name]) !== null
  },
  // Where a push to this remote name or address goes, with credentials removed. A remote can have
  // several push addresses, and a pushed address can be rewritten by url.*.insteadOf.
  pushAddress(t, remote) {
    const out = gitIn(t, ['remote', 'get-url', '--push', '--all', remote]) ?? gitIn(t, ['ls-remote', '--get-url', remote])
    return out ? out.split('\n').map(cleanRemoteUrl).join(' ') : null
  },
  // The repositories this folder is a copy of, as host/owner/name.
  remoteAddresses(t) {
    const lines = (gitIn(t, ['remote', '-v']) || '').split('\n').filter(Boolean)
    return [...new Set(lines.map((l) => cleanRemoteUrl(l.split(/\s+/)[1]).replace('/~/', '/')))]
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

// What gh says about one PR: the selector and repository a merge names, as read by the caller.
export function realPr(t, { selector, repo } = {}) {
  const out = run('gh', ['pr', 'view', ...(selector ? [selector] : []), ...(repo ? ['--repo', repo] : []), '--json', 'baseRefName,headRefOid,number,url,title'], { cwd: t.cwd, env: t.env, timeout: 8000 })
  if (!out) return null
  try {
    const j = JSON.parse(out)
    return { base: j.baseRefName, headOid: j.headRefOid, number: j.number, url: j.url, title: j.title }
  } catch {
    return null
  }
}
