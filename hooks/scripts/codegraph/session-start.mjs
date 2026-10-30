#!/usr/bin/env node
// SessionStart: when codegraph is installed, add the short codegraph guidance
// (rules/codegraph.<lang>.md); when it is missing, add how to install and
// initialise it and go on (rules/codegraph-install.<lang>.md). Silent when the
// nudge is off (project.codegraph.nudge = "off").
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot, PLUGIN_ROOT } from '../../../lib/config.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'
import { findBin } from '../../../lib/codegraph.mjs'

export function codegraphRules(lang) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, 'rules', `codegraph.${lang === 'ko' ? 'ko' : 'en'}.md`), 'utf8')
}

export function codegraphInstallRules(lang) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, 'rules', `codegraph-install.${lang === 'ko' ? 'ko' : 'en'}.md`), 'utf8')
}

export function handle(input, env = process.env) {
  const resolved = resolveConfig({ projectDir: projectRoot(input.cwd || process.cwd(), env), env })
  if (resolved.errors.length || resolved.config.project?.codegraph?.nudge === 'off') return null
  const lang = resolved.effective.language
  return ctxOutput('SessionStart', findBin(env) ? codegraphRules(lang) : codegraphInstallRules(lang))
}

hookMain(import.meta, handle)
