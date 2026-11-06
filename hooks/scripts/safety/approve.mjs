#!/usr/bin/env node
// UserPromptExpansion hook for /lanekeeper:approve.
//
// UserPromptExpansion fires only when a person types a slash command, so it is
// the one place an owner grant can be created. The model cannot reach it: the
// skill sets disable-model-invocation, and the PreToolUse guard denies the
// Skill tool for lanekeeper:approve. (UserPromptSubmit is not used: it also fires for
// subagent reports and messages from other sessions.)
//
//   /lanekeeper:approve merge-main [ref]   allow one merge of <ref> into a protected branch
//   /lanekeeper:approve push-main  [ref]   allow one push of <ref> to a protected branch
//   /lanekeeper:approve commit-main [ref]  allow one commit on a protected branch at <ref>
//   /lanekeeper:approve status             show the current grant
//   /lanekeeper:approve revoke             delete the current grant
//
// Owner decisions that take effect at once, with no grant left behind (an active
// merge, push or commit grant stays as it is):
//   /lanekeeper:approve accept-quality <kind> --reason <why>   accept a weakened result of <kind>
//   /lanekeeper:approve retry-bypass       let the automatic resume use bypassPermissions
//   /lanekeeper:approve clear-gate-lock    remove a gate.lock older than machine.slots.stale_after_min
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveConfig, projectRoot, stateDir, expandHome } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import * as Q from '../../../lib/quality.mjs'
import { setPersonal } from '../../../lib/runtime.mjs'
import { slotSettings } from '../../../lib/slots.mjs'
import { matchAny, readJsonSafe } from './common.mjs'
import { ACTIONS, GATE_LOCK, OWNER_ACTIONS, grantPath, writeGrant } from './grant.mjs'

// Grant times are stored in UTC; people read them in the machine's local time: 2026-10-17 22:53 (UTC+09:00).
export function localTime(iso) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return String(iso)
  const p2 = (n) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const zone = `UTC${off >= 0 ? '+' : '-'}${p2(Math.floor(Math.abs(off) / 60))}:${p2(Math.abs(off) % 60)}`
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())} (${zone})`
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const sha = (cwd, ref) => git(['rev-parse', '-q', '--verify', `${ref}^{commit}`], cwd)

// Which commit the grant is for when no ref is given.
export function defaultRef(action, cwd, gitCfg) {
  if (action === 'commit-main') return 'HEAD'
  if (action === 'push-main') {
    const cur = git(['symbolic-ref', '-q', '--short', 'HEAD'], cwd)
    if (cur && matchAny(cur, gitCfg.protected_branches || [], { wide: true })) return cur
    const prot = (gitCfg.protected_branches || []).filter((b) => !/[*?]/.test(b)).find((b) => sha(cwd, b))
    return prot || null
  }
  // merge-main: the integration branch
  const pattern = gitCfg.integration_branch_pattern || 'lanekeeper/*/int'
  const cur = git(['symbolic-ref', '-q', '--short', 'HEAD'], cwd)
  if (cur && matchAny(cur, [pattern])) return cur
  const all = (git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], cwd) || '').split('\n').filter(Boolean)
  const ints = all.filter((b) => matchAny(b, [pattern]))
  return ints.length === 1 ? ints[0] : null
}

// `<kind> --reason <why>`, the reason running to the end and optionally quoted.
export function parseAccept(args) {
  const m = /^(\S+)\s+--reason(?:=|\s+)([\s\S]+)$/.exec(String(args).trim())
  if (!m) return null
  const reason = m[2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim()
  return reason ? { kind: m[1], reason } : null
}

function acceptQuality(args, root, resolved, t, block, context) {
  const parsed = parseAccept(args)
  if (!parsed) return block('approve.accept.usage', {})
  const settings = Q.qualitySettings(resolved.config)
  const entry = Q.latestOf(Q.buildIndex(root, settings).entries, parsed.kind)
  if (!entry) return block('q.accept.none', { kind: parsed.kind })
  const file = Q.recordAcceptance(root, settings, { kind: parsed.kind, commit: entry.commit, reason: parsed.reason })
  Q.writeIndex(root, settings, t)
  return context(t('q.accept.done', { kind: parsed.kind, commit: entry.commit.slice(0, 9), file: path.relative(root, file) }))
}

function clearGateLock(sd, resolved, env, now, t, block, context) {
  const lock = path.join(sd, GATE_LOCK)
  if (!fs.existsSync(lock)) return context(t('approve.gate_lock.none'))
  const ageMs = now - fs.statSync(lock).mtimeMs
  const ageMin = Math.round(ageMs / 60000)
  if (ageMs <= slotSettings(resolved, (p) => expandHome(p, env.HOME)).staleMs) return block('reap.gate_active', { ageMin })
  fs.rmSync(lock, { force: true })
  return context(t('reap.gate_removed', { ageMin }))
}

export function handleApprove(input, env = process.env, now = Date.now()) {
  const cwd = input.cwd || process.cwd()
  const root = projectRoot(cwd, env)
  const resolved = resolveConfig({ projectDir: root, env })
  const t = translator(resolved.effective.language)
  const block = (key, vars) => ({ decision: 'block', reason: `[lanekeeper] ${t(key, vars)}` })
  const context = (text) => ({ hookSpecificOutput: { hookEventName: 'UserPromptExpansion', additionalContext: `[lanekeeper] ${text}` } })

  if (input.command_name !== 'lanekeeper:approve') return null
  if (resolved.errors.length) return block('approve.config_broken', { file: resolved.errors[0].file, key: resolved.errors[0].path })
  const rawArgs = String(input.command_args || '').trim()
  const [action = '', ref] = rawArgs.split(/\s+/)
  if (action === 'retry-bypass') {
    setPersonal(env, 'auto_retry.permission_mode', 'bypassPermissions')
    setPersonal(env, 'auto_retry.bypass_ack', true)
    return context(t('approve.retry_bypass'))
  }
  const sd = stateDir(root)
  if (!sd) return block('approve.not_git', {})
  if (action === 'accept-quality') return acceptQuality(rawArgs.slice(action.length), root, resolved, t, block, context)
  if (action === 'clear-gate-lock') return clearGateLock(sd, resolved, env, now, t, block, context)
  const file = grantPath(sd)

  if (action === 'status') {
    const g = readJsonSafe(file)
    if (!g) return context(t('approve.none'))
    const state = g.used ? t('approve.state.used') : now >= Date.parse(g.expires) ? t('approve.state.expired') : t('approve.state.active')
    return context(t('approve.status', { action: g.action, ref: g.ref, head: String(g.head).slice(0, 9), expires: localTime(g.expires), state }))
  }
  if (action === 'revoke') {
    fs.rmSync(file, { force: true })
    return context(t('approve.revoked'))
  }
  if (!ACTIONS.includes(action)) return block('approve.usage', { actions: ACTIONS.join(' | '), owner: OWNER_ACTIONS.join(' | ') })

  const gitCfg = resolved.config.project?.git || {}
  const useRef = ref || defaultRef(action, cwd, gitCfg)
  if (!useRef) return block('approve.need_ref', { action })
  const head = sha(cwd, useRef)
  if (!head) return block('approve.bad_ref', { ref: useRef })
  const ttl = gitCfg.owner_grant_ttl_min || 15
  const g = writeGrant(sd, { action, ref: useRef, head, ttlMin: ttl, now, session: input.session_id })
  const gateCmd = resolved.config.project?.gate?.command
  const stampNote = gateCmd && action !== 'commit-main' ? t('approve.stamp_needed', { stamp: path.join(sd, `${gitCfg.gate_stamp || 'lanekeeper-gate-pass'}.json`) }) : ''
  return context(t('approve.granted', { action, ref: useRef, head: head.slice(0, 9), ttl, expires: localTime(g.expires) }) + (stampNote ? ` ${stampNote}` : ''))
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (raw += c))
  process.stdin.on('end', () => {
    let out
    try {
      out = handleApprove(JSON.parse(raw || '{}'))
    } catch (e) {
      out = { decision: 'block', reason: `[lanekeeper] /lanekeeper:approve: ${String(e?.message || e).slice(0, 200)}` }
    }
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`)
    process.exit(0)
  })
}
