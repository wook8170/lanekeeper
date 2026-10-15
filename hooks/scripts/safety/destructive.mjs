// destructive: recursive rm aimed at broad targets.
//   deny  /, the home directory, top-level system folders, the project root or
//         one of its parents, a .git directory
//   ask   targets outside the project root (temp folders excepted), targets
//         that hold a variable, relative targets after an unknown cd
//   allow targets inside the project root or inside a temp folder
import os from 'node:os'
import path from 'node:path'
import { allow, ask, deny, inside, realish } from './common.mjs'
import { resolvePath } from './shell.mjs'

function isRecursive(args) {
  for (const a of args) {
    const t = a.text
    if (t === '--') break
    if (t === '--recursive' || t === '-r' || t === '-R') return true
    if (/^-[A-Za-z]+$/.test(t) && /[rR]/.test(t)) return true
  }
  return false
}

export function tempRoots(env = process.env) {
  const roots = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders', os.tmpdir()]
  if (env.TMPDIR) roots.push(env.TMPDIR)
  return [...new Set(roots.map((r) => r.replace(/\/+$/, '')))]
}

export function judgeRm(cmd, ctx) {
  if (cmd.name !== 'rm' || !isRecursive(cmd.args)) return null
  const targets = []
  let afterDashes = false
  for (const a of cmd.args) {
    if (!afterDashes && a.text === '--') {
      afterDashes = true
      continue
    }
    if (!afterDashes && a.text.startsWith('-')) continue
    targets.push(a)
  }
  const out = []
  for (const a of targets) out.push(judgeTarget(a, cmd, ctx))
  return out
}

function judgeTarget(a, cmd, ctx) {
  let t = a.text
  const home = ctx.home
  if (a.dynamic && !/^\$\{?HOME\}?(\/|$)/.test(t)) return ask('rm.dynamic', { target: t })
  const relative = !(t.startsWith('/') || t.startsWith('~') || /^\$\{?HOME/.test(t))
  if (relative && !cmd.cwdKnown) return ask('rm.dynamic', { target: t })
  // a glob in the last segment removes everything in its folder
  let p = resolvePath(cmd.cwd, t, home)
  if (/[*?[]/.test(path.basename(p))) p = path.dirname(p)
  if (/[*?[]/.test(p)) return ask('rm.dynamic', { target: t })
  const real = realish(p)
  const root = ctx.projectRoot ? realish(ctx.projectRoot) : null
  const homeReal = home ? realish(home) : null
  const depth = real.split('/').filter(Boolean).length
  const temps = tempRoots(ctx.env).map(realish)
  const inTemp = temps.some((r) => inside(real, r) && real !== r)
  if (real === '/' || (homeReal && inside(homeReal, real))) return deny('rm.broad', { target: t })
  if (root && inside(root, real)) return deny('rm.broad', { target: t })
  if (/(^|\/)\.git(\/|$)/.test(real)) return deny('rm.git', { target: t })
  if (inTemp) return allow()
  if (depth <= 2 && !(root && inside(real, root))) return deny('rm.broad', { target: t })
  if (root && inside(real, root)) return allow()
  return ask('rm.outside', { target: t })
}
