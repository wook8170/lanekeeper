#!/usr/bin/env node
// UserPromptExpansion hook for /lanekeeper:approve.
//
// UserPromptExpansion fires only when a person types a slash command. The model cannot reach it: the
// skill sets disable-model-invocation, and the PreToolUse guard denies the Skill tool for
// lanekeeper:approve. (UserPromptSubmit is not used: it also fires for subagent reports and messages
// from other sessions.) The other way to a grant is the dialog owner-dialog.mjs raises for
// lanekeeper-grant. Both routes share resolveTarget and recordGrant below.
//
//   /lanekeeper:approve merge-main [ref] [--to <branch>]  allow one merge of <ref> into that protected branch
//   /lanekeeper:approve push-main  [ref] [--to <branch>] [--remote <name>]  allow one push of <ref> to that branch of that remote
//   /lanekeeper:approve commit-main [ref]  allow one commit of what is staged now, on a protected branch at <ref>
//   /lanekeeper:approve merge-pr [pr] [--repo <owner/name>]  allow one `gh pr merge` of that PR, at its head now, from any folder
//   /lanekeeper:approve status             show the current grant
//   /lanekeeper:approve revoke             delete the current grant
//
// Owner decisions that take effect at once, with no grant left behind (an active
// merge, push or commit grant stays as it is). accept-quality and clear-gate-lock can also be
// confirmed in a dialog (owner-dialog.mjs). retry-bypass cannot, because it turns permission checks off:
//   /lanekeeper:approve accept-quality <kind> --reason <why>   accept a weakened result of <kind>
//   /lanekeeper:approve retry-bypass       let the automatic resume use bypassPermissions
//   /lanekeeper:approve clear-gate-lock    remove a gate.lock older than machine.slots.stale_after_min
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveConfig, projectRoot, stateDir, expandHome, lanekeeperHome } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import * as OD from '../../../lib/owner-decisions.mjs'
import * as Q from '../../../lib/quality.mjs'
import { setPersonal } from '../../../lib/runtime.mjs'
import { slotSettings } from '../../../lib/slots.mjs'
import { matchAny, readJsonSafe } from './common.mjs'
import { realGit, realPr } from './context.mjs'
import { ACTIONS, OWNER_ACTIONS, cleanRemoteUrl, grantPath, isUnborn, ownerDir, prKey, shortHead, unbornHead, writeGrant } from './grant.mjs'

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
    // This also runs inside the PreToolUse judgement, which has to answer quickly.
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim()
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

// The first commit of a repository: commit-main on a protected branch, with no commit anywhere yet.
function firstCommitHead(action, ref, cwd, gitCfg) {
  if (action !== 'commit-main') return null
  const cur = git(['symbolic-ref', '-q', '--short', 'HEAD'], cwd)
  if (!cur || (ref !== 'HEAD' && ref !== cur) || !matchAny(cur, gitCfg.protected_branches || [], { wide: true })) return null
  return realGit.unborn({ cwd, globalOpts: [], env: {} }) ? unbornHead(cur) : null
}

const isProtected = (branch, gitCfg) => matchAny(branch, gitCfg.protected_branches || [], { wide: true })

// Which protected branch a merge or push lands on when --to is not given.
function defaultDest(action, ref, cwd, gitCfg) {
  const named = ref.replace(/^refs\/heads\//, '')
  if (action === 'push-main' && isProtected(named, gitCfg)) return named
  const cur = git(['symbolic-ref', '-q', '--short', 'HEAD'], cwd)
  if (cur && isProtected(cur, gitCfg)) return cur
  return (gitCfg.protected_branches || []).filter((b) => !/[*?]/.test(b)).find((b) => sha(cwd, b)) || null
}

// The shared git folder of the repository a folder belongs to, or null.
function repositoryOf(dir) {
  const common = git(['rev-parse', '--git-common-dir'], dir)
  try {
    return common ? fs.realpathSync(path.resolve(dir, common)) : null
  } catch {
    return null
  }
}

// `[ref] [--to <branch>] [--remote <name>] [--repo <owner/name>]` -> { ref, to, remote, repo }
export function parseGrantArgs(words) {
  const out = {}
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '--to') out.to = words[++i] ?? ''
    else if (words[i].startsWith('--to=')) out.to = words[i].slice(5)
    else if (words[i] === '--remote') out.remote = words[++i] ?? ''
    else if (words[i].startsWith('--remote=')) out.remote = words[i].slice(9)
    else if (words[i] === '--repo') out.repo = words[++i] ?? ''
    else if (words[i].startsWith('--repo=')) out.repo = words[i].slice(7)
    else out.ref ??= words[i]
  }
  return out
}

// What a grant would be for -> { ref, head, dest, remote, remoteUrl | index }, or { why, vars } when it
// cannot be given. A project folder inside the repository is fine; another repository is not.
export function resolveTarget(action, ref, cwd, gitCfg, { to, remote, root } = {}) {
  const here = root ? repositoryOf(cwd) : null
  if (here && repositoryOf(root) !== here) return { why: 'other_root', vars: { top: here, root } }
  const useRef = ref || defaultRef(action, cwd, gitCfg)
  if (!useRef) return { why: 'need_ref', vars: { action } }
  const head = sha(cwd, useRef) || firstCommitHead(action, useRef, cwd, gitCfg)
  if (!head) return { why: 'bad_ref', vars: { ref: useRef } }
  if (remote !== undefined && action !== 'push-main') return { why: 'bad_remote', vars: { remote: cleanRemoteUrl(remote) } }
  if (action === 'commit-main') {
    if (to !== undefined) return { why: 'bad_dest', vars: { dest: to } }
    const index = realGit.writeTree({ cwd, globalOpts: [], env: {} })
    return index ? { ref: useRef, head, index } : { why: 'bad_index', vars: {} }
  }
  const dest = to === undefined ? defaultDest(action, useRef, cwd, gitCfg) : to.replace(/^refs\/heads\//, '')
  if (!dest) return { why: 'need_dest', vars: { action } }
  if (!isProtected(dest, gitCfg)) return { why: 'bad_dest', vars: { dest } }
  if (action === 'merge-main') return { ref: useRef, head, dest }
  const where = { cwd, globalOpts: [], env: {} }
  if (remote === '') return { why: 'need_remote', vars: { action } }
  // a name other than the default has to exist; an address is taken as written
  const fallback = realGit.defaultRemote(where, dest)
  if (remote !== undefined && remote !== fallback && !/[:/]/.test(remote) && !realGit.isRemote(where, remote)) return { why: 'bad_remote', vars: { remote } }
  const named = remote ?? fallback
  const remoteUrl = realGit.pushAddress(where, named)
  return remoteUrl ? { ref: useRef, head, dest, remote: cleanRemoteUrl(named), remoteUrl } : { why: 'bad_remote', vars: { remote: cleanRemoteUrl(named) } }
}

// What a merge-pr grant would be for -> { ref, head, dest, number, repo, title }, or { why, vars }.
// The session's folder plays no part unless the PR is named by a number alone, as for gh itself.
export function resolvePrTarget(selector, cwd, gitCfg, { repo, lookup = realPr } = {}) {
  const unresolved = { why: 'pr_unresolved', vars: { pr: selector ?? '-', repo: repo ?? '-' } }
  if (String(selector ?? '').startsWith('-') || String(repo ?? '').startsWith('-') || repo === '') return unresolved
  const pr = lookup({ cwd, globalOpts: [], env: {} }, { selector, repo })
  const key = prKey(pr)
  if (!key || !pr.base || !pr.headOid) return unresolved
  if (!isProtected(pr.base, gitCfg)) return { why: 'pr_not_protected', vars: { pr: key, dest: pr.base } }
  return { ref: key, head: pr.headOid, dest: pr.base, number: pr.number, repo: key.split('#')[0], title: pr.title }
}

// Writes the grant and its line in the decision log, and returns the message for the person.
export function recordGrant({ sd, action, target, resolved, t, now, session, via }) {
  const gitCfg = resolved.config.project?.git || {}
  const ttl = gitCfg.owner_grant_ttl_min || 15
  const { ref, head, dest, remote, remoteUrl, index } = target
  const g = writeGrant(sd, { action, ref, head, dest, remote, remoteUrl, index, ttlMin: ttl, now, session, via })
  OD.logDecision(sd, { action, via, ref, head, dest, remote, remoteUrl, index, session }, new Date(now))
  const vars = { action, ref, head: shortHead(head), dest, remote, url: remoteUrl, ttl, expires: localTime(g.expires) }
  const bound = t(remote ? 'approve.bound_remote' : dest ? 'approve.bound_dest' : 'approve.bound_index', vars)
  if (isUnborn(head)) return `${t('approve.granted_first', vars)} ${bound}`
  const gateCmd = resolved.config.project?.gate?.command
  const stampNote = gateCmd && ['merge-main', 'push-main'].includes(action) ? t('approve.stamp_needed', { stamp: path.join(sd, `${gitCfg.gate_stamp || 'lanekeeper-gate-pass'}.json`) }) : ''
  return `${t('approve.granted', vars)} ${bound}` + (stampNote ? ` ${stampNote}` : '')
}

// `<kind> --reason <why>`, the reason running to the end and optionally quoted.
export function parseAccept(args) {
  const m = /^(\S+)\s+--reason(?:=|\s+)([\s\S]+)$/.exec(String(args).trim())
  if (!m) return null
  const reason = m[2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim()
  return reason ? { kind: m[1], reason } : null
}

function acceptQuality(args, root, sd, resolved, t, block, context) {
  const parsed = parseAccept(args)
  if (!parsed) return block('approve.accept.usage', {})
  const settings = Q.qualitySettings(resolved.config)
  const entry = Q.latestOf(Q.buildIndex(root, settings).entries, parsed.kind)
  if (!entry) return block('q.accept.none', { kind: parsed.kind })
  const file = OD.acceptResult(root, settings, t, sd, { kind: parsed.kind, reason: parsed.reason, entry, via: 'slash' })
  return context(t('q.accept.done', { kind: parsed.kind, commit: entry.commit.slice(0, 9), file: path.relative(root, file) }))
}

function clearGateLock(sd, resolved, env, now, t, block, context) {
  const lock = OD.readGateLock(sd, slotSettings(resolved, (p) => expandHome(p, env.HOME)).staleMs, now)
  if (!lock) return context(t('approve.gate_lock.none'))
  if (!lock.stale) return block('reap.gate_active', { ageMin: lock.ageMin })
  OD.removeGateLock(sd, lock, 'slash')
  return context(t('reap.gate_removed', { ageMin: lock.ageMin }))
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
  const [action = '', ...grantWords] = rawArgs.split(/\s+/)
  if (action === 'retry-bypass') {
    setPersonal(env, 'auto_retry.permission_mode', 'bypassPermissions')
    setPersonal(env, 'auto_retry.bypass_ack', true)
    OD.logDecision(stateDir(root), { action: 'retry-bypass', via: 'slash' })
    return context(t('approve.retry_bypass'))
  }
  const sd = stateDir(root)
  const prDir = ownerDir(lanekeeperHome(env))
  const files = [...(sd ? [grantPath(sd)] : []), grantPath(prDir)]
  if (action === 'status') {
    const lines = files.map((file) => readJsonSafe(file)).filter(Boolean).map((g) => {
      const state = g.used ? t('approve.state.used') : now >= Date.parse(g.expires) ? t('approve.state.expired') : t('approve.state.active')
      return t('approve.status', { action: g.action, ref: g.ref, head: shortHead(g.head), expires: localTime(g.expires), state })
    })
    return context(lines.join('\n') || t('approve.none'))
  }
  if (action === 'revoke') {
    for (const file of files) fs.rmSync(file, { force: true })
    return context(t('approve.revoked'))
  }
  if (action === 'merge-pr') {
    const { ref, to, remote, repo } = parseGrantArgs(grantWords)
    if (to !== undefined || remote !== undefined) return block('approve.usage', { actions: ACTIONS.join(' | '), owner: OWNER_ACTIONS.join(' | ') })
    const target = resolvePrTarget(ref, cwd, resolved.config.project?.git || {}, { repo })
    if (target.why) return block(`approve.${target.why}`, target.vars)
    return context(recordGrant({ sd: prDir, action, target, resolved, t, now, session: input.session_id, via: 'slash' }))
  }
  if (!sd) return block('approve.not_git', {})
  if (action === 'accept-quality') return acceptQuality(rawArgs.slice(action.length), root, sd, resolved, t, block, context)
  if (action === 'clear-gate-lock') return clearGateLock(sd, resolved, env, now, t, block, context)
  if (!ACTIONS.includes(action)) return block('approve.usage', { actions: ACTIONS.join(' | '), owner: OWNER_ACTIONS.join(' | ') })

  const { ref, to, remote, repo } = parseGrantArgs(grantWords)
  if (repo !== undefined) return block('approve.usage', { actions: ACTIONS.join(' | '), owner: OWNER_ACTIONS.join(' | ') })
  const target = resolveTarget(action, ref, cwd, resolved.config.project?.git || {}, { to, remote, root })
  if (target.why) return block(`approve.${target.why}`, target.vars)
  return context(recordGrant({ sd, action, target, resolved, t, now, session: input.session_id, via: 'slash' }))
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
