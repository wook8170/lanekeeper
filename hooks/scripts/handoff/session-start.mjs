#!/usr/bin/env node
// SessionStart: inject progress.md (the current state, whole; the newest
// section of a legacy accumulated file), where the archive is, a size warning,
// and the chat length guideline. Only on a new session or /clear; resume and
// compact keep context.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot, getPath } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { excerpt, countLines, handoffSettings } from '../../../lib/handoff.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'

export function handle(input, env = process.env) {
  const src = input.source || 'startup'
  if (src !== 'startup' && src !== 'clear') return null
  const cwd = input.cwd || process.cwd()
  const resolved = resolveConfig({ projectDir: projectRoot(cwd, env), env })
  if (resolved.errors.length) return null
  const t = translator(resolved.effective.language)
  const parts = []
  const detail = getPath(resolved.config, 'personal.report.chat_detail')
  parts.push(t(detail === 'detailed' ? 'chat.detailed' : 'chat.summary'))
  const h = getPath(resolved.config, 'personal.handoff') || {}
  if (h.enabled !== false) {
    const { file, maxLines, archiveDir } = handoffSettings(h)
    const p = path.join(cwd, file)
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, 'utf8')
      const lines = countLines(text)
      const over = lines > maxLines
      parts.push(t('handoff.start', { src, file, excerpt: excerpt(text, { maxLines }), path: p, archive: archiveDir, shown: t(over ? 'handoff.shown.newest' : 'handoff.shown.whole') }))
      if (over) parts.push(t('handoff.oversize', { file, lines, max: maxLines, archive: archiveDir }))
    }
  }
  return ctxOutput('SessionStart', parts.join('\n\n'))
}

hookMain(import.meta, handle)
