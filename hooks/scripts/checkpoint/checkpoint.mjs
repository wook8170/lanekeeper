#!/usr/bin/env node
// StopFailure / SubagentStop / PreCompact: commit work in progress on lane branches.
import { resolveConfig, projectRoot, getPath } from '../../../lib/config.mjs'
import { checkpointDir, checkpointTargets } from '../../../lib/checkpoint.mjs'
import { hookMain } from '../../../lib/runtime.mjs'

export function handle(input, env = process.env) {
  const root = projectRoot(input.cwd || process.cwd(), env)
  const resolved = resolveConfig({ projectDir: root, env })
  if (resolved.errors.length || getPath(resolved.config, 'personal.checkpoint.enabled') === false) return null
  const results = checkpointTargets(input, root).map((d) => checkpointDir(d, resolved, input.hook_event_name || 'event'))
  return results.some((r) => r.committed) ? { systemMessage: `[wb] checkpoint ${results.filter((r) => r.committed).map((r) => `${r.branch}@${r.head}`).join(', ')}` } : null
}

hookMain(import.meta, handle)
