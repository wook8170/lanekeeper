#!/usr/bin/env node
// PreToolUse(Agent|Task) dispatch guard.
//
// Checks a subagent dispatch before it starts:
//   - brief: marker, six required sections, headless / no-full-suite / base-commit
//     statements, no unfilled {{placeholders}}         (project.dispatch.brief: deny|warn|off)
//   - model: missing, unknown, denied, out of quota, below the task floor, outside the
//     task chain, same as the implementer for differ_from tasks, not the first choice
//   - lanes: a new lane while lanes.json already holds machine.lanes.max lanes
//   - nothing left above the floor: block, notify, wait until the reset time
// Not a safety hook: internal errors let the call through (fail-open) with a note.
import os from 'node:os'
import path from 'node:path'
import { resolveConfig, projectRoot, stateDir, getPath } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { hookMain, notify, readJson, limitsFile } from '../../../lib/runtime.mjs'
import { classify, resolveRoute, checkModel, modelKeyFor, limitsMap } from '../../../lib/route.mjs'
import { checkBrief, collectBrief } from '../../../lib/brief.mjs'
import { recordDispatch } from '../../../lib/waves.mjs'

const RANK = { info: 0, warn: 1, deny: 2 }

export function evaluate(input, env = process.env, overrides = {}) {
  const tool = input.tool_name
  if (tool !== 'Agent' && tool !== 'Task') return null
  const ti = input.tool_input || {}
  const cwd = input.cwd || process.cwd()
  const root = overrides.projectRoot || projectRoot(cwd, env)
  const resolved = overrides.resolved || resolveConfig({ projectDir: root, env })
  const cfg = resolved.config
  const routing = getPath(cfg, 'routing') || {}
  const dispatch = getPath(cfg, 'project.dispatch') || {}
  const mode = dispatch.brief || 'deny'
  const subagent = String(ti.subagent_type || '')
  const exempt = (dispatch.exempt_agents || []).some((a) => a.toLowerCase() === subagent.toLowerCase())
  const fork = subagent.toLowerCase() === 'fork'
  const verdicts = []

  if (resolved.errors?.length) {
    const e = resolved.errors[0]
    verdicts.push({ level: 'warn', code: 'config_error', vars: { file: e.file || '', key: e.path, msg: e.msg } })
  }

  // Brief
  const brief = collectBrief(ti.prompt, { cwd, projectRoot: root, home: env.HOME || os.homedir() })
  if (!exempt && mode !== 'off') {
    const r = checkBrief(brief.text)
    const level = mode === 'deny' ? 'deny' : 'warn'
    if (r.missing.includes('marker')) verdicts.push({ level, code: 'brief_missing', vars: {} })
    else if (r.missing.length) verdicts.push({ level, code: 'brief_incomplete', vars: { items: r.missing } })
    if (r.placeholder) verdicts.push({ level, code: 'brief_placeholder', vars: { name: r.placeholder } })
  }

  // Model
  let decision = null
  const cls = classify({ routing, marker: brief.marker, subagentType: subagent, description: ti.description })
  const requested = ti.model || null
  if (!fork) {
    if (cls.unknown) verdicts.push({ level: 'deny', code: 'type_unknown', vars: { type: cls.matched, known: Object.keys(routing.tasks || {}).join(', ') } })
    else if (!cls.type) {
      const key = modelKeyFor(routing, requested)
      if (requested && key && (routing.denied || []).includes(key)) verdicts.push({ level: 'deny', code: 'model_denied', vars: { model: key, next: '-' } })
      else if (!requested && !exempt) verdicts.push({ level: 'deny', code: 'type_missing', vars: { known: Object.keys(routing.tasks || {}).join(', ') } })
    } else if (!(exempt && !requested)) {
      const lf = overrides.limitsFile || limitsFile(resolved, env)
      const limits = limitsMap(lf, overrides.now)
      decision = resolveRoute(routing, cls.type, { limits, implementer: brief.marker?.attrs?.implementer || null })
      const strict = cls.source === 'marker' || cls.source === 'template'
      for (const v of checkModel(routing, decision, requested, { strict: strict && !exempt })) verdicts.push(v)
    }
  }

  // Lanes
  const lane = brief.marker?.attrs?.lane
  const sd = overrides.stateDir !== undefined ? overrides.stateDir : stateDir(root)
  const max = getPath(cfg, 'machine.lanes.max')
  if (lane && sd && max) {
    const lanes = readJson(path.join(sd, 'lanes.json'))?.lanes || []
    if (!lanes.some((l) => l.id === lane) && lanes.length >= max) {
      verdicts.push({ level: 'deny', code: 'lanes_full', vars: { count: lanes.length, max, lane } })
    }
  }

  const level = verdicts.reduce((a, v) => (RANK[v.level] > RANK[a] ? v.level : a), 'info')
  return { level, verdicts, decision, classification: cls, stateDir: sd || null, agentType: subagent, lane: lane || null, brief: { files: brief.files, marker: brief.marker }, language: resolved.effective?.language || 'en' }
}

export function format(lang, verdicts, decision) {
  const t = translator(lang)
  const lines = []
  for (const v of verdicts) {
    const vars = { ...v.vars }
    if (Array.isArray(vars.items)) vars.items = vars.items.map((i) => t(`brief.item.${i}`)).join(', ')
    const head = v.level === 'deny' ? t('safety.blocked') : v.level === 'warn' ? t('dispatch.warn') : t('dispatch.note')
    lines.push(`${head}: ${t(`dispatch.${v.code}.why`, vars)}`)
    const fix = t(`dispatch.${v.code}.fix`, vars)
    if (fix && fix !== `dispatch.${v.code}.fix`) lines.push(`${t('safety.fix')}: ${fix}`)
  }
  if (decision?.ok) lines.push(t('dispatch.route', { task: decision.task, model: decision.agent_param }))
  if (verdicts.some((v) => v.level === 'deny')) lines.push(`${t('safety.help')}: ${t('dispatch.where')}`)
  return `[wb] ${lines.join('\n')}`
}

export function handle(input, env = process.env, overrides = {}) {
  const r = evaluate(input, env, overrides)
  // Allowed dispatches are remembered so SubagentStart can bind agent_id to the lane.
  if (r && r.level !== 'deny' && r.stateDir) {
    try {
      recordDispatch(r.stateDir, { agent_type: r.agentType, lane: r.lane, task: r.decision?.task || r.classification?.type, model: r.decision?.agent_param || input.tool_input?.model, source: r.classification?.source, files: r.brief.files })
    } catch {}
  }
  if (!r || !r.verdicts.length) return null
  const text = format(r.language, r.verdicts, r.decision)
  const wait = r.verdicts.find((v) => v.notify && v.level === 'deny')
  if (wait) {
    const t = translator(r.language)
    ;(overrides.notify || notify)(t('dispatch.notify.title'), t('dispatch.wait.why', wait.vars), { env })
  }
  if (r.level === 'deny') {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text } }
  }
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }
}

hookMain(import.meta, (input, env) => handle(input, env))
