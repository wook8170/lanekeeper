#!/usr/bin/env node
// SessionStart: inject the newest progress.md section and the chat length
// guideline. Only on a new session or /clear; resume and compact keep context.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot, getPath } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { excerpt } from '../../../lib/handoff.mjs'
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
  if (getPath(resolved.config, 'personal.handoff.enabled') !== false) {
    const file = getPath(resolved.config, 'personal.handoff.file') || 'progress.md'
    const p = path.join(cwd, file)
    if (fs.existsSync(p)) {
      parts.push(t('handoff.start', { src, file, excerpt: excerpt(fs.readFileSync(p, 'utf8')), path: p }))
    }
  }
  return ctxOutput('SessionStart', parts.join('\n\n'))
}

hookMain(import.meta, handle)
