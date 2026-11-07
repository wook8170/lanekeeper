#!/usr/bin/env node
// UserPromptSubmit: a person who leaves out the slash of /lanekeeper:approve sends an ordinary message,
// which no hook acts on. This adds one line so the agent says so and can raise the dialog instead.
// It never makes a grant: this event also fires for subagent reports and messages from other sessions.
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'

const TYPED = /^\s*(?:lanekeeper:)?approve\s+(merge-main|push-main|commit-main|merge-pr)(?:\s|$)/

export function promptHint(input, env = process.env) {
  const m = TYPED.exec(String(input.prompt ?? ''))
  if (!m) return null
  const resolved = resolveConfig({ projectDir: projectRoot(input.cwd || process.cwd(), env), env })
  const t = translator(resolved.effective.language)
  return ctxOutput('UserPromptSubmit', `[lanekeeper] ${t('approve.prompt_hint', { action: m[1] })}`)
}

hookMain(import.meta, promptHint)
