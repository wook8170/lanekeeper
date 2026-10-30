// Opt-in and deference for the non-safety hooks.
//
// optedIn: wb's workflow hooks (dispatch guard, ship gate, handoff, checkpoint,
// load, slots, mockup, codegraph, token guard, auto resume, terse, session
// rules) act only in a repository that has opted in with .wb/config.json (in
// the checkout or in the main checkout of its repository). Elsewhere they stay
// silent; the safety hooks (safety/pretool, safety/approve) always run.
// WB_ACTIVE=1 turns every repository on, WB_ACTIVE=0 turns them all off.
//
// deferred: when the Claude Code settings (CLAUDE_CONFIG_DIR/settings.json,
// ~/.claude/settings.json) already register a hook of the same kind (handoff,
// token guard, auto retry, terse), wb's own hook of that kind stays silent so
// the same guidance is not given twice. personal.global_hooks = "ignore" keeps
// wb's hooks on anyway.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export function optedIn(root, env = process.env) {
  if (env.WB_ACTIVE === '1') return true
  if (env.WB_ACTIVE === '0') return false
  if (!root) return false
  if (fs.existsSync(path.join(root, '.wb', 'config.json'))) return true
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (path.basename(common) === '.git' && fs.existsSync(path.join(path.dirname(common), '.wb', 'config.json'))) return true
  } catch {}
  return false
}

export const GLOBAL_KINDS = {
  handoff: /handoff[-_]?guard|session[-_]?handoff/i,
  token_guard: /token[-_]?guard/i,
  auto_retry: /auto[-_]?retry/i,
  terse: /terse/i,
}

export function settingsFiles(env = process.env) {
  const out = []
  if (env.CLAUDE_CONFIG_DIR) out.push(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json'))
  if (env.HOME) out.push(path.join(env.HOME, '.claude', 'settings.json'))
  return [...new Set(out)]
}

// Kinds that the user's own Claude Code settings already hook.
export function globalHookKinds(env = process.env, files = settingsFiles(env)) {
  const found = new Set()
  for (const f of files) {
    let data
    try {
      data = JSON.parse(fs.readFileSync(f, 'utf8'))
    } catch {
      continue
    }
    for (const groups of Object.values(data?.hooks || {})) {
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of g?.hooks || []) {
          const cmd = [h?.command, ...(Array.isArray(h?.args) ? h.args : [])].filter(Boolean).join(' ')
          for (const [kind, re] of Object.entries(GLOBAL_KINDS)) if (re.test(cmd)) found.add(kind)
        }
      }
    }
  }
  return found
}

export function deferred(kind, config, env = process.env) {
  if (!kind || config?.personal?.global_hooks === 'ignore') return false
  return globalHookKinds(env).has(kind)
}
