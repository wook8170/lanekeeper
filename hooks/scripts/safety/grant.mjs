// Owner grant (/lanekeeper:approve) and gate stamp files under <git-common-dir>/lanekeeper/.
//
// owner-grant.json  { version, action, ref, head, dest?, remote?, remoteUrl?, index?, created, expires, used, via, used_at?, used_by? }
//   written by two routes: the UserPromptExpansion hook when a person types /lanekeeper:approve <action>
//   (via: slash), and lanekeeper-grant with the ticket of a confirmation dialog (via: dialog, see
//   owner-dialog.mjs). Valid for one use, until expires, for exactly `head`. A commit-main grant made
//   before the repository has a commit carries unbornHead(branch) as its `head`. merge-main and
//   push-main name the protected branch they land on in `dest`. push-main also holds the address it
//   goes to in `remoteUrl`, with credentials removed. commit-main holds the tree of the staged
//   content in `index`. A grant without the field its action needs matches nothing.
// <gate_stamp>.json { head, at, command }
//   written by `lanekeeper-test-report run` / `lanekeeper-test-report gate-pass` after a full pass on a clean `head`.
// gate.lock         present while a gate run is in progress (L7); merges into
//   non-protected branches wait for it.
import fs from 'node:fs'
import path from 'node:path'
import { readJsonSafe } from './common.mjs'
import { LEGACY_GATE_STAMP } from '../../../lib/naming.mjs'

export const GRANT_FILE = 'owner-grant.json'
export const GATE_LOCK = 'gate.lock'
export const ACTIONS = ['merge-main', 'push-main', 'commit-main']
export const OWNER_ACTIONS = ['accept-quality <kind> --reason <why>', 'retry-bypass', 'clear-gate-lock']

export const grantPath = (stateDir) => path.join(stateDir, GRANT_FILE)
export const stampPath = (stateDir, name) => path.join(stateDir, `${name || 'lanekeeper-gate-pass'}.json`)

// A real commit id is hexadecimal, so this never equals one. git-guard compares against it only while
// the repository really has no commit, so the first commit ends the grant by a `head` mismatch.
const UNBORN = 'unborn:'
export const unbornHead = (branch) => `${UNBORN}${branch}`
export const isUnborn = (head) => String(head).startsWith(UNBORN)
export const shortHead = (head) => (isUnborn(head) ? String(head) : String(head).slice(0, 9))

// A remote address fit to show and compare: no user, password, token or query, no .git or final slash.
// http, https and ssh to one server path come out the same, as host/path, and the path keeps its case.
// In the host:path form a path without a leading slash starts at the login home, so it is another
// place than host/path: it comes out as host/~/path, the same as ssh://host/~/path.
export function cleanRemoteUrl(url) {
  let s = String(url ?? '').trim().replace(/[?#].*$/, '')
  const full = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/]*@)?([^/]*)(.*)$/i.exec(s)
  const short = /^(?:[^/:@]+(?::[^/@]*)?@)?([^/:]+):(?!\/\/)(.+)$/.exec(s)
  if (full) s = `${/^(https?|ssh|git|git\+ssh)$/i.test(full[1]) ? '' : `${full[1].toLowerCase()}://`}${full[2].toLowerCase()}${full[3]}`
  else if (short) s = `${short[1].toLowerCase()}/${short[2].startsWith('/') ? short[2].replace(/^\/+/, '') : short[2].startsWith('~') ? short[2] : `~/${short[2]}`}`
  return s.replace(/\/+$/, '').replace(/\.git$/, '')
}

// A grant in a shape no version of this code writes: another format, a time ahead of the clock, or a
// field that belongs to another action.
function malformed(g, now) {
  const created = Date.parse(g.created)
  if (g.version !== 1 || !Number.isFinite(created) || created > now) return true
  if (g.action === 'commit-main') return g.dest != null || g.remoteUrl != null
  return g.index != null || (g.action === 'merge-main' && g.remoteUrl != null)
}

// -> { ok, why: 'missing'|'action'|'used'|'expired'|'format'|'head'|'dest'|'remote'|'index_unread'|'index', grant }
export function checkGrant(stateDir, action, head, now, { dest, index, remote } = {}) {
  if (!stateDir) return { ok: false, why: 'missing' }
  const g = readJsonSafe(grantPath(stateDir))
  if (!g || typeof g !== 'object') return { ok: false, why: 'missing' }
  if (g.action !== action) return { ok: false, why: 'action', grant: g }
  if (g.used) return { ok: false, why: 'used', grant: g }
  const exp = Date.parse(g.expires)
  if (!Number.isFinite(exp) || now >= exp) return { ok: false, why: 'expired', grant: g }
  if (malformed(g, now)) return { ok: false, why: 'format', grant: g }
  if (!head || typeof g.head !== 'string' || g.head !== head) return { ok: false, why: 'head', grant: g }
  if (dest !== undefined && g.dest !== dest) return { ok: false, why: 'dest', grant: g }
  if (remote !== undefined && (!remote || g.remoteUrl !== remote)) return { ok: false, why: 'remote', grant: g }
  if (index === null) return { ok: false, why: 'index_unread', grant: g }
  if (index !== undefined && g.index !== index) return { ok: false, why: 'index', grant: g }
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

export function writeGrant(stateDir, { action, ref, head, dest, remote, remoteUrl, index, ttlMin, now, session, via }) {
  fs.mkdirSync(stateDir, { recursive: true })
  const g = {
    version: 1,
    action,
    ref,
    head,
    dest,
    remote,
    remoteUrl,
    index,
    created: new Date(now).toISOString(),
    expires: new Date(now + ttlMin * 60000).toISOString(),
    used: false,
    via,
    session: session || null,
  }
  fs.writeFileSync(grantPath(stateDir), `${JSON.stringify(g, null, 2)}\n`)
  return g
}

// -> { ok, why: 'missing'|'head', stamp }
// resultsOnly(stampHead) -> true when every commit after stampHead up to head only adds
// result files (the workbook of that run); the stamp then still counts.
// A stamp written before 0.2.0 under the old default name still counts.
function readStamp(stateDir, name) {
  const s = readJsonSafe(stampPath(stateDir, name))
  if (s || (name && name !== 'lanekeeper-gate-pass')) return s
  return readJsonSafe(stampPath(stateDir, LEGACY_GATE_STAMP))
}

export function checkStamp(stateDir, name, head, resultsOnly) {
  const s = stateDir ? readStamp(stateDir, name) : null
  if (!s || typeof s.head !== 'string') return { ok: false, why: 'missing' }
  if (s.head !== head && !(resultsOnly && resultsOnly(s.head))) return { ok: false, why: 'head', stamp: s }
  return { ok: true, stamp: s }
}

export const gateLocked = (stateDir) => !!stateDir && fs.existsSync(path.join(stateDir, GATE_LOCK))
