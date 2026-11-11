#!/usr/bin/env node
// PreToolUse(Agent|Task|Skill) ship gate.
//
// Before ship verification starts (a subagent of a type in project.quality.ship.agents, a Skill in
// project.quality.ship.skills, or an Agent prompt that names one of those skills), every kind in
// project.quality.ship.requires needs a passed result on the current commit that is not weaker than
// the previous passed result. Otherwise the call is denied (enforce "deny") or noted ("warn"), with
// the kinds and states and the command that runs and fixes them (/lanekeeper:ship-verify).
// Kinds in project.quality.ship.advisory (default ux-adversarial) are checked the same way but only
// add a warning: not run before shipping, or the newest result failed (an open blocker finding).
// The release gates (project.release.gates) are checked at the same point: every required gate needs
// its pass stamp on the current commit (`lanekeeper-test-report gates-pass`), and each one that has not
// passed is named with the command that passes it. A gate that is not required only warns; with no
// gate set at all the hook adds a "not configured" warning.
// Not a safety hook: internal errors let the call through (fail-open) with a note.
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { hookMain } from '../../../lib/runtime.mjs'
import { qualitySettings, isShipTarget, precheck, treeDirty } from '../../../lib/quality.mjs'
import { gateVars, releaseState, splitGates } from '../../../lib/release.mjs'

export function evaluate(input, env = process.env, overrides = {}) {
  if (!['Agent', 'Task', 'Skill'].includes(input.tool_name)) return null
  const root = overrides.projectRoot || projectRoot(input.cwd || process.cwd(), env)
  const resolved = overrides.resolved || resolveConfig({ projectDir: root, env })
  const S = qualitySettings(resolved.config)
  if (S.ship.enforce === 'off') return null
  if (!isShipTarget(input, S)) return null
  const rel = releaseState(root, resolved.config)
  const { blocking, optional } = splitGates(rel.gates)
  const gates = blocking.map((g) => ({ state: g.state, vars: gateVars(g, rel.head) }))
  const optionalGates = optional.map((g) => gateVars(g, rel.head))
  const unset = !rel.configured
  const res = S.ship.requires.length ? precheck(root, S) : { rows: [], advisory: [] }
  const dirty = S.ship.requires.length ? treeDirty(root, `${S.resultsRoot.replace(/\/+$/, '')}/`) : false
  const bad = res.rows.filter((r) => r.state !== 'ok')
  const advisory = (res.advisory || []).filter((r) => r.state !== 'ok')
  if (!bad.length && !dirty && !advisory.length && !gates.length && !optionalGates.length && !unset) return null
  const level = bad.length || dirty || gates.length ? (S.ship.enforce === 'warn' ? 'warn' : 'deny') : 'warn'
  return { level, rows: bad, advisory, dirty, gates, optionalGates, releaseUnset: unset, language: resolved.effective?.language || 'en' }
}

export function format(r) {
  const t = translator(r.language)
  const items = r.rows.map((x) => `${x.kind}=${t(`q.state.${x.state}`)}`)
  if (r.dirty) items.push(t('q.state.tree_dirty'))
  const head = r.level === 'deny' ? t('safety.blocked') : t('dispatch.warn')
  const adv = (r.advisory || []).map((x) => `${x.kind}=${t(`q.state.${x.state}`)}`).join(', ')
  const optional = (r.optionalGates || []).map((v) => t('dispatch.ship_release.optional_item', v)).join(', ')
  const advLine = [
    adv ? t('dispatch.ship_precheck.advisory', { items: adv }) : '',
    optional ? t('dispatch.ship_release.optional', { items: optional }) : '',
    r.releaseUnset ? t('dispatch.ship_release.unset') : '',
  ].filter(Boolean).join('\n')
  const parts = []
  if (items.length) parts.push(`${t('dispatch.ship_precheck.why', { items: items.join(', ') })}\n${t('safety.fix')}: ${t('dispatch.ship_precheck.fix')}`)
  for (const g of r.gates || []) parts.push(`${t(`safety.release.${g.state}.why`, g.vars)}\n${t('safety.fix')}: ${t(`safety.release.${g.state}.fix`, g.vars)}`)
  if (!parts.length) return `[lanekeeper] ${head}: ${advLine}`
  return `[lanekeeper] ${head}: ${parts.join('\n')}${advLine ? `\n${advLine}` : ''}`
}

export function handle(input, env = process.env, overrides = {}) {
  const r = evaluate(input, env, overrides)
  if (!r) return null
  const text = format(r)
  if (r.level === 'deny') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text } }
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }
}

hookMain(import.meta, (input, env) => handle(input, env))
