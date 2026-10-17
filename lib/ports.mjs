// Lane port bands and their lease ledger.
//
// machine.ports.lane_range = { base, step, per_lane: [names], max_lanes }
// Block b (0-based) holds per_lane[i] -> base + b*step + i. A lane leases one
// whole block. A block is skipped when it holds a protected port
// (machine.ports.protected), is leased by another lane whose worktree still
// exists, or has a port somebody is already listening on.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { update, readJson } from './ledger.mjs'
import { procListenPorts, isMissingBinary } from './procs.mjs'

export function portsFile(config, stateDir) {
  const tpl = config.machine?.ports?.leases || '{git_common_dir}/wb/ports.json'
  if (tpl.includes('{git_common_dir}/wb')) return tpl.replace('{git_common_dir}/wb', stateDir)
  return tpl.replace('{git_common_dir}', path.dirname(stateDir))
}

export function laneRange(config) {
  const r = config.machine?.ports?.lane_range || {}
  return { base: r.base ?? 41000, step: r.step ?? 20, names: r.per_lane || ['web'], max: r.max_lanes ?? 9 }
}

export const protectedPorts = (config) => (config.machine?.ports?.protected || []).filter((p) => p.port > 0)

export function blockPorts(range, block) {
  const ports = {}
  range.names.forEach((n, i) => (ports[n] = range.base + block * range.step + i))
  return ports
}

// Problems in the range itself (reported by wb-port check / doctor).
export function rangeProblems(config) {
  const range = laneRange(config)
  const out = []
  if (range.step < range.names.length) out.push({ code: 'overlap', step: range.step, names: range.names.length })
  const last = range.base + (range.max - 1) * range.step + range.names.length - 1
  if (last > 65535) out.push({ code: 'too-high', last })
  const prot = new Set(protectedPorts(config).map((p) => p.port))
  for (let b = 0; b < range.max; b++) {
    for (const [name, port] of Object.entries(blockPorts(range, b))) if (prot.has(port)) out.push({ code: 'protected', block: b, name, port })
  }
  return out
}

export function realListening() {
  try {
    const out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 })
    const ports = new Set()
    for (const line of out.split('\n')) {
      const m = /^n.*:(\d+)$/.exec(line)
      if (m) ports.add(Number(m[1]))
    }
    return ports
  } catch (e) {
    return isMissingBinary(e) ? procListenPorts() : new Set()
  }
}

const liveLease = (l) => !l.worktree || fs.existsSync(l.worktree)

// Lease (or return the existing lease of) a block for `lane`.
// deps.listening() -> Set of ports in use; deps.now() -> ms.
export function leaseLane(file, config, { lane, worktree }, deps = {}) {
  const listening = deps.listening || realListening
  const now = deps.now || (() => Date.now())
  const range = laneRange(config)
  const prot = new Set(protectedPorts(config).map((p) => p.port))
  const busy = listening() // outside the lock: lsof can take a while
  return update(file, { version: 1, leases: [] }, (d) => {
    if (!Array.isArray(d.leases)) d.leases = []
    const mine = d.leases.find((l) => l.lane === lane)
    if (mine) {
      if (worktree) mine.worktree = worktree
      return { ...mine, reused: true }
    }
    // a lease whose worktree is gone is free again
    d.leases = d.leases.filter(liveLease)
    const taken = new Set(d.leases.map((l) => l.block))
    const skipped = []
    for (let b = 0; b < range.max; b++) {
      if (taken.has(b)) continue
      const ports = blockPorts(range, b)
      const values = Object.values(ports)
      const p = values.find((x) => prot.has(x))
      if (p) {
        skipped.push({ block: b, reason: 'protected', port: p })
        continue
      }
      const u = values.find((x) => busy.has(x))
      if (u) {
        skipped.push({ block: b, reason: 'listening', port: u })
        continue
      }
      const lease = { lane, block: b, ports, worktree: worktree || null, created: new Date(now()).toISOString() }
      d.leases.push(lease)
      return { ...lease, skipped }
    }
    return { error: 'full', skipped, max: range.max }
  })
}

export function releaseLane(file, lane) {
  if (!fs.existsSync(file)) return []
  return update(file, { version: 1, leases: [] }, (d) => {
    if (!Array.isArray(d.leases)) d.leases = []
    const gone = d.leases.filter((l) => l.lane === lane)
    d.leases = d.leases.filter((l) => l.lane !== lane)
    return gone
  })
}

// Drop leases whose worktree no longer exists.
export function reapLeases(file) {
  if (!fs.existsSync(file)) return []
  return update(file, { version: 1, leases: [] }, (d) => {
    if (!Array.isArray(d.leases)) d.leases = []
    const gone = d.leases.filter((l) => !liveLease(l))
    d.leases = d.leases.filter(liveLease)
    return gone
  })
}

export function readLeases(file) {
  const d = readJson(file, { version: 1, leases: [] })
  return Array.isArray(d.leases) ? d.leases : []
}

// Port by name: "<protected name>" or "lane.<name>" (needs lane).
export function lookup(config, file, name, lane) {
  if (name.startsWith('lane.')) {
    if (!lane) return { error: 'no-lane' }
    const lease = readLeases(file).find((l) => l.lane === lane)
    if (!lease) return { error: 'no-lease', lane }
    const port = lease.ports[name.slice(5)]
    return port ? { port } : { error: 'unknown-name', name }
  }
  const p = protectedPorts(config).find((x) => x.name === name)
  return p ? { port: p.port } : { error: 'unknown-name', name }
}
