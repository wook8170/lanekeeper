// /wb:work support: turn a one-line request into a lane flow, and show where the
// current flow stands. Nothing here dispatches an agent; the controller does that.
import fs from 'node:fs'
import path from 'node:path'
import { resolveRoute } from './route.mjs'
import { claudeDir, readJson } from './runtime.mjs'

// Request kinds, first match wins. The last entry is the default.
export const KINDS = [
  ['big-design', /새\s*제품|처음부터|전체\s*설계|새\s*도메인|아키텍처\s*전체|new product|from scratch|whole[- ]system design|greenfield/i],
  ['bug', /오류|버그|고장|안\s*(돼|되|됩니다|나와|열려)|깨졌|에러|실패|멈춰|error|bug|broken|crash|fails?\b|not working|doesn'?t work/i],
  ['ui', /화면|디자인|시안|버튼|레이아웃|\bui\b|screen|layout|button|mock-?up|design\b/i],
  ['docs', /문서|매뉴얼|도움말|readme|manual|\bdocs?\b|help text/i],
  ['research', /조사|알아봐|찾아\s*줘|어디에|어떻게\s*동작|research|find out|where is|how does/i],
  ['feature', /./],
]

// Steps per kind. `task` is the routing task type the step runs as (null = no agent).
export const FLOWS = {
  research: [
    { id: 'find', stage: 'build', task: 'research' },
    { id: 'answer', stage: 'report', task: null },
  ],
  bug: [
    { id: 'reproduce', stage: 'brief', task: 'research' },
    { id: 'fix', stage: 'build', task: 'impl-multi' },
    { id: 'review', stage: 'review', task: 'review' },
    { id: 'integrate', stage: 'integrate', task: null },
    { id: 'report', stage: 'report', task: null },
  ],
  feature: [
    { id: 'brief', stage: 'brief', task: null },
    { id: 'build', stage: 'build', task: 'impl-multi' },
    { id: 'review', stage: 'review', task: 'review' },
    { id: 'integrate', stage: 'integrate', task: null },
    { id: 'report', stage: 'report', task: null },
  ],
  ui: [
    { id: 'mockup', stage: 'brief', task: 'mockup' },
    { id: 'decide', stage: 'brief', task: null },
    { id: 'build', stage: 'build', task: 'impl-multi' },
    { id: 'review', stage: 'review', task: 'review' },
    { id: 'integrate', stage: 'integrate', task: null },
    { id: 'report', stage: 'report', task: null },
  ],
  docs: [
    { id: 'brief', stage: 'brief', task: null },
    { id: 'write', stage: 'build', task: 'impl-spec' },
    { id: 'review', stage: 'review', task: 'review' },
    { id: 'report', stage: 'report', task: null },
  ],
  'big-design': [
    { id: 'harness', stage: 'brief', task: null },
    { id: 'design', stage: 'build', task: 'design' },
    { id: 'decide', stage: 'review', task: null },
  ],
}

// Seven stages shown on the progress line.
export const STAGES = ['understand', 'brief', 'build', 'review', 'integrate', 'report', 'record']

export function classifyRequest(text) {
  const s = String(text || '')
  for (const [kind, re] of KINDS) if (re.test(s)) return kind
  return 'feature'
}

// Is a companion plugin installed? (read only; wb declares no dependency on it)
export function pluginInstalled(name, env = process.env) {
  const d = readJson(path.join(claudeDir(env), 'plugins', 'installed_plugins.json'))
  const plugins = d?.plugins || d || {}
  return Object.keys(plugins).some((k) => k === name || k.startsWith(`${name}@`))
}

// designPlugin: personal.design_plugin (name of a separate design-track plugin, empty = none set).
export function buildPlan({ request, routing, limits = {}, env = process.env, designPlugin = '' }) {
  const kind = classifyRequest(request)
  const steps = [{ id: 'understand', stage: 'understand', task: null }, ...FLOWS[kind], { id: 'record', stage: 'record', task: null }]
  const out = steps.map((s, i) => {
    const row = { n: i + 1, id: s.id, stage: s.stage, task: s.task, model: null, wait: null }
    if (s.task) {
      const d = resolveRoute(routing, s.task, { limits })
      if (d.ok) row.model = d.model
      else row.wait = d.until || null
    }
    return row
  })
  const plan = { kind, request, steps: out }
  if (kind === 'big-design') {
    const name = String(designPlugin || '').trim()
    plan.harness = !name ? 'unset' : pluginInstalled(name, env) ? 'installed' : 'missing'
    if (name) plan.design_plugin = name
  }
  return plan
}

// Where the lane flow stands, from board rows (lib/board.mjs boardRows).
export function progressFrom(rows) {
  const n = (st) => rows.filter((r) => r.status === st).length
  const c = { pending: n('pending'), running: n('running'), review: n('review'), blocked: n('blocked'), failed: n('failed'), done: n('done'), total: rows.length }
  let stage = 'understand'
  if (c.total) {
    if (c.running) stage = 'build'
    else if (c.pending || c.blocked || c.failed) stage = c.done || c.review ? 'build' : 'brief'
    else if (c.review) stage = 'review'
    else stage = 'integrate'
  }
  return { stage, index: STAGES.indexOf(stage) + 1, of: STAGES.length, counts: c, stuck: c.blocked + c.failed }
}

export function renderProgress(p, t) {
  const bar = STAGES.map((_, i) => (i < p.index ? '■' : '□')).join('')
  const head = `[${bar}] ${p.index}/${p.of} ${t(`work.stage.${p.stage}`)}`
  if (!p.counts.total) return `${head} · ${t('work.progress.nolane')}`
  const parts = []
  for (const k of ['running', 'review', 'pending', 'blocked', 'failed', 'done']) if (p.counts[k]) parts.push(t(`work.progress.${k}`, { n: p.counts[k] }))
  return `${head} · ${parts.join(' · ')}`
}
