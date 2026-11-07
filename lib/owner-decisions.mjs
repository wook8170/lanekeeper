// Owner decisions that two routes can carry out: the slash command a person types, and a
// confirmation dialog raised by the safety hook (hooks/scripts/safety/owner-dialog.mjs). The grants
// for a protected branch (merge-main, push-main, commit-main) are among them.
// bypassPermissions for the automatic resume stays slash-only.
//
// owner-ticket.json  { action, content, nonceHash, issued, session }
//   The hook writes it when it raises a dialog. The nonce itself travels only in the command it
//   shows through `updatedInput`, so the agent never sees it and a declined dialog leaves a ticket
//   nobody can use. `content` ties it to what the dialog showed.
// owner-decisions.jsonl  { at, action, via: 'dialog'|'slash', ... }
//   One line for each decision carried out.
//
// Limit: this does not prove that a person answered. Claude Code takes the answer and the hook
// never sees it. An agent that hides from the hook both a write to the ticket file and the call
// can still forge a ticket, the same way it could hide a write to accepted.json.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT } from './config.mjs'
import * as Q from './quality.mjs'

export const TICKET_FILE = 'owner-ticket.json'
export const LOG_FILE = 'owner-decisions.jsonl'
// A dialog stays open until it is answered. An answer after this has to be asked again.
export const TICKET_TTL_MS = 10 * 60 * 1000

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const ticketPath = (sd) => path.join(sd, TICKET_FILE)

export const acceptContent = ({ kind, reason, entry }) => sha256(JSON.stringify(['accept-quality', kind, String(reason).trim(), entry.commit, entry.json]))
export const grantContent = (action, { ref, head, dest, remoteUrl, index }) => sha256(JSON.stringify(['grant', action, ref, head, dest ?? null, remoteUrl ?? null, index ?? null]))
export const gateLockContent = (lock) => sha256(JSON.stringify(['clear-gate-lock', lock.mtimeMs, lock.raw]))

// Returns the nonce. A ticket issued earlier stops working at this moment.
export function issueTicket(sd, action, content, now = Date.now(), session = null) {
  const nonce = crypto.randomBytes(16).toString('hex')
  fs.mkdirSync(sd, { recursive: true })
  const tmp = `${ticketPath(sd)}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify({ action, content, nonceHash: sha256(nonce), issued: now, session }), { mode: 0o600 })
  fs.renameSync(tmp, ticketPath(sd))
  return nonce
}

// The session that raised the dialog, to be read before the ticket is used up.
export function ticketSession(sd) {
  try {
    return JSON.parse(fs.readFileSync(ticketPath(sd), 'utf8')).session ?? null
  } catch {
    return null
  }
}

// -> 'ok' | 'missing' | 'nonce' | 'expired' | 'content'
// A wrong nonce leaves the ticket, so one bad call cannot cancel a dialog a person is reading. The
// right nonce uses it up whatever else is wrong, and the rename makes that happen only once.
export function consumeTicket(sd, action, content, nonce, now = Date.now()) {
  let ticket
  try {
    ticket = JSON.parse(fs.readFileSync(ticketPath(sd), 'utf8'))
  } catch {
    return 'missing'
  }
  if (typeof nonce !== 'string' || !nonce || sha256(nonce) !== ticket.nonceHash) return 'nonce'
  const claimed = `${ticketPath(sd)}.used-${process.pid}`
  try {
    fs.renameSync(ticketPath(sd), claimed)
  } catch {
    return 'missing'
  }
  fs.rmSync(claimed, { force: true })
  const age = now - ticket.issued
  if (!(age >= 0 && age <= TICKET_TTL_MS)) return 'expired'
  return ticket.action === action && ticket.content === content ? 'ok' : 'content'
}

export function logDecision(sd, { action, via, ...detail }, now = new Date()) {
  if (!sd) return
  fs.mkdirSync(sd, { recursive: true })
  fs.appendFileSync(path.join(sd, LOG_FILE), `${JSON.stringify({ at: now.toISOString(), action, via, ...detail })}\n`)
}

export function acceptResult(root, settings, t, sd, { kind, reason, entry, via }) {
  const file = Q.recordAcceptance(root, settings, { kind, commit: entry.commit, reason, via })
  Q.writeIndex(root, settings, t)
  logDecision(sd, { action: 'accept-quality', via, kind, commit: entry.commit, reason: String(reason).trim() })
  return file
}

// -> null, or the lock with its age, its owner and whether it is old enough to remove
export function readGateLock(sd, staleMs, now = Date.now()) {
  const file = path.join(sd, 'gate.lock')
  let stat, raw
  try {
    stat = fs.statSync(file)
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  let info = {}
  try {
    info = JSON.parse(raw) || {}
  } catch {
    /* an unreadable lock is still a lock */
  }
  const ageMs = now - stat.mtimeMs
  return { file, raw, mtimeMs: stat.mtimeMs, ageMin: Math.round(ageMs / 60000), stale: ageMs > staleMs, pid: info.pid, command: info.command }
}

export function removeGateLock(sd, lock, via) {
  fs.rmSync(lock.file, { force: true })
  logDecision(sd, { action: 'clear-gate-lock', via, ageMin: lock.ageMin })
}

// ---- allow rules ---------------------------------------------------------------------------

function settingsFiles(root, env) {
  const home = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || '', '.claude')
  return [path.join(home, 'settings.json'), path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json')]
}

// `Bash(...)` body as a regular expression. Only `*` and the old `:*` ending are special.
function ruleMatches(rule, commands) {
  if (rule === 'Bash') return true
  const m = /^Bash\((.*)\)$/su.exec(rule)
  if (!m) return false
  const body = m[1].replace(/:\*$/u, ' *')
  const re = new RegExp(`^${body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')).join('.*')}$`, 'su')
  return commands.some((c) => re.test(c))
}

// A `permissions.allow` rule covering these commands, if any -> { file, rule }.
// Claude Code 2.1.319 still raised the dialog with such a rule in place, but its documentation does
// not state that order, so the hook refuses instead of relying on it. Managed settings and
// --allowedTools are not visible from here.
export function ownerAllowRule(root, env = process.env) {
  const bin = path.join(PLUGIN_ROOT, 'bin')
  const commands = [
    'lanekeeper-reap --gate-lock',
    `${bin}/lanekeeper-reap --gate-lock --dialog-ticket 0`,
    'lanekeeper-quality accept unit --reason x',
    `${bin}/lanekeeper-quality accept unit --reason='x' --dialog-ticket 0`,
    ...['merge-main', 'push-main', 'commit-main'].flatMap((a) => [`lanekeeper-grant ${a}`, `lanekeeper-grant ${a} x`, `lanekeeper-grant ${a} x --to y`, `${bin}/lanekeeper-grant ${a} 'x' --dialog-ticket 0`, `lanekeeper-grant ${a} x --to y --remote z`, `${bin}/lanekeeper-grant ${a} 'x' --to 'y' --dialog-ticket 0`, `${bin}/lanekeeper-grant ${a} 'x' --to 'y' --remote 'z' --dialog-ticket 0`]),
  ]
  for (const file of settingsFiles(root, env)) {
    let allow
    try {
      allow = JSON.parse(fs.readFileSync(file, 'utf8'))?.permissions?.allow
    } catch {
      continue
    }
    if (!Array.isArray(allow)) continue
    for (const rule of allow) if (typeof rule === 'string' && ruleMatches(rule.trim(), commands)) return { file, rule }
  }
  return null
}
