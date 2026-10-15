// Model routing: task classification, model resolution and the model check
// used by the dispatch guard.
//
// Resolution order (routing.tasks.<task>):
//   1. drop denied models            (denied always beats routing)
//   2. drop models out of quota      (limits.json; key "*" holds the whole chain)
//   3. differ_from: implementer      (drop the implementer's model; when nothing at
//                                     or above the floor is left, keep the same model
//                                     in a fresh context and say so in the report)
//   4. first remaining model whose rank is at or above the floor
//   5. none left -> do not dispatch; wait until the earliest reset and notify
import { getPath } from './config.mjs'
import { readLimits, exhaustedModels } from './limits.mjs'

// Brief template -> default task type (when a brief names a template but no type).
export const TEMPLATE_TASK = {
  impl: 'impl-multi',
  fix: 'impl-multi',
  mockup: 'mockup',
  research: 'research',
  review: 'review',
  docs: 'impl-spec',
  test: 'impl-spec',
}

// Agent definition name hints (subagent_type), first match wins.
const SUBAGENT_HINTS = [
  [/security/i, 'security'],
  [/(verif|review|critic|audit|judge)/i, 'review'],
  [/(plan|architect|analyst)/i, 'design'],
  [/(designer|mockup)/i, 'mockup'],
  [/(explore|research|search|specialist|scientist)/i, 'research'],
  [/(writer|docs?\b)/i, 'impl-spec'],
  [/(executor|debugger|test-engineer|implement|fixer)/i, 'impl-multi'],
]

// Keywords in the description (ko/en), first match wins.
const KEYWORDS = [
  [/적대|adversarial|red[- ]?team|attack/i, 'adversarial'],
  [/보안|security|vulnerab/i, 'security'],
  [/결함\s*이력|defect[- ]history/i, 'defect-history'],
  [/시안|mock-?up|wireframe/i, 'mockup'],
  [/검수|검증|판정|리뷰|review|verif|audit/i, 'review'],
  [/설계|분석|계획|아키텍처|design|architect|\bplan|root[- ]?cause/i, 'design'],
  [/치환|이름\s*변경|오탈자|형식\s*정리|rename|typo|reformat|mechanical/i, 'mechanical'],
  [/조사|탐색|찾기|위치|research|explore|search|locate|look\s*up/i, 'research'],
  [/구현|수리|수정|고침|implement|fix|refactor/i, 'impl-multi'],
  [/문서|시험\s*작성|docs?\b|documentation|tests?\b/i, 'impl-spec'],
]

// Work out the task type. Precedence: brief marker type= > marker template= >
// subagent_type hint > description keyword. Returns { type, source, matched }.
export function classify({ routing, marker = null, subagentType = '', description = '' }) {
  const tasks = routing?.tasks || {}
  const known = (t) => (t && tasks[t] ? t : null)
  const attrs = marker?.attrs || {}
  if (attrs.type) return { type: known(attrs.type), source: 'marker', matched: attrs.type, unknown: !known(attrs.type) }
  if (attrs.template && TEMPLATE_TASK[attrs.template]) {
    return { type: known(TEMPLATE_TASK[attrs.template]), source: 'template', matched: attrs.template }
  }
  for (const [re, t] of SUBAGENT_HINTS) {
    if (subagentType && re.test(subagentType) && known(t)) return { type: t, source: 'subagent', matched: subagentType }
  }
  for (const [re, t] of KEYWORDS) {
    const m = String(description || '').match(re)
    if (m && known(t)) return { type: t, source: 'keyword', matched: m[0] }
  }
  return { type: null, source: null, matched: null }
}

// Model key for an agent_param or a key ("opus", "claude-opus-…" both map to opus).
export function modelKeyFor(routing, value) {
  if (!value) return null
  const models = routing?.models || {}
  const v = String(value).toLowerCase()
  if (models[v]) return v
  for (const [k, m] of Object.entries(models)) if (String(m.agent_param).toLowerCase() === v) return k
  for (const k of Object.keys(models)) if (v.includes(k.toLowerCase())) return k
  return null
}

// Out-of-quota models with their reset time: { key: untilISO }.
export function limitsMap(file, now = Date.now()) {
  const out = {}
  if (!file) return out
  const all = readLimits(file).models
  for (const k of exhaustedModels(file, now)) out[k] = all[k].until
  return out
}

// Resolve the model for a task.
//   routing      merged routing section
//   limits       { key | "*": untilISO } (see limitsMap)
//   implementer  model key or agent_param of the implementing lane (differ_from)
export function resolveRoute(routing, taskName, { limits = {}, implementer = null } = {}) {
  const task = routing?.tasks?.[taskName]
  if (!task) return { ok: false, task: taskName, error: 'unknown-task', steps: [] }
  const models = routing.models || {}
  const rank = (k) => models[k]?.rank ?? -1
  const floorRank = rank(task.floor)
  const denied = new Set(routing.denied || [])
  const steps = []
  let remaining = [...(task.chain || [])]

  // 1. denied
  const s1 = remaining.filter((m) => denied.has(m))
  remaining = remaining.filter((m) => !denied.has(m))
  steps.push({ step: 'denied', removed: s1.map((m) => ({ model: m })) })

  // 2. limits
  const all = limits['*']
  const s2 = remaining.filter((m) => all || limits[m]).map((m) => ({ model: m, until: limits[m] || all, account: !limits[m] }))
  remaining = remaining.filter((m) => !(all || limits[m]))
  steps.push({ step: 'limits', removed: s2 })

  // 3. differ_from
  let sameAsImplementer = false
  const implKey = modelKeyFor(routing, implementer)
  if (task.differ_from === 'implementer') {
    if (!implKey) steps.push({ step: 'differ_from', removed: [], note: 'implementer-unknown' })
    else {
      const without = remaining.filter((m) => m !== implKey)
      if (without.some((m) => rank(m) >= floorRank) || !remaining.includes(implKey)) {
        steps.push({ step: 'differ_from', removed: remaining.includes(implKey) ? [{ model: implKey }] : [] })
        remaining = without
      } else {
        sameAsImplementer = true
        steps.push({ step: 'differ_from', removed: [], note: 'same-model-fresh-context', model: implKey })
      }
    }
  } else steps.push({ step: 'differ_from', removed: [] })

  // 4. floor
  const below = remaining.filter((m) => rank(m) < floorRank)
  remaining = remaining.filter((m) => rank(m) >= floorRank)
  steps.push({ step: 'floor', removed: below.map((m) => ({ model: m })) })

  const base = { task: taskName, label: task.label, floor: task.floor, chain: task.chain || [], steps, implementer: implKey }
  if (remaining.length) {
    const model = sameAsImplementer ? implKey : remaining[0]
    return {
      ok: true,
      ...base,
      model,
      agent_param: models[model].agent_param,
      rank: rank(model),
      allowed: remaining,
      sameAsImplementer,
    }
  }

  // 5. wait: earliest reset among the models that would be eligible again.
  const resets = s2.filter((r) => rank(r.model) >= floorRank).map((r) => r.until)
  const until = resets.length ? resets.sort((a, b) => Date.parse(a) - Date.parse(b))[0] : null
  return {
    ok: false,
    ...base,
    error: until ? 'wait' : 'no-model',
    on_floor: task.on_floor || 'wait-notify',
    until,
    allowed: [],
    sameAsImplementer: false,
  }
}

// Judge the model parameter of a dispatch against a resolution.
// strict: type came from a brief marker/template (floor and chain are binding);
// otherwise only denied/quota/missing block and the rest are advice.
// Returns verdicts { level: 'deny' | 'warn' | 'info', code, vars }.
export function checkModel(routing, decision, requested, { strict = true } = {}) {
  const out = []
  const models = routing.models || {}
  const denied = new Set(routing.denied || [])
  const key = modelKeyFor(routing, requested)
  const suggest = decision.ok ? decision.agent_param : null
  const soft = strict ? 'deny' : 'warn'
  if (!requested) {
    if (decision.ok) out.push({ level: 'deny', code: 'model_missing', vars: { model: suggest, task: decision.task } })
    else out.push(waitVerdict(decision))
    return out
  }
  if (!key) return [{ level: 'deny', code: 'model_unknown', vars: { model: requested, known: Object.keys(models).join(', ') } }]
  if (denied.has(key)) {
    out.push(decision.ok ? { level: 'deny', code: 'model_denied', vars: { model: key, next: suggest } } : waitVerdict(decision))
    return out
  }
  const quota = decision.steps.find((s) => s.step === 'limits')?.removed.find((r) => r.model === key)
  if (quota) {
    out.push(decision.ok ? { level: 'deny', code: 'model_exhausted', vars: { model: key, until: hhmm(quota.until), next: suggest } } : waitVerdict(decision))
    return out
  }
  if (!decision.ok) return [waitVerdict(decision)]
  if ((models[key].rank ?? -1) < (models[decision.floor]?.rank ?? -1)) {
    return [{ level: soft, code: 'below_floor', vars: { model: key, floor: decision.floor, task: decision.task, next: suggest } }]
  }
  if (decision.implementer && key === decision.implementer && !decision.sameAsImplementer && routing.tasks[decision.task]?.differ_from === 'implementer') {
    return [{ level: soft, code: 'differ_violation', vars: { model: key, next: suggest } }]
  }
  if (!decision.chain.includes(key)) {
    return [{ level: soft, code: 'off_chain', vars: { model: key, task: decision.task, chain: decision.chain.join(' > '), next: suggest } }]
  }
  if (key !== decision.model) out.push({ level: 'warn', code: 'not_first', vars: { model: key, next: suggest, task: decision.task } })
  if (decision.sameAsImplementer) out.push({ level: 'info', code: 'same_model', vars: { model: key } })
  return out
}

function waitVerdict(decision) {
  if (decision.error === 'wait') {
    return { level: 'deny', code: 'wait', vars: { task: decision.task, floor: decision.floor, until: hhmm(decision.until) }, notify: true }
  }
  return { level: 'deny', code: 'no_model', vars: { task: decision.task, chain: (decision.chain || []).join(' > ') } }
}

export function hhmm(iso) {
  if (!iso) return '?'
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Convenience: routing section from a resolved config.
export const routingOf = (resolved) => getPath(resolved.config, 'routing') || {}

// Human-readable resolution trace (lines), translated with t().
export function explainLines(decision, t) {
  const lines = []
  if (decision.error === 'unknown-task') return [t('route.unknown_task', { task: decision.task })]
  lines.push(t('route.head', { task: decision.task, chain: decision.chain.join(' > '), floor: decision.floor }))
  for (const s of decision.steps) {
    const removed = s.removed.map((r) => (r.until ? `${r.model}(${r.account ? '*' : ''}${hhmm(r.until)})` : r.model)).join(', ')
    const note = s.note ? t(`route.note.${s.note}`, { model: s.model || '' }) : ''
    lines.push(`  ${t(`route.step.${s.step}`)}: ${removed || '-'}${note ? ` — ${note}` : ''}`)
  }
  if (decision.ok) lines.push(t('route.result', { model: decision.model, param: decision.agent_param }))
  else if (decision.error === 'wait') lines.push(t('route.result_wait', { floor: decision.floor, until: hhmm(decision.until) }))
  else lines.push(t('route.result_none'))
  return lines
}
