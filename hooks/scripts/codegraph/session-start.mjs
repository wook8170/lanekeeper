#!/usr/bin/env node
// SessionStart: when codegraph is installed, add the short codegraph guidance
// (rules/codegraph.<lang>.md). Silent when it is missing or the nudge is off.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot, PLUGIN_ROOT } from '../../../lib/config.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'
import { findBin } from '../../../lib/codegraph.mjs'

export function codegraphRules(lang) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, 'rules', `codegraph.${lang === 'ko' ? 'ko' : 'en'}.md`), 'utf8')
}

export function handle(input, env = process.env) {
  if (!findBin(env)) return null
  const resolved = resolveConfig({ projectDir: projectRoot(input.cwd || process.cwd(), env), env })
  if (resolved.errors.length || resolved.config.project?.codegraph?.nudge === 'off') return null
  return ctxOutput('SessionStart', codegraphRules(resolved.effective.language))
}

hookMain(import.meta, handle)
