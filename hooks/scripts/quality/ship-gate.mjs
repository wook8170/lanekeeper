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
// The release security gate (project.release) is checked at the same point: with a check set, the
// current commit needs the security stamp (`lanekeeper-test-report security-pass`); required but not set
// also blocks; not set and not required only adds a "not configured" warning.
// Not a safety hook: internal errors let the call through (fail-open) with a note.
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { hookMain } from '../../../lib/runtime.mjs'
import { qualitySettings, isShipTarget, precheck, treeDirty } from '../../../lib/quality.mjs'
import { securityState, securityBlocks } from '../../../lib/release.mjs'

export function evaluate(input, env = process.env, overrides = {}) {
  if (!['Agent', 'Task', 'Skill'].includes(input.tool_name)) return null
  const root = overrides.projectRoot || projectRoot(input.cwd || process.cwd(), env)
  const resolved = overrides.resolved || resolveConfig({ projectDir: root, env })
  const S = qualitySettings(resolved.config)
  if (S.ship.enforce === 'off') return null
  if (!isShipTarget(input, S)) return null
  const sec = securityState(root, resolved.config)
  const secBad = securityBlocks(sec) ? sec : null
  const secWarn = sec.state === 'unconfigured'
  const res = S.ship.requires.length ? precheck(root, S) : { rows: [], advisory: [] }
  const dirty = S.ship.requires.length ? treeDirty(root, `${S.resultsRoot.replace(/\/+$/, '')}/`) : false
  const bad = res.rows.filter((r) => r.state !== 'ok')
  const advisory = (res.advisory || []).filter((r) => r.state !== 'ok')
  if (!bad.length && !dirty && !advisory.length && !secBad && !secWarn) return null
  const level = bad.length || dirty || secBad ? (S.ship.enforce === 'warn' ? 'warn' : 'deny') : 'warn'
  return { level, rows: bad, advisory, dirty, security: secBad, securityUnset: secWarn, language: resolved.effective?.language || 'en' }
}

export function format(r) {
  const t = translator(r.language)
  const items = r.rows.map((x) => `${x.kind}=${t(`q.state.${x.state}`)}`)
  if (r.dirty) items.push(t('q.state.tree_dirty'))
  const head = r.level === 'deny' ? t('safety.blocked') : t('dispatch.warn')
  const adv = (r.advisory || []).map((x) => `${x.kind}=${t(`q.state.${x.state}`)}`).join(', ')
  const advLine = [adv ? t('dispatch.ship_precheck.advisory', { items: adv }) : '', r.securityUnset ? t('dispatch.ship_security.unset') : ''].filter(Boolean).join('\n')
  const sec = r.security
  const vars = sec && { head: sec.head ? sec.head.slice(0, 9) : '?', stamped: sec.stamp?.head?.slice(0, 9) || '-', command: sec.command || '-' }
  const secLine = sec ? `${t(`safety.security.${sec.state}.why`, vars)}\n${t('safety.fix')}: ${t(`safety.security.${sec.state}.fix`, vars)}` : ''
  const parts = []
  if (items.length) parts.push(`${t('dispatch.ship_precheck.why', { items: items.join(', ') })}\n${t('safety.fix')}: ${t('dispatch.ship_precheck.fix')}`)
  if (secLine) parts.push(secLine)
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
