#!/usr/bin/env node
// SessionStart: show waiting and finished automatic resumes, only when there are any.
import { resolveConfig, projectRoot, getPath } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { pendingList } from '../../../lib/retry.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'

export function handle(input, env = process.env) {
  const resolved = resolveConfig({ projectDir: projectRoot(input.cwd || process.cwd(), env), env })
  if (resolved.errors.length) return null
  const t = translator(resolved.effective.language)
  if (getPath(resolved.config, 'personal.auto_retry.enabled') === false) return ctxOutput('SessionStart', t('retry.session.off'))
  const { pending, done } = pendingList(env)
  const lines = []
  if (pending.length) {
    lines.push(t('retry.session.pending', { count: pending.length }))
    for (const p of pending) lines.push(t('retry.session.item', { id: String(p.original_session_id).slice(0, 8), at: new Date(p.run_at * 1000).toLocaleString(), cwd: p.cwd }))
  }
  if (done.length) lines.push(t('retry.session.done', { count: done.length }))
  return lines.length ? ctxOutput('SessionStart', lines.join('\n')) : null
}

hookMain(import.meta, handle, { defer: 'auto_retry' })
