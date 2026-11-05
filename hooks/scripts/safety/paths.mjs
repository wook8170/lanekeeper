// paths: protected paths (project.protected_paths) and the Lanekeeper state files that
// only hooks may write (owner grant, gate stamp, lane ledger).
import path from 'node:path'
import { ask, deny, globToRe, inside } from './common.mjs'
import { resolvePath } from './shell.mjs'
import { DIR, LEGACY_DIR } from '../../../lib/naming.mjs'

const READ_ONLY = new Set(['cat', 'less', 'more', 'head', 'tail', 'ls', 'stat', 'test', '[', 'jq', 'wc', 'file', 'grep', 'rg', 'diff', 'git', 'echo', 'printf', 'lanekeeper-config'])
const WRITERS = new Set(['cp', 'mv', 'tee', 'touch', 'ln', 'install', 'rsync', 'truncate', 'dd', 'sed', 'perl', 'chmod', 'rm', 'unlink'])

// A path is state when it lives under <git-common-dir>/lanekeeper/ (or the
// <git-common-dir>/wb/ used before 0.2.0).
export function isStatePath(p, stateDirs = []) {
  if (/\/\.git\/(lanekeeper|wb)(\/|$)/.test(p)) return true
  if (path.basename(p) === 'owner-grant.json') return true
  return stateDirs.some((d) => d && inside(p, d))
}

export function isProtectedPath(p, root, globs) {
  if (!globs?.length) return null
  const rel = root && inside(p, root) ? path.relative(root, p) : null
  for (const g of globs) {
    const re = globToRe(g.replace(/\/$/, '/**'), {})
    if ((rel !== null && (re.test(rel) || re.test(`${rel}/`))) || re.test(p)) return g
    // a folder glob protects everything below it
    if (rel !== null && !/[*?]/.test(g) && inside(path.join(root, rel), path.join(root, g))) return g
  }
  return null
}

// Write / Edit / MultiEdit / NotebookEdit
export function judgeFileTool(file, ctx) {
  if (!file) return null
  const p = path.isAbsolute(file) ? path.normalize(file) : path.resolve(ctx.cwd, file)
  if (isLanekeeperConfigFile(p, ctx)) return ask('paths.config', { path: file })
  if (isStatePath(p, ctx.stateDirs)) return deny('paths.state', { path: file })
  const hit = isProtectedPath(p, ctx.projectRoot, ctx.config.project?.protected_paths)
  if (hit) return deny('paths.protected', { path: file, glob: hit })
  return null
}

export function isLanekeeperConfigFile(p, ctx) {
  return (ctx.projectRoot && [DIR, LEGACY_DIR].some((d) => p === path.join(ctx.projectRoot, d, 'config.json'))) || (ctx.lanekeeperHome && inside(p, ctx.lanekeeperHome) && p.endsWith('.json'))
}

// Bash: state files may be read, never written; protected paths may not be
// redirected into or touched by file-writing commands.
export function judgeBashPaths(cmd, ctx) {
  const out = []
  const mentions = (t) => /owner-grant/.test(t) || /\.git\/(lanekeeper|wb)\//.test(t) || (ctx.stateDirs || []).some((d) => d && t.includes(d))
  for (const r of cmd.redirs) {
    if (!/>/.test(r.op) || !r.target || /^&?\d$/.test(r.target)) continue
    const p = resolvePath(cmd.cwd, r.target, ctx.home)
    if (mentions(r.target) || isStatePath(p, ctx.stateDirs)) out.push(deny('paths.state', { path: r.target }))
    const hit = isProtectedPath(p, ctx.projectRoot, ctx.config.project?.protected_paths)
    if (hit) out.push(deny('paths.protected', { path: r.target, glob: hit }))
  }
  const texts = cmd.words.map((w) => w.text)
  if (texts.some(mentions) && !READ_ONLY.has(cmd.name)) out.push(deny('paths.state', { path: texts.find(mentions) }))
  if (WRITERS.has(cmd.name) && (cmd.name !== 'sed' || texts.some((t) => /^-[a-zA-Z]*i/.test(t)))) {
    for (const t of texts.slice(1)) {
      if (t.startsWith('-')) continue
      const p = resolvePath(cmd.cwd, t, ctx.home)
      const hit = isProtectedPath(p, ctx.projectRoot, ctx.config.project?.protected_paths)
      if (hit) out.push(deny('paths.protected', { path: t, glob: hit }))
    }
  }
  return out
}
