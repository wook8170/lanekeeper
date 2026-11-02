// rg hint: a recursive grep (grep -r / -R / --recursive) gets a note to use rg
// (ripgrep) instead: rg follows .gitignore, so node_modules and build output
// stay out, and it is much faster on a large tree. Sources with Korean comments
// can be taken for binary files; rg -a reads them as text. When rg is not
// installed the note says how to install it. Nothing is blocked; the note
// shows once per session.
// Off with personal.search.rg_hint = false. Called from the codegraph nudge
// hook (one PreToolUse process for both notes).
import fs from 'node:fs'
import path from 'node:path'
import { getPath } from './config.mjs'
import { translator } from './i18n.mjs'
import { parse } from '../hooks/scripts/safety/shell.mjs'

const GREPS = new Set(['grep', 'egrep', 'fgrep'])
const WITH_VALUE = new Set(['-e', '-f', '--regexp', '--file', '-m', '--max-count', '-A', '-B', '-C', '--include', '--exclude', '--exclude-dir'])

export function isRecursiveGrep(cmd) {
  if (!GREPS.has(cmd.name)) return false
  const texts = cmd.args.map((a) => a.text)
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]
    if (t === '--') return false
    if (WITH_VALUE.has(t)) {
      i++
      continue
    }
    if (t === '--recursive' || t === '--dereference-recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(t)) return true
  }
  return false
}

export function hasRg(env = process.env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    try {
      fs.accessSync(path.join(dir, 'rg'), fs.constants.X_OK)
      return true
    } catch {}
  }
  return false
}

// The note text for a Bash call, or null.
export function rgHint(input, resolved, env = process.env) {
  if (input.tool_name !== 'Bash') return null
  const command = String(input.tool_input?.command || '')
  if (!/\b[ef]?grep\b/.test(command)) return null
  if (resolved.errors.length || getPath(resolved.config, 'personal.search.rg_hint') === false) return null
  const hit = parse(command, { cwd: input.cwd || process.cwd(), home: env.HOME || '' }).find(isRecursiveGrep)
  if (!hit) return null
  return translator(resolved.effective.language)(hasRg(env) ? 'search.rg_hint' : 'search.rg_missing')
}
