// Machine-wide run slots for heavy commands (full test suites, builds, installs)
// and headless browsers.
//
// Layout under <lease_dir> (machine.slots.lease_dir, default ~/.lanekeeper/run/slots):
//   <kind>/slot<N>/owner.json   one directory per held slot
//   <kind>/reap.lock/           short lock taken only while reclaiming
//
// A slot is taken with mkdir (atomic). The holder writes owner.json
// { version, kind, slot, pid, lane, command, cwd, started, renewed } and
// renews it while the command runs. A slot is reclaimed when its owner pid is
// gone, when the lease has not been renewed for stale_after_min, or when the
// directory has no owner file for longer than OWNERLESS_GRACE_MS. Release is
// "rm -f owner.json; rmdir slot<N>" — never a recursive delete.
//
// Every outside dependency (clock, load average, pid check, sleep) can be
// passed in, so tests control time and load.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { homeRel } from './naming.mjs'

export const KINDS = ['heavy', 'browser']
export const OWNERLESS_GRACE_MS = 60_000
const REAP_LOCK_STALE_MS = 30_000

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

const SAMPLE_INDEX = { '1min': 0, '5min': 1, '15min': 2 }

export function defaultDeps(overrides = {}) {
  return {
    now: () => Date.now(),
    // LANEKEEPER_LOAD_FAKE (a number) replaces the load average, as in lib/load.mjs
    loadavg: (sample = '1min') => (process.env.LANEKEEPER_LOAD_FAKE && Number.isFinite(Number(process.env.LANEKEEPER_LOAD_FAKE)) ? Number(process.env.LANEKEEPER_LOAD_FAKE) : os.loadavg()[SAMPLE_INDEX[sample] ?? 0]),
    pidAlive,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    ...overrides,
  }
}

// Settings the slot code needs, taken from a resolved Lanekeeper config.
export function slotSettings(resolved, expand) {
  const m = resolved.config.machine || {}
  const s = m.slots || {}
  return {
    leaseDir: expand(homeRel(s.lease_dir || '~/.lanekeeper/run/slots')),
    counts: { heavy: s.heavy?.count ?? 2, browser: s.browser?.count ?? 2 },
    staleMs: (s.stale_after_min ?? 90) * 60_000,
    loadMax: resolved.effective.load_max,
    loadSample: m.load?.sample || '1min',
  }
}

const slotDir = (leaseDir, kind, n) => path.join(leaseDir, kind, `slot${n}`)
const ownerFile = (dir) => path.join(dir, 'owner.json')

function readOwner(dir) {
  try {
    return JSON.parse(fs.readFileSync(ownerFile(dir), 'utf8'))
  } catch {
    return null
  }
}

function writeOwner(dir, owner) {
  const tmp = path.join(dir, `.owner.${process.pid}.${Math.random().toString(36).slice(2)}`)
  fs.writeFileSync(tmp, JSON.stringify(owner))
  fs.renameSync(tmp, ownerFile(dir))
}

// Why a held slot may be reclaimed, or null when it is in use.
export function staleReason(dir, settings, deps) {
  const owner = readOwner(dir)
  const now = deps.now()
  if (!owner) {
    let mtime = now
    try {
      mtime = fs.statSync(dir).mtimeMs
    } catch {
      return null
    }
    return now - mtime > OWNERLESS_GRACE_MS ? 'no-owner' : null
  }
  if (!deps.pidAlive(owner.pid)) return 'dead-pid'
  const renewed = Date.parse(owner.renewed || owner.started)
  if (Number.isFinite(renewed) && now - renewed > settings.staleMs) return 'expired'
  return null
}

function removeSlotDir(dir) {
  // same shape as the release path: remove known files, then rmdir
  try {
    for (const f of fs.readdirSync(dir)) if (f === 'owner.json' || f.startsWith('.owner.')) fs.rmSync(path.join(dir, f), { force: true })
    fs.rmdirSync(dir)
    return true
  } catch {
    return false
  }
}

function withReapLock(kindDir, deps, fn) {
  const lock = path.join(kindDir, 'reap.lock')
  try {
    fs.mkdirSync(lock)
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    try {
      if (deps.now() - fs.statSync(lock).mtimeMs > REAP_LOCK_STALE_MS) fs.rmdirSync(lock)
    } catch {}
    return null
  }
  try {
    return fn()
  } finally {
    try {
      fs.rmdirSync(lock)
    } catch {}
  }
}

// Reclaim stale slots of one kind. Returns [{ slot, reason, owner }].
export function reapKind(kind, settings, deps = defaultDeps()) {
  const kindDir = path.join(settings.leaseDir, kind)
  if (!fs.existsSync(kindDir)) return []
  const out = []
  withReapLock(kindDir, deps, () => {
    for (const name of fs.readdirSync(kindDir)) {
      const m = /^slot(\d+)$/.exec(name)
      if (!m) continue
      const dir = path.join(kindDir, name)
      // judged again under the lock, so a slot re-taken a moment ago is left alone
      const reason = staleReason(dir, settings, deps)
      if (!reason) continue
      const owner = readOwner(dir)
      if (removeSlotDir(dir)) out.push({ kind, slot: Number(m[1]), reason, owner })
    }
  })
  return out
}

// One attempt to take a free slot of `kind`. Returns a lease or null.
export function tryAcquire(kind, settings, info = {}, deps = defaultDeps()) {
  const kindDir = path.join(settings.leaseDir, kind)
  fs.mkdirSync(kindDir, { recursive: true })
  const count = settings.counts[kind]
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 1; n <= count; n++) {
      const dir = slotDir(settings.leaseDir, kind, n)
      try {
        fs.mkdirSync(dir)
      } catch (e) {
        if (e.code === 'EEXIST') continue
        throw e
      }
      const at = new Date(deps.now()).toISOString()
      const owner = {
        version: 1,
        kind,
        slot: n,
        pid: info.pid ?? process.pid,
        lane: info.lane ?? null,
        command: String(info.command ?? '').slice(0, 300),
        cwd: info.cwd ?? process.cwd(),
        started: at,
        renewed: at,
      }
      writeOwner(dir, owner)
      return { kind, slot: n, dir, owner }
    }
    if (pass === 0 && reapKind(kind, settings, deps).length === 0) break
  }
  return null
}

export function renew(lease, deps = defaultDeps()) {
  const owner = readOwner(lease.dir)
  if (!owner || owner.pid !== lease.owner.pid || owner.started !== lease.owner.started) return false
  owner.renewed = new Date(deps.now()).toISOString()
  writeOwner(lease.dir, owner)
  return true
}

// Release only a lease we still own (a reclaimed and re-taken slot is not ours).
export function release(lease) {
  const owner = readOwner(lease.dir)
  if (owner && (owner.pid !== lease.owner.pid || owner.started !== lease.owner.started)) return false
  return removeSlotDir(lease.dir)
}

export function loadOk(settings, deps) {
  const load = deps.loadavg(settings.loadSample)
  return { ok: !(load >= settings.loadMax), load }
}

// Take every kind in `kinds` at once (all or nothing), waiting while the
// load is at or above the threshold or no slot is free.
//   opts.timeoutMs  give up after this long (null = wait forever)
//   opts.pollMs     time between attempts
//   opts.onWait     called with { reason: 'load' | 'busy', load, kind } on each wait
// Returns { leases } or { timeout: true, last }.
export async function acquire(kinds, settings, info = {}, opts = {}, deps = defaultDeps()) {
  const pollMs = opts.pollMs ?? 5000
  const start = deps.now()
  for (;;) {
    const l = loadOk(settings, deps)
    let wait
    if (!l.ok) wait = { reason: 'load', load: l.load }
    else {
      const leases = []
      for (const kind of kinds) {
        const lease = tryAcquire(kind, settings, info, deps)
        if (!lease) {
          wait = { reason: 'busy', kind, load: l.load }
          break
        }
        leases.push(lease)
      }
      if (!wait) return { leases }
      for (const lease of leases) release(lease)
    }
    if (opts.timeoutMs != null && deps.now() - start >= opts.timeoutMs) return { timeout: true, last: wait }
    opts.onWait?.(wait)
    await deps.sleep(pollMs)
  }
}

// Current holders, with a stale reason when a slot could be reclaimed.
export function status(settings, deps = defaultDeps()) {
  const out = []
  for (const kind of KINDS) {
    const kindDir = path.join(settings.leaseDir, kind)
    const held = []
    if (fs.existsSync(kindDir)) {
      for (const name of fs.readdirSync(kindDir).sort()) {
        const m = /^slot(\d+)$/.exec(name)
        if (!m) continue
        const dir = path.join(kindDir, name)
        held.push({ slot: Number(m[1]), owner: readOwner(dir), stale: staleReason(dir, settings, deps) })
      }
    }
    out.push({ kind, count: settings.counts[kind], held })
  }
  return out
}
