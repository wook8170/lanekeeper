// Owner grant (/wb:approve) and gate stamp files under <git-common-dir>/wb/.
//
// owner-grant.json  { version, action, ref, head, created, expires, used, used_at?, used_by? }
//   written only by the UserPromptExpansion hook when a person types
//   /wb:approve <action>; valid for one use, until expires, for exactly `head`.
// <gate_stamp>.json { head, at, command }
//   written by `wb-test-report run` / `wb-test-report gate-pass` after a full pass on a clean `head`.
// gate.lock         present while a gate run is in progress (L7); merges into
//   non-protected branches wait for it.
import fs from 'node:fs'
import path from 'node:path'
import { readJsonSafe } from './common.mjs'

export const GRANT_FILE = 'owner-grant.json'
export const GATE_LOCK = 'gate.lock'
export const ACTIONS = ['merge-main', 'push-main', 'commit-main']

export const grantPath = (stateDir) => path.join(stateDir, GRANT_FILE)
export const stampPath = (stateDir, name) => path.join(stateDir, `${name || 'wb-gate-pass'}.json`)

// -> { ok, why: 'missing'|'action'|'used'|'expired'|'head', grant }
export function checkGrant(stateDir, action, head, now) {
  if (!stateDir) return { ok: false, why: 'missing' }
  const g = readJsonSafe(grantPath(stateDir))
  if (!g || typeof g !== 'object') return { ok: false, why: 'missing' }
  if (g.action !== action) return { ok: false, why: 'action', grant: g }
  if (g.used) return { ok: false, why: 'used', grant: g }
  const exp = Date.parse(g.expires)
  if (!Number.isFinite(exp) || now >= exp) return { ok: false, why: 'expired', grant: g }
  if (!head || typeof g.head !== 'string' || g.head !== head) return { ok: false, why: 'head', grant: g }
  return { ok: true, grant: g }
}

export function consumeGrant(stateDir, usedBy, now) {
  const file = grantPath(stateDir)
  const g = readJsonSafe(file)
  if (!g) return false
  g.used = true
  g.used_at = new Date(now).toISOString()
  g.used_by = String(usedBy).slice(0, 300)
  fs.writeFileSync(file, `${JSON.stringify(g, null, 2)}\n`)
  return true
}

export function writeGrant(stateDir, { action, ref, head, ttlMin, now, session }) {
  fs.mkdirSync(stateDir, { recursive: true })
  const g = {
    version: 1,
    action,
    ref,
    head,
    created: new Date(now).toISOString(),
    expires: new Date(now + ttlMin * 60000).toISOString(),
    used: false,
    session: session || null,
  }
  fs.writeFileSync(grantPath(stateDir), `${JSON.stringify(g, null, 2)}\n`)
  return g
}

// -> { ok, why: 'missing'|'head', stamp }
// resultsOnly(stampHead) -> true when every commit after stampHead up to head only adds
// result files (the workbook of that run); the stamp then still counts.
export function checkStamp(stateDir, name, head, resultsOnly) {
  const s = stateDir ? readJsonSafe(stampPath(stateDir, name)) : null
  if (!s || typeof s.head !== 'string') return { ok: false, why: 'missing' }
  if (s.head !== head && !(resultsOnly && resultsOnly(s.head))) return { ok: false, why: 'head', stamp: s }
  return { ok: true, stamp: s }
}

export const gateLocked = (stateDir) => !!stateDir && fs.existsSync(path.join(stateDir, GATE_LOCK))
