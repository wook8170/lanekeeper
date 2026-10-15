#!/usr/bin/env node
// SubagentStart / SubagentStop: bind the agent to its lane (agent_id, model,
// task, brief hashes recorded by the dispatch guard), count rounds, returns and
// tokens, and append to the metrics log. Not a safety hook: errors let the
// session continue.
import { projectRoot, stateDir } from '../../../lib/config.mjs'
import { onSubagentStart, onSubagentStop } from '../../../lib/waves.mjs'
import { hookMain } from '../../../lib/runtime.mjs'

export function handle(input, env = process.env, overrides = {}) {
  const sd = overrides.stateDir !== undefined ? overrides.stateDir : stateDir(projectRoot(input.cwd || process.cwd(), env))
  if (!sd) return null
  const ev = input.hook_event_name
  if (ev === 'SubagentStart') onSubagentStart(sd, input)
  else if (ev === 'SubagentStop') onSubagentStop(sd, input)
  return null
}

hookMain(import.meta, handle)
