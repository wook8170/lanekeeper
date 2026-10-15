#!/usr/bin/env node
// SessionStart: inject the terse-mode rules when the mode is on.
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { terseRules, terseState } from '../../../lib/terse.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'

export function handle(input, env = process.env) {
  const root = projectRoot(input.cwd || process.cwd(), env)
  const resolved = resolveConfig({ projectDir: root, env })
  if (resolved.errors.length || !terseState(root, resolved).on) return null
  return ctxOutput('SessionStart', terseRules(resolved.effective.language))
}

hookMain(import.meta, handle)
