#!/usr/bin/env node
// PostToolUse / UserPromptSubmit: instruct only when the usage stage rises.
// Usage = the official five-hour / seven-day percentage Claude Code caches in
// ~/.claude.json, plus a local estimate for the time since it was fetched
// (lib/token.mjs estimateUsage). Without a cache the budget is the fallback;
// budget 0 and no calibration means the guard stays silent.
import { resolveConfig, projectRoot, getPath } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { cachedEstimate, readTier, stagesOf, tierFor, writeTier } from '../../../lib/token.mjs'
import { ctxOutput, hookMain, notify } from '../../../lib/runtime.mjs'

// Words for where the percentage comes from.
export function sourceText(t, est, hours) {
  if (!est) return t('token.src.fake')
  if (est.source === 'official') return t('token.src.official')
  if (est.source === 'estimate') return t('token.src.estimate')
  return t('token.src.local', { hours })
}

export function handle(input, env = process.env, deps = {}) {
  const resolved = resolveConfig({ projectDir: projectRoot(input.cwd || process.cwd(), env), env })
  if (resolved.errors.length) return null
  const cfg = getPath(resolved.config, 'personal.token_guard') || {}
  if (cfg.enabled === false) return null
  const sid = input.session_id || 'global'
  let util
  let est = null
  if (env.WB_TOKEN_FAKE_UTIL !== undefined && env.WB_TOKEN_FAKE_UTIL !== '') util = Number(env.WB_TOKEN_FAKE_UTIL)
  else {
    est = cachedEstimate({ env, cfg })
    if (est.util == null) return null
    util = est.util
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
  const hours = cfg.window_hours || 5
  const vars = { util, hours, src: sourceText(t, est, hours) }
  let key = `token.${role}`
  if (role === 'handoff' && handoffOn) key = 'token.handoff.guarded'
  if (role === 'critical') (deps.notify || ((a, b) => notify(a, b, { env })))(t('token.notify.title'), t('token.notify.body', vars))
  return ctxOutput(input.hook_event_name || 'PostToolUse', t(key, vars))
}

hookMain(import.meta, handle)
