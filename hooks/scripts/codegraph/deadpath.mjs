#!/usr/bin/env node
// PreToolUse(mcp codegraph): stop repeated calls for a path with no index.
//
// record.mjs marks a path "dead" for the session after the first
// "not initialized" / "not loaded" response. The next codegraph call for that
// path is blocked with "no index · queued · continue with grep". Once the index
// exists (the queue finished it) the mark is cleared and calls go through.
// Not a safety guard: any error lets the call through.
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { hookMain } from '../../../lib/runtime.mjs'
import * as cg from '../../../lib/codegraph.mjs'
import { deny, formatReasons } from '../safety/common.mjs'

export function judgeDead(input, env = process.env) {
  if (!cg.isCodegraphTool(input.tool_name)) return null
  const sid = input.session_id || 'global'
  const state = cg.loadSession(sid, env)
  const key = cg.callPath(input)
  if (!Object.hasOwn(state.dead, key)) return null
  const cwd = input.cwd || process.cwd()
  const dir = key || projectRoot(cwd, env)
  if (cg.hasIndex(dir)) {
    delete state.dead[key]
    cg.saveSession(sid, state, env)
    return null
  }
  const top = cg.checkoutOf(dir)
  const queued = Boolean(top) && cg.readQueue(env).items.some((i) => i.path === top)
  const resolved = resolveConfig({ projectDir: projectRoot(cwd, env), env })
  return { code: queued ? 'codegraph.no_index' : 'codegraph.no_index_manual', vars: { path: dir }, language: resolved.effective.language }
}

export function handle(input, env = process.env) {
  const r = judgeDead(input, env)
  if (!r) return null
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: formatReasons(r.language, [deny(r.code, r.vars)]),
    },
  }
}

hookMain(import.meta, handle)
