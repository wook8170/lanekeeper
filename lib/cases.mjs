// Test case ledger (<module>.cases.json) and defect register (defect-register.json)
// in the project's e2e ledger folder (paths.e2e_ledger).
//
// Cases:   { version, module, prefix, retired_ids: [], cases: [{ id, title, priority, role?, steps[], expected, status, defect? }] }
// Defects: { version, defects: [{ id, title, severity, status, case_ids[], found, fixed?, lane?, note? }] }
// Ids are never reused: a removed case keeps its id in retired_ids, a defect is never deleted.
import fs from 'node:fs'
import path from 'node:path'
import { update, readJson } from './ledger.mjs'
import { PLUGIN_ROOT } from './config.mjs'
import { LedgerError } from './waves.mjs'

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3']
export const CASE_STATUSES = ['active', 'fixme']
export const SEVERITIES = ['critical', 'high', 'medium', 'low']
export const DEFECT_STATUSES = ['open', 'fixed', 'wontfix']
const MODULE_RE = /^[a-z0-9][a-z0-9-]{0,40}$/
const ISO = (now) => new Date(now).toISOString()

export const casesFile = (dir, module) => path.join(dir, `${module}.cases.json`)
export const defectsFile = (dir) => path.join(dir, 'defect-register.json')
const template = (name) => fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'test-cases', name), 'utf8')
const idNum = (id, prefix) => {
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id)
  return m ? Number(m[1]) : 0
}

export function listModules(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.cases.json')).map((f) => f.slice(0, -'.cases.json'.length)).sort()
  } catch {
    return []
  }
}

export function initCases(dir, module, { prefix } = {}) {
  if (!MODULE_RE.test(module || '')) throw new LedgerError('cases.bad_module', { module })
  const file = casesFile(dir, module)
  if (fs.existsSync(file)) throw new LedgerError('cases.exists', { file })
  const pre = (prefix || module.replace(/-/g, '').slice(0, 6)).toUpperCase()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, template('cases.json').replace('{{module}}', module).replace('{{prefix}}', pre))
  return { file, prefix: pre }
}

export function readCases(dir, module) {
  const d = readJson(casesFile(dir, module), null)
  if (!d) throw new LedgerError('cases.no_module', { module, file: casesFile(dir, module) })
  return d
}

export function addCase(dir, module, c) {
  const file = casesFile(dir, module)
  readCases(dir, module)
  return update(file, {}, (d) => {
    const next = Math.max(0, ...d.cases.map((x) => idNum(x.id, d.prefix)), ...d.retired_ids.map((x) => idNum(x, d.prefix))) + 1
    const pr = c.priority || 'P2'
    if (!PRIORITIES.includes(pr)) throw new LedgerError('cases.bad_priority', { priority: pr })
    if (!c.title || !c.expected) throw new LedgerError('cases.missing_field', { field: !c.title ? 'title' : 'expected' })
    const rec = { id: `${d.prefix}-${String(next).padStart(3, '0')}`, title: c.title, priority: pr, ...(c.role ? { role: c.role } : {}), steps: c.steps || [], expected: c.expected, status: 'active' }
    d.cases.push(rec)
    return rec
  })
}

export function retireCase(dir, module, id) {
  return update(casesFile(dir, module), {}, (d) => {
    const i = d.cases.findIndex((x) => x.id === id)
    if (i === -1) throw new LedgerError('cases.no_case', { id })
    const [gone] = d.cases.splice(i, 1)
    d.retired_ids.push(id)
    return gone
  })
}

export function setCase(dir, module, id, { status, defect }) {
  if (status && !CASE_STATUSES.includes(status)) throw new LedgerError('cases.bad_status', { status })
  return update(casesFile(dir, module), {}, (d) => {
    const c = d.cases.find((x) => x.id === id)
    if (!c) throw new LedgerError('cases.no_case', { id })
    if (status) c.status = status
    if (defect) c.defect = defect
    if (c.status === 'active') delete c.defect
    return c
  })
}

export function readDefects(dir) {
  const d = readJson(defectsFile(dir), { version: 1, defects: [] })
  if (!Array.isArray(d.defects)) d.defects = []
  return d
}

export function addDefect(dir, o, now = Date.now()) {
  const sev = o.severity || 'medium'
  if (!SEVERITIES.includes(sev)) throw new LedgerError('defects.bad_severity', { severity: sev })
  if (!o.title) throw new LedgerError('cases.missing_field', { field: 'title' })
  fs.mkdirSync(dir, { recursive: true })
  const file = defectsFile(dir)
  if (!fs.existsSync(file)) fs.writeFileSync(file, template('defect-register.json'))
  return update(file, { version: 1, defects: [] }, (d) => {
    const next = Math.max(0, ...d.defects.map((x) => Number(/^D-(\d+)$/.exec(x.id)?.[1] || 0))) + 1
    const rec = { id: `D-${String(next).padStart(3, '0')}`, title: o.title, severity: sev, status: 'open', case_ids: o.cases || [], found: ISO(now), ...(o.lane ? { lane: o.lane } : {}), ...(o.note ? { note: o.note } : {}) }
    d.defects.push(rec)
    return rec
  })
}

export function resolveDefect(dir, id, { status = 'fixed', note } = {}, now = Date.now()) {
  if (!DEFECT_STATUSES.includes(status) || status === 'open') throw new LedgerError('defects.bad_status', { status })
  return update(defectsFile(dir), { version: 1, defects: [] }, (d) => {
    const x = d.defects.find((y) => y.id === id)
    if (!x) throw new LedgerError('defects.no_defect', { id })
    x.status = status
    x.fixed = ISO(now)
    if (note) x.note = note
    return x
  })
}

// Consistency of one directory: case fields, id reuse, fixme <-> defect links.
export function checkLedger(dir) {
  const problems = []
  const defects = readDefects(dir).defects
  const ids = new Set()
  const prefixes = new Map()
  for (const module of listModules(dir)) {
    let d
    try {
      d = readCases(dir, module)
    } catch (e) {
      problems.push({ code: 'unreadable', vars: { module, msg: e.message } })
      continue
    }
    if (prefixes.has(d.prefix)) problems.push({ code: 'prefix_shared', vars: { prefix: d.prefix, modules: `${prefixes.get(d.prefix)}, ${module}` } })
    prefixes.set(d.prefix, module)
    const retired = new Set(d.retired_ids || [])
    for (const c of d.cases) {
      const at = { module, id: c.id }
      if (ids.has(c.id)) problems.push({ code: 'duplicate_id', vars: at })
      ids.add(c.id)
      if (idNum(c.id, d.prefix) === 0) problems.push({ code: 'bad_id', vars: { ...at, prefix: d.prefix } })
      if (retired.has(c.id)) problems.push({ code: 'reused_id', vars: at })
      for (const f of ['title', 'expected']) if (!c[f]) problems.push({ code: 'missing_field', vars: { ...at, field: f } })
      if (!PRIORITIES.includes(c.priority)) problems.push({ code: 'bad_priority', vars: { ...at, priority: c.priority ?? '-' } })
      if (!Array.isArray(c.steps)) problems.push({ code: 'missing_field', vars: { ...at, field: 'steps' } })
      if (c.status === 'fixme') {
        const df = defects.find((x) => x.id === c.defect)
        if (!c.defect) problems.push({ code: 'fixme_no_defect', vars: at })
        else if (!df) problems.push({ code: 'defect_unknown', vars: { ...at, defect: c.defect } })
        else if (df.status !== 'open') problems.push({ code: 'fixme_defect_closed', vars: { ...at, defect: c.defect } })
      } else if (c.status !== 'active') problems.push({ code: 'bad_status', vars: { ...at, status: c.status ?? '-' } })
    }
  }
  for (const x of defects) for (const cid of x.case_ids || []) if (!ids.has(cid)) problems.push({ code: 'defect_case_unknown', vars: { defect: x.id, id: cid } })
  return problems
}
