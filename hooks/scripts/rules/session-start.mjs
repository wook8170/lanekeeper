#!/usr/bin/env node
// SessionStart: inject the working rules that no hook can check, from rules/*.md,
// on a new session, /clear and after a compaction (a resumed session keeps them).
//   language   rules/language.<lang>.md        when personal.language is ko or en (not auto)
//   remote     rules/remote-viewer.<lang>.md   when personal.report.viewer is remote
//   conduct    rules/conduct.<lang>.md         reporting, communication and fixing rules
// Each part is turned off with personal.session_rules.<part> = false.
// It also tells the user, once, which names from before 0.2.0 (~/.wb, .wb,
// <git-common-dir>/wb, WB_* variables) are still read (lib/naming.mjs).
// Not a safety hook: errors add nothing.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot, getPath, stateDir, PLUGIN_ROOT, LEGACY_ENV_COPIED } from '../../../lib/config.mjs'
import { ctxOutput, hookMain, dataDir } from '../../../lib/runtime.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { legacyInUse, legacyNotice } from '../../../lib/naming.mjs'

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

// Text of the one-time notice about old names still in use, or ''.
export function legacyText(root, lang, env = process.env, copiedEnv = LEGACY_ENV_COPIED) {
  const sd = root ? stateDir(root) : null
  const items = legacyNotice(legacyInUse({ env, root, commonDir: sd ? path.dirname(sd) : null, copiedEnv }), path.join(dataDir(env), 'legacy-notice.json'))
  if (!items.length) return ''
  const t = translator(lang)
  const lines = items.map((i) => t(`legacy.item.${i.kind}`, { old: i.old, new: i.preferred }))
  return t('legacy.notice', { items: lines.map((l) => `- ${l}`).join('\n') })
}

export function handle(input, env = process.env) {
  const src = input.source || 'startup'
  if (src === 'resume') return null
  const root = projectRoot(input.cwd || process.cwd(), env)
  const resolved = resolveConfig({ projectDir: root, env })
  if (resolved.errors.length) return null
  const lang = resolved.effective.language
  const notice = legacyText(root, lang, env)
  const parts = sessionRuleParts(resolved)
  if (!parts.length && !notice) return null
  const text = [...parts.map((p) => readRule(p, lang)), notice].filter(Boolean).join('\n\n')
  const out = ctxOutput('SessionStart', text)
  if (notice) out.systemMessage = notice
  return out
}

hookMain(import.meta, handle)
