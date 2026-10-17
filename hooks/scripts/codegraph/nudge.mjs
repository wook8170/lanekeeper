#!/usr/bin/env node
// PreToolUse(Bash · Grep): codegraph nudge.
//
// A grep/rg for a single identifier in a checkout that has a codegraph index
// gets one note per session: callers come back from codegraph_callers with the
// enclosing function; grep stays the tool for line numbers and strings. grep is
// never blocked (text search is needed to finish most answers).
// A grep in a checkout without an index adds that checkout to the index queue
// instead (no note). Turn the note off with project.codegraph.nudge = "off".
// Not a safety guard: any error lets the call through.
import path from 'node:path'
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'
import * as cg from '../../../lib/codegraph.mjs'
import { parse, resolvePath } from '../safety/shell.mjs'

const MAX_PATHS = 5

function searches(input, env) {
  const cwd = input.cwd || process.cwd()
  if (input.tool_name === 'Grep') {
    const ti = input.tool_input || {}
    return [{ pattern: ti.pattern, paths: [ti.path ? path.resolve(cwd, String(ti.path)) : cwd] }]
  }
  if (input.tool_name !== 'Bash') return []
  const command = String(input.tool_input?.command || '')
  if (!/\b(grep|egrep|fgrep|rg)\b/.test(command)) return []
  const out = []
  for (const c of parse(command, { cwd, home: env.HOME || '' })) {
    const g = cg.grepCall(c)
    if (!g) continue
    const paths = g.paths.length ? g.paths.map((p) => resolvePath(c.cwd || cwd, p, env.HOME || '')) : [c.cwd || cwd]
    out.push({ pattern: g.pattern, paths })
  }
  return out
}

export function judgeNudge(input, env = process.env, { queue = cg.autoQueue } = {}) {
  const list = searches(input, env)
  if (!list.length || !cg.findBin(env)) return null
  const cwd = input.cwd || process.cwd()
  const resolved = resolveConfig({ projectDir: projectRoot(cwd, env), env })
  if (resolved.errors.length) return null
  const config = resolved.config
  const nudge = config.project?.codegraph?.nudge !== 'off'
  const sid = input.session_id || 'global'
  const state = cg.loadSession(sid, env)
  let changed = false
  let note = null
  const tops = new Map()
  for (const s of list) {
    const ident = cg.identifierOf(s.pattern)
    const dirs = [...new Set(s.paths.map((p) => p.replace(/[*?[].*$/, '') || '/'))].slice(0, MAX_PATHS)
    for (const d of dirs) {
      if (!tops.has(d)) tops.set(d, cg.checkoutOf(d))
      const top = tops.get(d)
      if (!top) continue
      if (cg.hasIndex(top)) {
        if (ident && nudge && !state.nudged && !note) {
          note = { ident, root: top }
          state.nudged = true
          changed = true
        }
      } else if (!state.queued.includes(top)) {
        queue(top, { reason: 'grep', config, env })
        state.queued.push(top)
        changed = true
      }
    }
  }
  if (changed) cg.saveSession(sid, state, env)
  return note ? { ...note, language: resolved.effective.language } : null
}

export function handle(input, env = process.env) {
  const r = judgeNudge(input, env)
  if (!r) return null
  return ctxOutput('PreToolUse', `[wb] ${translator(r.language)('cg.nudge', r)}`)
}

hookMain(import.meta, handle)
