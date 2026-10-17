#!/usr/bin/env node
// UserPromptSubmit: look at the load every machine.load.check_every_min minutes
// (0 = off) and add one line only when it has reached a tier
// (hold_new_lanes or stop_heavy). Below the tiers it stays silent.
// Not a safety hook: errors let the prompt through.
import path from 'node:path'
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { ctxOutput, dataDir, hookMain, readJson, writeJsonAtomic } from '../../../lib/runtime.mjs'
import { dueForCheck, loadSettings, readLoad, tierOf } from '../../../lib/load.mjs'

export const stateFile = (env) => path.join(dataDir(env), 'load-check.json')

export function handle(input, env = process.env, deps = {}) {
  const resolved = resolveConfig({ projectDir: projectRoot(input.cwd || process.cwd(), env), env })
  if (resolved.errors.length) return null
  const ls = loadSettings(resolved)
  const now = deps.now ? deps.now() : Date.now()
  const file = stateFile(env)
  if (!dueForCheck(readJson(file), now, ls.checkEveryMin)) return null
  writeJsonAtomic(file, { last: now })
  const load = deps.loadavg ? deps.loadavg(ls.sample) : readLoad(ls.sample, env)
  const tier = tierOf(load, ls.tiers)
  if (tier === 'ok') return null
  const t = translator(resolved.effective.language)
  return ctxOutput(input.hook_event_name || 'UserPromptSubmit', `[wb] ${t(`load.notice.${tier}`, { load: load.toFixed(2), hold: ls.tiers.hold_new_lanes, stop: ls.tiers.stop_heavy })}`)
}

hookMain(import.meta, handle)
