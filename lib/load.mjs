// Load tiers and orphan processes.
//
// Tiers (machine.load.tiers, resolved by config.resolveTiers) are compared with
// the load average of machine.load.sample (1 minute by default):
//   ok     load < light_only
//   light  light_only <= load < hold_new_lanes   only light task types (routing weight
//                                                "light": no test, build or install runs)
//                                                may start a new lane
//   hold   hold_new_lanes <= load < stop_heavy   new lanes (Agent dispatches) are refused
//   stop   load >= stop_heavy                    a verifier lane's heavy runs are refused too
// Slots already held are never taken back: a running test is not killed.
//
// Orphans: vite / tsx / esbuild / node … vitest / chrome --headless processes
// whose working folder or command paths point at a lane folder that is gone or
// not registered in lanes.json. They are listed by default and stopped one PID
// at a time only on request; a pattern kill is never used.
//
// Every outside dependency (load average, ps, cwd lookup, listening ports,
// kill, clock) can be passed in, so tests never touch real processes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveTiers } from './config.mjs'
import { readLanes, readJson } from './ledger.mjs'
import { parseMarker } from './brief.mjs'
import { procCwds, procListeners, isMissingBinary } from './procs.mjs'

const SAMPLE_INDEX = { '1min': 0, '5min': 1, '15min': 2 }
export const ROLES = ['executor', 'verifier']

// Load average; LANEKEEPER_LOAD_FAKE (a number) replaces it for tests and dry runs.
export function readLoad(sample = '1min', env = process.env, loadavg = os.loadavg) {
  if (env.LANEKEEPER_LOAD_FAKE !== undefined && env.LANEKEEPER_LOAD_FAKE !== '' && Number.isFinite(Number(env.LANEKEEPER_LOAD_FAKE))) return Number(env.LANEKEEPER_LOAD_FAKE)
  return loadavg()[SAMPLE_INDEX[sample] ?? 0]
}

export function loadSettings(resolved, cores) {
  const m = resolved.config.machine?.load || {}
  return {
    sample: m.sample || '1min',
    tiers: cores === undefined ? resolved.effective?.load_tiers || resolveTiers(resolved.config) : resolveTiers(resolved.config, cores),
    checkEveryMin: m.check_every_min ?? 30,
  }
}

export function tierOf(load, tiers) {
  if (!(Number.isFinite(load))) return 'ok'
  if (load >= tiers.stop_heavy) return 'stop'
  if (load >= tiers.hold_new_lanes) return 'hold'
  if (load >= (tiers.light_only ?? tiers.hold_new_lanes)) return 'light'
  return 'ok'
}

// Role written in a brief: marker attribute role=…, or a line "역할: …" / "role: …".
export function roleFromBrief(text) {
  const attr = parseMarker(text)?.attrs?.role
  if (ROLES.includes(attr)) return attr
  for (const line of String(text || '').split('\n').slice(0, 40)) {
    const m = line.match(/^\s*[-*]?\s*\**(?:역할|role)\**\s*[:：]\s*(.+)$/i)
    if (!m) continue
    if (/verifier|검수|검증/i.test(m[1])) return 'verifier'
    if (/executor|실행|구현/i.test(m[1])) return 'executor'
  }
  return null
}

// Lane of a working folder: LANEKEEPER_LANE, else the lanes.json entry whose worktree is root.
export function laneFor(stateDir, root, env = process.env) {
  const lanes = stateDir ? safeLanes(stateDir) : []
  if (env.LANEKEEPER_LANE) return lanes.find((l) => l.id === env.LANEKEEPER_LANE) || { id: env.LANEKEEPER_LANE }
  const real = realpath(root)
  return lanes.find((l) => l.worktree && realpath(l.worktree) === real) || null
}

// { role, source }: lanes.json role, else the brief recorded for the lane in
// waves.json, else executor.
export function laneRole(stateDir, lane, readFile = (f) => fs.readFileSync(f, 'utf8')) {
  if (!lane) return { role: 'executor', source: 'none' }
  if (ROLES.includes(lane.role)) return { role: lane.role, source: 'lanes' }
  if (stateDir) {
    const waves = readJson(path.join(stateDir, 'waves.json'), { waves: [] })?.waves || []
    let brief = null
    for (const w of waves) for (const l of w.lanes || []) if (l.lane === lane.id && l.brief) brief = l.brief
    if (brief) {
      try {
        const role = roleFromBrief(readFile(brief))
        if (role) return { role, source: 'brief' }
      } catch {}
    }
  }
  return { role: 'executor', source: 'default' }
}

// Dispatch side: refuse a new lane at or above hold_new_lanes.
export function holdVerdict(load, tiers) {
  return load >= tiers.hold_new_lanes ? { code: 'load_hold', vars: { load: load.toFixed(2), hold: tiers.hold_new_lanes, stop: tiers.stop_heavy } } : null
}

// Weight of a task type: routing.tasks.<type>.weight; a type without one, an
// unknown type or no type at all counts as heavy.
export function taskWeight(routing, type) {
  return type && routing?.tasks?.[type]?.weight === 'light' ? 'light' : 'heavy'
}

// Dispatch side: between light_only and hold_new_lanes only a light task may
// start a new lane.
export function lightOnlyVerdict(load, tiers, weight, task) {
  const light = tiers.light_only ?? tiers.hold_new_lanes
  if (load < light || load >= tiers.hold_new_lanes || weight === 'light') return null
  return { code: 'load_light_only', vars: { load: load.toFixed(2), light, hold: tiers.hold_new_lanes, task: task || '-' } }
}

// Slot side: refuse a verifier's heavy run at or above stop_heavy.
export function stopVerdict(load, tiers, role) {
  return role === 'verifier' && load >= tiers.stop_heavy ? { code: 'load_stop_heavy', vars: { load: load.toFixed(2), stop: tiers.stop_heavy, role } } : null
}

function safeLanes(stateDir) {
  try {
    return readLanes(stateDir).lanes
  } catch {
    return []
  }
}

function realpath(p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

// ---- orphans --------------------------------------------------------------

export const ORPHAN_RE = /(?:^|[\/\s])(?:vite|tsx|esbuild)(?:[\/\s.]|$)|\bnode\b.*vitest|chrome\b.*--headless/i

// "  123   1 /usr/bin/node /x/vite" -> [{ pid, ppid, command }]
export function parsePs(text) {
  const out = []
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/)
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] })
  }
  return out
}

// Absolute paths named in a command line (also after "--opt=").
export function commandPaths(command) {
  return [...String(command).matchAll(/(?:^|[\s='"])(\/[^\s'"]+)/g)].map((m) => m[1])
}

// lsof -F output -> Map pid -> [values of field `field`]
function parseLsof(text, field) {
  const out = new Map()
  let pid = null
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (pid && line.startsWith(field)) {
      if (!out.has(pid)) out.set(pid, [])
      out.get(pid).push(line.slice(1))
    }
  }
  return out
}

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 })
  } catch (e) {
    return isMissingBinary(e) ? null : e.stdout || ''
  }
}

export function defaultProcDeps() {
  return {
    ps: () => run('ps', ['-axo', 'pid=,ppid=,command=']),
    // pid -> cwd
    cwdOf: (pids) => {
      if (!pids.length) return new Map()
      const out = run('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')])
      if (out === null) return new Map([...procCwds()].filter(([pid]) => pids.includes(pid)))
      return new Map([...parseLsof(out, 'n')].map(([pid, v]) => [pid, v[0]]))
    },
    // pid -> [listening TCP ports]
    listeners: () => {
      const out = run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fn'])
      if (out === null) return procListeners()
      return new Map([...parseLsof(out, 'n')].map(([pid, v]) => [pid, v.map((n) => Number(n.split(':').pop())).filter(Number.isInteger)]))
    },
    exists: (p) => fs.existsSync(p),
    kill: (pid, sig) => process.kill(pid, sig),
    selfPid: process.pid,
  }
}

// Folder prefix lanes are created under, from project.git.worktree_root
// ("{repo}/../wt-{task}" -> "<parent>/wt-"), plus <repo>/.claude/worktrees/.
export function laneAreas(config, repoTop) {
  const out = [path.join(repoTop, '.claude', 'worktrees') + path.sep]
  const tpl = config.project?.git?.worktree_root
  if (typeof tpl === 'string' && tpl.includes('{task}')) {
    const head = tpl.slice(0, tpl.indexOf('{task}')).replace('{repo}', repoTop)
    const abs = path.resolve(repoTop, head)
    out.push(head.endsWith('/') ? abs + path.sep : abs)
  }
  return out
}

// Ports the owner's servers use: machine.ports.protected and the protected
// names that machine.servers[].port_ref points at.
export function protectedPortSet(config) {
  const list = (config.machine?.ports?.protected || []).filter((p) => Number.isInteger(p?.port) && p.port > 0)
  const set = new Map(list.map((p) => [p.port, p.name || String(p.port)]))
  for (const s of config.machine?.servers || []) {
    const hit = list.find((p) => p.name === s.port_ref)
    if (hit) set.set(hit.port, s.name || hit.name)
  }
  return set
}

function ancestors(pid, byPid) {
  const out = new Set()
  let cur = pid
  for (let i = 0; i < 64 && cur > 1 && !out.has(cur); i++) {
    out.add(cur)
    cur = byPid.get(cur)?.ppid ?? 0
  }
  return out
}

// Lane folder a path belongs to: the first segment under a lane area.
function laneDirOf(p, areas) {
  for (const a of areas) {
    if (!p.startsWith(a)) continue
    const rest = p.slice(a.length)
    const seg = rest.split(path.sep)[0]
    if (!seg) continue
    return a + seg
  }
  return null
}

// Candidates and exclusions.
//   opts = { lanes: [{ worktree }], areas: [prefix], protectedPorts: Map(port -> name) }
// Returns { candidates: [{ pid, command, path, reason }], excluded: [{ pid, command, path, reason, detail }] }
// reason: deleted (the folder is gone) | unregistered (a lane folder not in lanes.json)
// excluded reason: self (this session's process tree) | protected_port
export function findOrphans(opts, deps = defaultProcDeps()) {
  const procs = parsePs(deps.ps())
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const mine = ancestors(deps.selfPid, byPid)
  const matched = procs.filter((p) => ORPHAN_RE.test(p.command) && !/\blanekeeper-slot\b.*reap/.test(p.command))
  const cwds = deps.cwdOf(matched.map((p) => p.pid))
  const registered = new Set((opts.lanes || []).filter((l) => l.worktree).map((l) => path.resolve(l.worktree)))
  const areas = opts.areas || []
  let listeners = null
  const candidates = []
  const excluded = []
  for (const p of matched) {
    // The working folder counts anywhere (a gone cwd is an orphan); command
    // paths count only inside a lane area, since they may hold spaces.
    const cwd = cwds.get(p.pid)
    const paths = [cwd, ...commandPaths(p.command)].filter(Boolean)
    let hit = null
    for (const q of paths) {
      const lane = laneDirOf(q, areas)
      if (lane && registered.has(path.resolve(lane))) continue
      if (lane && !deps.exists(lane)) hit = { path: lane, reason: 'deleted' }
      else if (lane) hit = { path: lane, reason: 'unregistered' }
      else if (q === cwd && !deps.exists(q) && !registeredUnder(q, registered)) hit = { path: q, reason: 'deleted' }
      if (hit) break
    }
    if (!hit) continue
    const entry = { pid: p.pid, command: p.command, ...hit }
    if (mine.has(p.pid)) {
      excluded.push({ ...entry, reason: 'self', detail: hit.reason })
      continue
    }
    listeners ??= deps.listeners()
    const port = (listeners.get(p.pid) || []).find((x) => opts.protectedPorts?.has(x))
    if (port !== undefined) {
      excluded.push({ ...entry, reason: 'protected_port', detail: `${port} ${opts.protectedPorts.get(port)}` })
      continue
    }
    candidates.push(entry)
  }
  return { candidates, excluded }
}

const registeredUnder = (q, registered) => [...registered].some((r) => q === r || q.startsWith(r + path.sep))

// Stop the listed candidates, one PID at a time. A PID whose command changed
// since the listing (reused PID) is skipped.
export function killOrphans(candidates, deps = defaultProcDeps()) {
  const now = new Map(parsePs(deps.ps()).map((p) => [p.pid, p.command]))
  const out = []
  for (const c of candidates) {
    if (now.get(c.pid) !== c.command) {
      out.push({ pid: c.pid, result: 'gone' })
      continue
    }
    try {
      deps.kill(c.pid, 'SIGTERM')
      out.push({ pid: c.pid, result: 'killed' })
    } catch (e) {
      out.push({ pid: c.pid, result: 'error', msg: e.message })
    }
  }
  return out
}

// ---- periodic check (UserPromptSubmit) -------------------------------------

// Should the hook look again? state = { last: ms } ; everyMin 0 = never.
export function dueForCheck(state, now, everyMin) {
  if (!(everyMin > 0)) return false
  const last = Number(state?.last)
  return !Number.isFinite(last) || now - last >= everyMin * 60_000
}
