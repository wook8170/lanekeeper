#!/usr/bin/env node
// SessionStart: inject the working rules that no hook can check, from rules/*.md,
// on a new session, /clear and after a compaction (a resumed session keeps them).
//   language   rules/language.<lang>.md        when personal.language is ko or en (not auto)
//   remote     rules/remote-viewer.<lang>.md   when personal.report.viewer is remote
//   conduct    rules/conduct.<lang>.md         reporting, communication and fixing rules
// Each part is turned off with personal.session_rules.<part> = false.
// Not a safety hook: errors add nothing.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot, getPath, PLUGIN_ROOT } from '../../../lib/config.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'

export const readRule = (name, lang) => fs.readFileSync(path.join(PLUGIN_ROOT, 'rules', `${name}.${lang === 'ko' ? 'ko' : 'en'}.md`), 'utf8').trim()

// Names of the rule files that apply to a resolved config.
export function sessionRuleParts(resolved) {
  const cfg = resolved.config
  const on = (k) => getPath(cfg, `personal.session_rules.${k}`) !== false
  const parts = []
  const lang = getPath(cfg, 'personal.language')
  if (on('language') && (lang === 'ko' || lang === 'en')) parts.push('language')
  if (on('remote') && getPath(cfg, 'personal.report.viewer') === 'remote') parts.push('remote-viewer')
  if (on('conduct')) parts.push('conduct')
  return parts
}

export function handle(input, env = process.env) {
  const src = input.source || 'startup'
  if (src === 'resume') return null
  const resolved = resolveConfig({ projectDir: projectRoot(input.cwd || process.cwd(), env), env })
  if (resolved.errors.length) return null
  const parts = sessionRuleParts(resolved)
  if (!parts.length) return null
  const lang = resolved.effective.language
  return ctxOutput('SessionStart', parts.map((p) => readRule(p, lang)).join('\n\n'))
}

hookMain(import.meta, handle)
