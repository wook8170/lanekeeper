#!/usr/bin/env node
// PostToolUse · PostToolUseFailure(mcp codegraph): record every codegraph
// response as ok · empty · not_initialized · no_project · error in
// <main checkout>/<paths.metrics>/codegraph.jsonl (`lanekeeper-index metrics` sums it).
//
// A "not initialized" / "not loaded" response also marks the path dead for
// this session (deadpath.mjs blocks the next call), queues the checkout for
// indexing and tells Claude right away to continue with grep.
// Never blocks; any error is ignored.
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'
import * as cg from '../../../lib/codegraph.mjs'

export function recordCall(input, env = process.env, { queue = cg.autoQueue, now = () => Date.now() } = {}) {
  if (!cg.isCodegraphTool(input.tool_name)) return null
  const failed = input.hook_event_name === 'PostToolUseFailure' || input.error != null
  const resp = input.tool_response
  const text = failed ? cg.responseText(input.error) : cg.responseText(resp)
  const isError = failed || resp?.isError === true || resp?.is_error === true
  const { cls, stale } = cg.classify(text, isError)
  const cwd = input.cwd || process.cwd()
  const resolved = resolveConfig({ projectDir: projectRoot(cwd, env), env })
  const config = resolved.config
  const key = cg.callPath(input, text)
  const sid = input.session_id || 'global'
  const row = {
    ts: new Date(now()).toISOString(),
    session: sid,
    agent: input.agent_id || null,
    tool: cg.toolShort(input.tool_name),
    path: key || null,
    project_path: Boolean(input.tool_input?.projectPath),
    class: cls,
    stale: Boolean(stale),
  }
  try {
    cg.appendMetric(cwd, config, row)
  } catch {}
  const state = cg.loadSession(sid, env)
  let notice = null
  if (cls === 'not_initialized' || cls === 'no_project') {
    state.dead[key] = row.ts
    const dir = key || projectRoot(cwd, env)
    let queued = false
    if (cg.findBin(env)) {
      const r = queue(dir, { reason: 'codegraph-miss', config, env })
      queued = Boolean(r.queued || r.skipped === 'already')
      if (r.path && !state.queued.includes(r.path)) state.queued.push(r.path)
    }
    notice = { path: dir, queued }
    cg.saveSession(sid, state, env)
  } else if ((cls === 'ok' || cls === 'empty') && Object.hasOwn(state.dead, key)) {
    delete state.dead[key]
    cg.saveSession(sid, state, env)
  }
  return { row, notice, language: resolved.effective.language }
}

export function handle(input, env = process.env) {
  const r = recordCall(input, env)
  if (!r?.notice) return null
  const t = translator(r.language)
  const event = input.hook_event_name === 'PostToolUseFailure' ? 'PostToolUseFailure' : 'PostToolUse'
  return ctxOutput(event, `[lanekeeper] ${t('cg.dead_notice', { path: r.notice.path, queued: r.notice.queued ? t('cg.dead_queued') : '' })}`)
}

hookMain(import.meta, handle)
