#!/usr/bin/env node
// PreToolUse(Bash) slot guard: a heavy command (full test suite, build,
// install, e2e, index) or a headless browser run should go through wb-slot so
// the machine-wide slot counts and the load threshold apply.
//
// machine.slots.guard:
//   warn (default)  the call goes ahead; Claude gets a note with the wrapped command
//   deny            the call is blocked with the same three-part message as the safety hooks
// This guard limits resource use; it is not a safety guard, so it fails open.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { rulesFor, unwrappedHeavy, suggestWrap } from '../../../lib/heavy.mjs'
import { parse } from '../safety/shell.mjs'
import { deny, formatReasons } from '../safety/common.mjs'

export function judgeSlots(input, env = process.env) {
  if (input.tool_name !== 'Bash') return null
  const command = String(input.tool_input?.command || '')
  if (!command.trim()) return null
  const cwd = input.cwd || process.cwd()
  const resolved = resolveConfig({ projectDir: projectRoot(cwd, env), env })
  const hits = unwrappedHeavy(parse(command, { cwd, home: env.HOME || '' }), rulesFor(resolved.config))
  if (!hits.length) return null
  const kinds = [...new Set(hits.flatMap((h) => h.kinds))].sort()
  const mode = resolved.config.machine?.slots?.guard === 'deny' ? 'deny' : 'warn'
  const vars = { cmd: hits[0].text.slice(0, 120), kinds: kinds.join(','), wrap: suggestWrap(command, kinds) }
  return { mode, kinds, hits, vars, language: resolved.effective.language }
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
          permissionDecisionReason: formatReasons(lang, [deny('slot.unwrapped', r.vars)]),
        },
      })
    }
    const t = translator(lang)
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `[wb] ${t('slot.guard.warn', r.vars)}` },
    })
  } catch {
    return ''
  }
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (raw += c))
  process.stdin.on('end', () => {
    const out = runHook(raw)
    if (out) process.stdout.write(`${out}\n`)
    process.exit(0)
  })
}
