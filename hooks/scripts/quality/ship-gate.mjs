#!/usr/bin/env node
// PreToolUse(Agent|Task|Skill) ship gate.
//
// Before ship verification starts (a subagent of a type in project.quality.ship.agents, a Skill in
// project.quality.ship.skills, or an Agent prompt that names one of those skills), every kind in
// project.quality.ship.requires needs a passed result on the current commit that is not weaker than
// the previous passed result. Otherwise the call is denied (enforce "deny") or noted ("warn"), with
// the kinds and states and the command that runs and fixes them (/wb:ship-verify).
// Not a safety hook: internal errors let the call through (fail-open) with a note.
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { hookMain } from '../../../lib/runtime.mjs'
import { qualitySettings, isShipTarget, precheck, treeDirty } from '../../../lib/quality.mjs'

export function evaluate(input, env = process.env, overrides = {}) {
  if (!['Agent', 'Task', 'Skill'].includes(input.tool_name)) return null
  const root = overrides.projectRoot || projectRoot(input.cwd || process.cwd(), env)
  const resolved = overrides.resolved || resolveConfig({ projectDir: root, env })
  const S = qualitySettings(resolved.config)
  if (!S.ship.requires.length || S.ship.enforce === 'off') return null
  if (!isShipTarget(input, S)) return null
  const res = precheck(root, S)
  const dirty = treeDirty(root, `${S.resultsRoot.replace(/\/+$/, '')}/`)
  const bad = res.rows.filter((r) => r.state !== 'ok')
  if (!bad.length && !dirty) return null
  return { level: S.ship.enforce === 'warn' ? 'warn' : 'deny', rows: bad, dirty, language: resolved.effective?.language || 'en' }
}

export function format(r) {
  const t = translator(r.language)
  const items = r.rows.map((x) => `${x.kind}=${t(`q.state.${x.state}`)}`)
  if (r.dirty) items.push(t('q.state.tree_dirty'))
  const head = r.level === 'deny' ? t('safety.blocked') : t('dispatch.warn')
  return `[wb] ${head}: ${t('dispatch.ship_precheck.why', { items: items.join(', ') })}\n${t('safety.fix')}: ${t('dispatch.ship_precheck.fix')}`
}

export function handle(input, env = process.env, overrides = {}) {
  const r = evaluate(input, env, overrides)
  if (!r) return null
  const text = format(r)
  if (r.level === 'deny') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text } }
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }
}

hookMain(import.meta, (input, env) => handle(input, env))
