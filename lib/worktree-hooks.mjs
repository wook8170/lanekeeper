// Opt-in registration of the WorktreeCreate / WorktreeRemove hooks.
//
// A WorktreeCreate hook replaces Claude Code's own worktree creation
// (claude --worktree, EnterWorktree, subagents with isolation: worktree,
// background sessions), and a registered hook cannot hand the work back to
// the default. So wb does not list these hooks in its plugin hooks.json.
// When project.worktree.hook is true, they are written to the main
// checkout's .claude/settings.local.json (machine-local, not committed),
// pointing at the current plugin root. The plugin's SessionStart hook calls
// syncWorktreeHooks on every session start, which re-points the command after
// a plugin update (the plugin root moves with each version) and removes the
// entries when the setting is turned off.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const MARK = /\/bin\/wb-worktree"? hook-(create|remove)\b/

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

// <main checkout>/.claude/settings.local.json, or null outside git.
export function settingsFile(projectDir) {
  const top = git(projectDir, ['rev-parse', '--show-toplevel'])
  if (!top) return null
  const common = path.resolve(top, git(top, ['rev-parse', '--git-common-dir']))
  const main = path.basename(common) === '.git' ? path.dirname(common) : top
  return path.join(main, '.claude', 'settings.local.json')
}

export function hookCommand(pluginRoot, which) {
  return `"${path.join(pluginRoot, 'bin', 'wb-worktree')}" hook-${which}`
}

function wanted(pluginRoot) {
  return {
    WorktreeCreate: [{ hooks: [{ type: 'command', command: hookCommand(pluginRoot, 'create'), timeout: 600 }] }],
    WorktreeRemove: [{ hooks: [{ type: 'command', command: hookCommand(pluginRoot, 'remove'), timeout: 120 }] }],
  }
}

// Entries of one event with wb's own handlers taken out (others are kept).
function strip(list) {
  const out = []
  for (const entry of Array.isArray(list) ? list : []) {
    const hooks = (entry.hooks || []).filter((h) => !MARK.test(String(h.command || '')))
    if (hooks.length) out.push({ ...entry, hooks })
  }
  return out
}

// Current state: 'on' (wb entries point at pluginRoot), 'stale' (wb entries
// point elsewhere), 'off', plus another tool's WorktreeCreate hook if present.
export function status(projectDir, pluginRoot) {
  const file = settingsFile(projectDir)
  if (!file) return { file: null, state: 'off', foreign: false }
  let data = {}
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') return { file, state: 'unreadable', error: e.message }
  }
  const cmds = ['WorktreeCreate', 'WorktreeRemove'].flatMap((ev) => (data.hooks?.[ev] || []).flatMap((e) => (e.hooks || []).map((h) => String(h.command || ''))))
  const mine = cmds.filter((c) => MARK.test(c))
  const foreign = strip(data.hooks?.WorktreeCreate).length > 0
  const want = Object.values(wanted(pluginRoot)).map((l) => l[0].hooks[0].command)
  const state = mine.length === 0 ? 'off' : want.every((c) => mine.includes(c)) && mine.length === want.length ? 'on' : 'stale'
  return { file, state, foreign }
}

// Make settings.local.json match `enabled`. Writes only when something changes.
// Returns { file, changed, state, foreign }.
export function syncWorktreeHooks(projectDir, pluginRoot, enabled) {
  const file = settingsFile(projectDir)
  if (!file) return { file: null, changed: false, state: 'off', foreign: false }
  let data = {}
  let raw = null
  try {
    raw = fs.readFileSync(file, 'utf8')
    data = JSON.parse(raw)
  } catch (e) {
    if (e.code !== 'ENOENT') return { file, changed: false, state: 'unreadable', error: e.message }
  }
  const hooks = { ...(data.hooks || {}) }
  const foreign = strip(hooks.WorktreeCreate).length > 0
  // two WorktreeCreate hooks would each create a worktree; leave the other tool's in charge
  if (enabled && foreign) return { file, changed: false, state: 'conflict', foreign }
  const add = wanted(pluginRoot)
  for (const ev of Object.keys(add)) {
    const kept = strip(hooks[ev])
    const next = enabled ? [...kept, ...add[ev]] : kept
    if (next.length) hooks[ev] = next
    else delete hooks[ev]
  }
  const out = { ...data, hooks }
  if (!Object.keys(hooks).length) delete out.hooks
  const changed = raw === null ? enabled : JSON.stringify(out) !== JSON.stringify(data)
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
    excludeLocal(file)
  }
  return { file, changed, state: enabled ? 'on' : 'off', foreign }
}

// Keep the machine-local settings file out of git when nothing ignores it yet.
function excludeLocal(file) {
  const dir = path.dirname(path.dirname(file))
  const rel = path.relative(dir, file)
  if (git(dir, ['check-ignore', '-q', rel]) !== null) return
  const common = git(dir, ['rev-parse', '--git-common-dir'])
  if (!common) return
  const exclude = path.join(path.resolve(dir, common), 'info', 'exclude')
  const body = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
  if (body.split('\n').includes(rel)) return
  fs.mkdirSync(path.dirname(exclude), { recursive: true })
  fs.writeFileSync(exclude, `${body}${body && !body.endsWith('\n') ? '\n' : ''}${rel}\n`)
}
