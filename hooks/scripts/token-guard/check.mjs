#!/usr/bin/env node
// PostToolUse / UserPromptSubmit: instruct only when the usage stage rises.
// Usage = weighted tokens of the recent window from local transcripts, as a
// percentage of personal.token_guard.budget. Budget 0 means not calibrated:
// the guard stays silent (see `wb-token calibrate`).
import { resolveConfig, projectRoot, getPath } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { cachedUsage, percent, readTier, stagesOf, tierFor, writeTier } from '../../../lib/token.mjs'
import { ctxOutput, hookMain, notify } from '../../../lib/runtime.mjs'

export function handle(input, env = process.env, deps = {}) {
  const resolved = resolveConfig({ projectDir: projectRoot(input.cwd || process.cwd(), env), env })
  if (resolved.errors.length) return null
  const cfg = getPath(resolved.config, 'personal.token_guard') || {}
  if (cfg.enabled === false) return null
  const sid = input.session_id || 'global'
  let util
  if (env.WB_TOKEN_FAKE_UTIL !== undefined && env.WB_TOKEN_FAKE_UTIL !== '') util = Number(env.WB_TOKEN_FAKE_UTIL)
  else {
    if (!(cfg.budget > 0)) return null
    util = percent(cachedUsage({ env, hours: cfg.window_hours || 5 }).weighted, cfg.budget)
  }
  if (!Number.isFinite(util)) return null
  const { tier, role } = tierFor(util, stagesOf(resolved))
  const last = readTier(sid, env)
  if (tier <= last) {
    if (tier < last) writeTier(sid, tier, env)
    return null
  }
  writeTier(sid, tier, env)
  const t = translator(resolved.effective.language)
  const handoffOn = getPath(resolved.config, 'personal.handoff.enabled') !== false
  const vars = { util, hours: cfg.window_hours || 5 }
  let key = `token.${role}`
  if (role === 'handoff' && handoffOn) key = 'token.handoff.guarded'
  if (role === 'critical') (deps.notify || ((a, b) => notify(a, b, { env })))(t('token.notify.title'), t('token.notify.body', vars))
  return ctxOutput(input.hook_event_name || 'PostToolUse', t(key, vars))
}

hookMain(import.meta, handle)
