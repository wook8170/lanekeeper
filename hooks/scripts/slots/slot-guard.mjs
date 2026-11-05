#!/usr/bin/env node
// PreToolUse(Bash) slot guard: a heavy command (full test suite, build,
// install, e2e, index) or a headless browser run should go through lanekeeper-slot so
// the machine-wide slot counts and the load threshold apply.
//
// machine.slots.guard:
//   warn (default)  the call goes ahead; Claude gets a note with the wrapped command
//   deny            the call is blocked with the same three-part message as the safety hooks
// Load tiers: at or above machine.load.tiers.stop_heavy a verifier lane's heavy
// run (wrapped in lanekeeper-slot or not) is blocked whatever the guard mode
// (safety.slot.load_stop_heavy). Executor lanes and the main session keep the
// lanekeeper-slot wait (machine.load.max). Slots already held are not touched.
// This guard limits resource use; it is not a safety guard, so it fails open.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig, projectRoot, stateDir } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { rulesFor, unwrappedHeavy, suggestWrap, wrappedText, WRAPPER } from '../../../lib/heavy.mjs'
import { parse } from '../safety/shell.mjs'
import { deny, formatReasons } from '../safety/common.mjs'
import { readLoad, loadSettings, laneFor, laneRole, stopVerdict } from '../../../lib/load.mjs'
import { active } from '../../../lib/runtime.mjs'

export function judgeSlots(input, env = process.env) {
  if (input.tool_name !== 'Bash') return null
  const command = String(input.tool_input?.command || '')
  if (!command.trim()) return null
  const cwd = input.cwd || process.cwd()
  const root = projectRoot(cwd, env)
  const resolved = resolveConfig({ projectDir: root, env })
  const cmds = parse(command, { cwd, home: env.HOME || '' })
  const hits = unwrappedHeavy(cmds, rulesFor(resolved.config))
  const wrapped = cmds.filter((c) => c.name === WRAPPER && c.args.some((a) => a.text === '--'))
  if (hits.length || wrapped.length) {
    const ls = loadSettings(resolved)
    const load = readLoad(ls.sample, env)
    if (load >= ls.tiers.stop_heavy) {
      const sd = stateDir(root)
      const lane = laneFor(sd, root, env)
      const { role } = laneRole(sd, lane)
      const v = stopVerdict(load, ls.tiers, role)
      if (v) return { mode: 'deny', code: `slot.${v.code}`, kinds: [], hits, vars: { ...v.vars, lane: lane?.id || '-', cmd: (hits[0]?.text || wrappedText(wrapped[0])).slice(0, 120) }, language: resolved.effective.language }
    }
  }
  if (!hits.length) return null
  const kinds = [...new Set(hits.flatMap((h) => h.kinds))].sort()
  const mode = resolved.config.machine?.slots?.guard === 'deny' ? 'deny' : 'warn'
  const vars = { cmd: hits[0].text.slice(0, 120), kinds: kinds.join(','), wrap: suggestWrap(command, kinds) }
  return { mode, code: 'slot.unwrapped', kinds, hits, vars, language: resolved.effective.language }
}

export function runHook(raw, env = process.env) {
  try {
    const r = judgeSlots(JSON.parse(raw || '{}'), env)
    if (!r) return ''
    const lang = r.language
    if (r.mode === 'deny') {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: formatReasons(lang, [deny(r.code, r.vars)]),
        },
      })
    }
    const t = translator(lang)
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `[lanekeeper] ${t('slot.guard.warn', r.vars)}` },
    })
  } catch {
    return ''
  }
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (raw += c))
  process.stdin.on('end', async () => {
    // workflow hook: silent outside a repository that opted in (lib/optin.mjs)
    let on = false
    try {
      on = await active(JSON.parse(raw || '{}'))
    } catch {}
    const out = on ? runHook(raw) : ''
    if (out) process.stdout.write(`${out}\n`)
    process.exit(0)
  })
}
