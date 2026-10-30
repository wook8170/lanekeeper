// Runtime helpers shared by the ported hooks: data folder, notifications,
// writing the personal settings file and the stdin/stdout hook protocol.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { wbHome, getPath } from './config.mjs'

// Persistent plugin data. Hooks get CLAUDE_PLUGIN_DATA; bin tools and launchd
// jobs fall back to a folder inside the wb home.
export function dataDir(env = process.env) {
  return env.CLAUDE_PLUGIN_DATA ? path.resolve(env.CLAUDE_PLUGIN_DATA) : path.join(wbHome(env), 'data')
}

export function expandVars(p, env = process.env) {
  return String(p).replace(/\$\{CLAUDE_PLUGIN_DATA\}/g, dataDir(env)).replace(/^~(?=\/)/, env.HOME || os.homedir())
}

// routing.limits_state with ${CLAUDE_PLUGIN_DATA} replaced.
export function limitsFile(resolved, env = process.env) {
  return expandVars(getPath(resolved.config, 'routing.limits_state') || '${CLAUDE_PLUGIN_DATA}/limits.json', env)
}

export function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(env.HOME || os.homedir(), '.claude')
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

// Set a key of ~/.wb/personal.json (creates the file when missing).
export function setPersonal(env, key, value) {
  const file = path.join(wbHome(env), 'personal.json')
  const cur = readJson(file) || { version: 1 }
  let o = cur
  const parts = key.split('.')
  for (const k of parts.slice(0, -1)) {
    if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}
    o = o[k]
  }
  o[parts.at(-1)] = value
  writeJsonAtomic(file, cur)
  return file
}

// Desktop notification. macOS: osascript, Linux: notify-send, otherwise silent.
export function notify(title, body, { platform = process.platform, exec = defaultExec, env = process.env } = {}) {
  if (env.WB_NO_NOTIFY === '1') return false
  if (platform === 'darwin') {
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return exec('osascript', ['-e', `display notification "${esc(body)}" with title "${esc(title)}"`]).status === 0
  }
  if (platform === 'linux') return exec('notify-send', [title, body]).status === 0
  return false
}

export function defaultExec(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' }
}

export const safeId = (s) => String(s || 'global').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)

export function ctxOutput(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } }
}

// Run a hook handler: read stdin JSON, print the handler result, never throw.
// Handlers return a string or an object (printed as JSON) or null.
// Every hook run through here is a workflow hook: silent outside a repository
// that opted in (lib/optin.mjs). defer names the kind that a hook already in the
// user's Claude Code settings replaces (handoff, token_guard, auto_retry, terse).
export function hookMain(importMeta, handler, { failOpen = true, defer = null } = {}) {
  const self = fs.realpathSync(new URL(importMeta.url).pathname)
  if (!process.argv[1] || fs.realpathSync(path.resolve(process.argv[1])) !== self) return
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (raw += c))
  process.stdin.on('end', async () => {
    let out = null
    try {
      const input = JSON.parse(raw || '{}')
      if (await active(input, process.env, defer)) out = await handler(input, process.env)
    } catch (e) {
      if (!failOpen) throw e
      process.stderr.write(`[wb] ${String(e?.message || e)}\n`)
    }
    if (out) process.stdout.write(`${typeof out === 'string' ? out : JSON.stringify(out)}\n`)
    process.exit(0)
  })
}

// Whether a workflow hook should act on this input.
export async function active(input, env = process.env, defer = null) {
  const { projectRoot, resolveConfig } = await import('./config.mjs')
  const { optedIn, deferred } = await import('./optin.mjs')
  const root = projectRoot(input.cwd || process.cwd(), env)
  if (!optedIn(root, env)) return false
  if (defer && deferred(defer, resolveConfig({ projectDir: root, env }).config, env)) return false
  return true
}
