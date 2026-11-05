// Lane ledger: waves and the lanes inside them, a metrics log, and the
// hand-over between the dispatch guard (PreToolUse) and SubagentStart/Stop.
//
// Files under <stateDir> (= <git-common-dir>/lanekeeper, shared by every worktree):
//   waves.json              { version, waves: [{ id, title, base_ref, created, lanes: [lane] }] }
//   dispatch.json           { pending: [dispatch], active: { <agent_id>: run } }
//   metrics/lanes.jsonl     one JSON object per line: start | stop | status | return
// lanes.json (worktree, branch, agent_id) belongs to lib/ledger.mjs; this module
// writes it only through upsertLane.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { update, readJson, readLanes, upsertLane } from './ledger.mjs'

export const STATUSES = ['pending', 'running', 'review', 'blocked', 'failed', 'done']
export const VERIFY_RESULTS = ['pass', 'fail', 'skip']
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const PENDING_TTL_MS = 10 * 60_000

export const wavesFile = (sd) => path.join(sd, 'waves.json')
export const dispatchFile = (sd) => path.join(sd, 'dispatch.json')
export const metricsFile = (sd) => path.join(sd, 'metrics', 'lanes.jsonl')

const nowIso = (now = Date.now()) => new Date(now).toISOString()
const EMPTY_WAVES = { version: 1, waves: [] }
const EMPTY_DISPATCH = { pending: [], active: {} }

export class LedgerError extends Error {
  constructor(code, vars = {}) {
    super(code)
    this.code = code
    this.vars = vars
  }
}

export function assertId(kind, id) {
  if (!ID_RE.test(String(id ?? ''))) throw new LedgerError('waves.bad_id', { kind, id })
}

export function readWaves(sd) {
  const d = readJson(wavesFile(sd), structuredClone(EMPTY_WAVES))
  if (!Array.isArray(d.waves)) d.waves = []
  return d
}

const mutate = (sd, fn) =>
  update(wavesFile(sd), EMPTY_WAVES, (d) => {
    if (!Array.isArray(d.waves)) d.waves = []
    return fn(d)
  })

function newLane(lane, o, now) {
  return {
    lane,
    status: 'pending',
    task: o.task || null,
    model: o.model || null,
    brief: o.brief || null,
    rounds: 0,
    returns: 0,
    todos: (o.todos || []).map((text, i) => ({ id: i + 1, text, done: false })),
    verifications: [],
    notes: [],
    history: [{ at: nowIso(now), event: 'created' }],
    tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
    created: nowIso(now),
    updated: nowIso(now),
  }
}

const findWave = (d, id) => d.waves.find((w) => w.id === id)
function need(d, wave, lane) {
  const w = findWave(d, wave)
  if (!w) throw new LedgerError('waves.no_wave', { wave })
  const l = w.lanes.find((x) => x.lane === lane)
  if (!l) throw new LedgerError('waves.no_lane', { wave, lane })
  return l
}

// The newest wave that holds the lane, preferring one that is not finished.
export function locateLane(d, lane) {
  const hits = d.waves.filter((w) => w.lanes.some((l) => l.lane === lane))
  const open = hits.filter((w) => w.lanes.find((l) => l.lane === lane).status !== 'done')
  const w = (open.length ? open : hits).at(-1)
  return w ? { wave: w, lane: w.lanes.find((l) => l.lane === lane) } : null
}

const touch = (l, event, detail, now) => {
  l.updated = nowIso(now)
  l.history.push(detail ? { at: l.updated, event, detail } : { at: l.updated, event })
}

export function initWave(sd, { id, title, base_ref }, now = Date.now()) {
  assertId('wave', id)
  return mutate(sd, (d) => {
    if (findWave(d, id)) throw new LedgerError('waves.wave_exists', { wave: id })
    const w = { id, title: title || id, base_ref: base_ref || null, created: nowIso(now), lanes: [] }
    d.waves.push(w)
    return w
  })
}

export function addLane(sd, wave, o, now = Date.now()) {
  assertId('lane', o.lane)
  return mutate(sd, (d) => {
    const w = findWave(d, wave)
    if (!w) throw new LedgerError('waves.no_wave', { wave })
    if (w.lanes.some((l) => l.lane === o.lane)) throw new LedgerError('waves.lane_exists', { wave, lane: o.lane })
    const l = newLane(o.lane, o, now)
    w.lanes.push(l)
    return l
  })
}

function logMetric(sd, rec) {
  const file = metricsFile(sd)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(rec)}\n`)
}

export function setStatus(sd, wave, lane, status, note, now = Date.now()) {
  if (!STATUSES.includes(status)) throw new LedgerError('waves.bad_status', { status, list: STATUSES.join('|') })
  const l = mutate(sd, (d) => {
    const x = need(d, wave, lane)
    const from = x.status
    x.status = status
    touch(x, 'status', note ? `${from} -> ${status}: ${note}` : `${from} -> ${status}`, now)
    return structuredClone(x)
  })
  logMetric(sd, { at: nowIso(now), event: 'status', wave, lane, status })
  return l
}

export function addTodo(sd, wave, lane, text, now = Date.now()) {
  return mutate(sd, (d) => {
    const l = need(d, wave, lane)
    const todo = { id: Math.max(0, ...l.todos.map((t) => t.id)) + 1, text, done: false }
    l.todos.push(todo)
    touch(l, 'todo', `+${todo.id}`, now)
    return todo
  })
}

export function setTodo(sd, wave, lane, id, done, now = Date.now()) {
  return mutate(sd, (d) => {
    const l = need(d, wave, lane)
    const todo = l.todos.find((t) => t.id === Number(id))
    if (!todo) throw new LedgerError('waves.no_todo', { id })
    if (done && !todo.done) todo.doneAt = nowIso(now)
    todo.done = done
    touch(l, 'todo', `${done ? 'done' : 'reopen'} ${todo.id}`, now)
    return todo
  })
}

export function addVerification(sd, wave, lane, name, result, detail, now = Date.now()) {
  if (!VERIFY_RESULTS.includes(result)) throw new LedgerError('waves.bad_result', { result })
  return mutate(sd, (d) => {
    const l = need(d, wave, lane)
    const v = { at: nowIso(now), name, result, ...(detail ? { detail } : {}) }
    l.verifications.push(v)
    touch(l, 'verify', `${name} ${result}`, now)
    return v
  })
}

export function addNote(sd, wave, lane, text, now = Date.now()) {
  return mutate(sd, (d) => {
    const l = need(d, wave, lane)
    l.notes.push({ at: nowIso(now), text })
    touch(l, 'note', null, now)
  })
}

// A reviewer sent the lane back: counts one return, the lane waits for a new dispatch.
export function addReturn(sd, wave, lane, reason, now = Date.now()) {
  const l = mutate(sd, (d) => {
    const x = need(d, wave, lane)
    x.returns += 1
    x.status = 'pending'
    touch(x, 'return', reason || null, now)
    return structuredClone(x)
  })
  logMetric(sd, { at: nowIso(now), event: 'return', wave, lane, returns: l.returns, reason: reason || null })
  return l
}

// ---------------------------------------------------------------- dispatch hand-over

const sha256 = (file) => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return null
  }
}

// Called by the dispatch guard when a subagent call is allowed.
export function recordDispatch(sd, { agent_type, lane, task, model, source, files = [] }, now = Date.now()) {
  if (!sd) return null
  const rec = {
    at: nowIso(now),
    agent_type: agent_type || 'general-purpose',
    lane: lane || null,
    task: task || null,
    model: model || null,
    source: source || null,
    briefs: files.map((f) => ({ path: f, sha256: sha256(f) })),
  }
  update(dispatchFile(sd), EMPTY_DISPATCH, (d) => {
    d.pending = (d.pending || []).filter((p) => now - Date.parse(p.at) < PENDING_TTL_MS)
    d.pending.push(rec)
  })
  return rec
}

const sumUsage = (file) => {
  const total = { input: 0, output: 0, cache_read: 0, cache_creation: 0 }
  let model = null
  let lines
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n')
  } catch {
    return { tokens: total, model }
  }
  const byId = new Map()
  let n = 0
  for (const line of lines) {
    if (!line.trim()) continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const m = o.message
    if (o.type !== 'assistant' || !m?.usage) continue
    byId.set(m.id || `anon${n++}`, m)
    if (m.model) model = m.model
  }
  for (const m of byId.values()) {
    total.input += m.usage.input_tokens || 0
    total.output += m.usage.output_tokens || 0
    total.cache_read += m.usage.cache_read_input_tokens || 0
    total.cache_creation += m.usage.cache_creation_input_tokens || 0
  }
  return { tokens: total, model }
}
export const transcriptUsage = sumUsage

export function onSubagentStart(sd, input, now = Date.now()) {
  if (!sd || !input.agent_id) return null
  const type = input.agent_type || 'general-purpose'
  let hit = null
  update(dispatchFile(sd), EMPTY_DISPATCH, (d) => {
    d.pending = (d.pending || []).filter((p) => now - Date.parse(p.at) < PENDING_TTL_MS)
    const i = d.pending.findIndex((p) => p.agent_type === type)
    if (i !== -1) [hit] = d.pending.splice(i, 1)
    d.active = d.active || {}
    d.active[input.agent_id] = { agent_type: type, started: nowIso(now), lane: hit?.lane || null, task: hit?.task || null, model: hit?.model || null, source: hit?.source || null, briefs: hit?.briefs || [] }
  })
  const lane = hit?.lane || null
  let wave = null
  if (lane) {
    mutate(sd, (d) => {
      const loc = locateLane(d, lane)
      if (!loc) return
      wave = loc.wave.id
      const l = loc.lane
      if (l.status === 'review') l.returns += 1
      l.rounds += 1
      l.status = 'running'
      if (hit.task) l.task = hit.task
      if (hit.model) l.model = hit.model
      if (hit.briefs.length) l.brief = hit.briefs[0].path
      touch(l, 'start', input.agent_id, now)
    })
    try {
      const sdLane = readLanes(sd).lanes.find((x) => x.id === lane)
      if (sdLane) upsertLane(sd, { ...sdLane, agent_id: input.agent_id })
    } catch {}
  }
  logMetric(sd, { at: nowIso(now), event: 'start', agent_id: input.agent_id, agent_type: type, session: input.session_id || null, wave, lane, task: hit?.task || null, model: hit?.model || null, classification: hit?.source || null, briefs: hit?.briefs || [] })
  return { lane, wave }
}

export function onSubagentStop(sd, input, now = Date.now()) {
  if (!sd || !input.agent_id) return null
  let run = null
  update(dispatchFile(sd), EMPTY_DISPATCH, (d) => {
    d.active = d.active || {}
    run = d.active[input.agent_id] || null
    delete d.active[input.agent_id]
  })
  const { tokens, model } = sumUsage(input.agent_transcript_path || '')
  let wave = null
  if (run?.lane) {
    mutate(sd, (d) => {
      const loc = locateLane(d, run.lane)
      if (!loc) return
      wave = loc.wave.id
      const l = loc.lane
      for (const k of Object.keys(tokens)) l.tokens[k] = (l.tokens[k] || 0) + tokens[k]
      if (l.status === 'running') l.status = 'review'
      touch(l, 'stop', input.agent_id, now)
    })
  }
  logMetric(sd, { at: nowIso(now), event: 'stop', agent_id: input.agent_id, agent_type: input.agent_type || run?.agent_type || null, wave, lane: run?.lane || null, task: run?.task || null, model: run?.model || null, actual_model: model, tokens, started: run?.started || null, tracked: Boolean(run) })
  return { lane: run?.lane || null, tokens }
}

export function readMetrics(sd) {
  try {
    return fs.readFileSync(metricsFile(sd), 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l)]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export const readDispatch = (sd) => readJson(dispatchFile(sd), structuredClone(EMPTY_DISPATCH))
