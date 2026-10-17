#!/usr/bin/env node
// Stop: when real work is newer than the handoff file, block the end of the
// turn once so the file gets updated. Guards: stop_hook_active (once per
// turn), a per-session throttle, projects without the file, non-git folders.
// At a high token stage the throttle is lifted: every wave hands off.
// The message asks for the current-state rewrite: finished content to the
// archive, progress.md rewritten whole; an oversized file gets the move step.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot, getPath } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { isGit, isStale, handoffSettings, sizeCheck } from '../../../lib/handoff.mjs'
import { dataDir, hookMain, safeId } from '../../../lib/runtime.mjs'
import { readTier, stagesOf } from '../../../lib/token.mjs'

export function handle(input, env = process.env, now = Date.now()) {
  if (input.stop_hook_active === true) return null
  const cwd = input.cwd || process.cwd()
  const resolved = resolveConfig({ projectDir: projectRoot(cwd, env), env })
  if (resolved.errors.length) return null
  const h = getPath(resolved.config, 'personal.handoff') || {}
  if (h.enabled === false) return null
  const { file, maxLines, archiveDir } = handoffSettings(h)
  if (!fs.existsSync(path.join(cwd, file)) || !isGit(cwd)) return null
  const sid = safeId(input.session_id)
  const throttleFile = path.join(dataDir(env), 'handoff', `${sid}.last-block`)
  const tg = getPath(resolved.config, 'personal.token_guard') || {}
  const handoffStage = stagesOf(resolved)[1] ?? 95
  const highUse = tg.enabled !== false && readTier(sid, env) >= handoffStage
  const throttleMs = (h.throttle_min ?? 20) * 60e3
  if (!highUse && throttleMs > 0 && fs.existsSync(throttleFile) && now - fs.statSync(throttleFile).mtimeMs < throttleMs) return null
  if (!isStale(cwd, file)) return null
  fs.mkdirSync(path.dirname(throttleFile), { recursive: true })
  fs.writeFileSync(throttleFile, String(now))
  fs.utimesSync(throttleFile, new Date(now), new Date(now))
  const t = translator(resolved.effective.language)
  const size = sizeCheck(cwd, file, maxLines)
  const vars = { file, max: maxLines, archive: archiveDir, lines: size.lines }
  const reason = [t('handoff.stop', vars)]
  if (size.over) reason.push(t('handoff.oversize', vars))
  return { decision: 'block', reason: reason.join('\n') }
}

hookMain(import.meta, (i, e) => handle(i, e))
