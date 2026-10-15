// Shared ledgers under <git-common-dir>/wb/ (every worktree sees the same
// files): lanes.json (lane registry) and ports.json (lane port leases).
//
// lanes.json  { "lanes": [{ id, branch, worktree, integration, agent_id? }], "integration"? }
//             The safety hooks read branch · worktree · integration · agent_id.
// ports.json  { "version": 1, "leases": [{ lane, block, ports: { <name>: <port> }, worktree, created }] }
//
// Writers take a mkdir lock next to the file and replace the file with a
// rename, so concurrent wb commands never interleave a read-modify-write.
import fs from 'node:fs'
import path from 'node:path'

const LOCK_STALE_MS = 30_000

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function withLock(file, fn, { timeoutMs = 10_000, now = () => Date.now() } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lock = `${file}.lock`
  const start = now()
  for (;;) {
    try {
      fs.mkdirSync(lock)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        if (now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          fs.rmdirSync(lock)
          continue
        }
      } catch {}
      if (now() - start > timeoutMs) throw new Error(`lock busy: ${lock}`)
      sleepSync(25)
    }
  }
  try {
    return fn()
  } finally {
    try {
      fs.rmdirSync(lock)
    } catch {}
  }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return fallback
    throw new Error(`${file}: ${e.message}`)
  }
}

export function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

// Read, change and write one ledger under its lock. fn(data) mutates or returns new data.
export function update(file, fallback, fn) {
  return withLock(file, () => {
    const data = readJson(file, structuredClone(fallback))
    const result = fn(data)
    writeJson(file, data)
    return result
  })
}

export const lanesFile = (stateDir) => path.join(stateDir, 'lanes.json')

export function readLanes(stateDir) {
  const d = readJson(lanesFile(stateDir), { lanes: [] })
  if (!Array.isArray(d.lanes)) d.lanes = []
  return d
}

export function upsertLane(stateDir, lane) {
  const entry = { id: lane.id, branch: lane.branch, worktree: lane.worktree, integration: lane.integration }
  if (lane.agent_id) entry.agent_id = lane.agent_id
  return update(lanesFile(stateDir), { lanes: [] }, (d) => {
    if (!Array.isArray(d.lanes)) d.lanes = []
    const i = d.lanes.findIndex((l) => l.id === lane.id)
    if (i === -1) d.lanes.push(entry)
    else d.lanes[i] = { ...d.lanes[i], ...entry }
    return entry
  })
}

export function removeLane(stateDir, match) {
  return update(lanesFile(stateDir), { lanes: [] }, (d) => {
    if (!Array.isArray(d.lanes)) d.lanes = []
    const gone = d.lanes.filter((l) => match(l))
    d.lanes = d.lanes.filter((l) => !match(l))
    return gone
  })
}
