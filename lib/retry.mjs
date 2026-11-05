// Automatic resume after a usage limit.
//
// Detection and scheduling run in hooks and a scheduled job, not in the model:
// while a limit is active no model can run. Scheduling is per platform
// (macOS launchd, Linux systemd user timer, otherwise a detached waiter);
// everything with side effects goes through injectable dependencies so the
// logic can be tested without touching the system.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { PLUGIN_ROOT, resolveConfig, getPath, lanekeeperHome } from './config.mjs'
import { translator } from './i18n.mjs'
import { dataDir, limitsFile, notify, readJson, writeJsonAtomic, safeId, defaultExec } from './runtime.mjs'
import { recordLimit } from './limits.mjs'

export const LIMIT_RE =
  /usage limit reached|limit reached\|[0-9]{10}|hit your usage limit|(5-hour|five-hour|daily|weekly) limit reached|usage limit.{0,40}reset/i
const GRACE_SEC = 120
const MAX_AHEAD_SEC = 10 * 86400

export const isLimitText = (text) => LIMIT_RE.test(String(text || ''))

export function limitScope(text) {
  const t = String(text || '').toLowerCase()
  if (/weekly|7-day|seven.day/.test(t)) return 'weekly'
  if (/daily/.test(t)) return 'daily'
  if (/5-hour|five-hour/.test(t)) return '5h'
  return 'unknown'
}

// Reset time (epoch seconds) from limit text; +30 min when nothing parses.
export function parseReset(text, now = Math.floor(Date.now() / 1000)) {
  const T = String(text || '')
  const future = (e) => (Number.isFinite(e) && e > now && e < now + MAX_AHEAD_SEC ? e : null)
  let m = T.match(/\|(\d{10})/)
  let e = m && future(Number(m[1]))
  if (e) return e
  m = T.match(/reset[^0-9]{0,30}(\d{10})/i)
  e = m && future(Number(m[1]))
  if (e) return e
  m = T.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/)
  if (m) {
    const base = `${m[1]}T${m[2]}${m[3] || ':00'}`
    let zone = m[5] || ''
    if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`
    e = future(Math.floor(Date.parse(base + zone) / 1000)) // no zone: local time
    if (e) return e
  }
  m = T.match(/reset[s]?[^0-9]{0,10}(\d{1,2})(?::(\d{2}))?\s?(am|pm)/i)
  if (m) {
    let h = Number(m[1])
    const min = Number(m[2] || 0)
    const pm = m[3].toLowerCase() === 'pm'
    if (pm && h < 12) h += 12
    if (!pm && h === 12) h = 0
    const d = new Date(now * 1000)
    d.setHours(h, min, 0, 0)
    let c = Math.floor(d.getTime() / 1000)
    if (c <= now) c += 86400
    e = future(c)
    if (e) return e
  }
  return now + 1800
}

// Text to inspect for a limit: hook fields first, then the transcript tail.
export function limitEvidence(input, tailLines = 8) {
  const parts = [input.error, input.error_type, input.error_details, input.last_assistant_message]
    .filter((x) => typeof x === 'string')
  let tail = ''
  const tp = input.transcript_path
  if (tp && fs.existsSync(tp)) {
    try {
      tail = fs.readFileSync(tp, 'utf8').split('\n').filter(Boolean).slice(-tailLines).join('\n')
    } catch {
      /* unreadable transcript: only the hook fields count */
    }
  }
  return { text: [...parts, tail].join('\n'), tail }
}

// Routing model key that was running when the limit hit (from the transcript tail).
export function modelFromTail(tail, modelKeys) {
  const lines = String(tail).split('\n').reverse()
  for (const l of lines) {
    const m = l.match(/"model"\s*:\s*"([^"]+)"/)
    if (m) return modelKeys.find((k) => m[1].toLowerCase().includes(k.toLowerCase())) || null
  }
  return null
}

// --- paths -----------------------------------------------------------------
export const retryDirs = (env = process.env) => {
  const root = path.join(dataDir(env), 'auto-retry')
  return { root, state: path.join(root, 'state'), logs: path.join(root, 'logs'), done: path.join(root, 'state', 'done'), failed: path.join(root, 'state', 'failed') }
}
export const labelFor = (sid) => `lanekeeper.auto-retry.${safeId(sid)}`
const runnerCommand = (sid) => [process.execPath, path.join(PLUGIN_ROOT, 'bin', 'lanekeeper-retry'), 'run', safeId(sid)]

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function buildPlist({ label, command, runAt, env, logFile }) {
  const d = new Date(runAt * 1000)
  const envXml = Object.entries(env)
    .map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${command.map((c) => `    <string>${xml(c)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Month</key><integer>${d.getMonth() + 1}</integer>
    <key>Day</key><integer>${d.getDate()}</integer>
    <key>Hour</key><integer>${d.getHours()}</integer>
    <key>Minute</key><integer>${d.getMinutes()}</integer>
  </dict>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict>
</plist>
`
}

const pad = (n) => String(n).padStart(2, '0')
export const calendarSpec = (epoch) => {
  const d = new Date(epoch * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// Environment the scheduled job needs (it does not inherit the hook's).
function jobEnv(env) {
  const out = { PATH: env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: env.HOME || '', LANEKEEPER_HOME: lanekeeperHome(env), CLAUDE_PLUGIN_DATA: dataDir(env) }
  for (const k of ['CLAUDE_CONFIG_DIR', 'LANEKEEPER_CLAUDE_BIN', 'LANG']) if (env[k]) out[k] = env[k]
  return out
}

const defaultDeps = () => ({
  now: () => Math.floor(Date.now() / 1000),
  platform: process.platform,
  exec: defaultExec,
  spawnDetached: (cmd, args, env) => {
    const c = spawn(cmd, args, { detached: true, stdio: 'ignore', env: { ...process.env, ...env } })
    c.unref()
  },
  notify: (title, body, env) => notify(title, body, { env }),
})

// Write the state file and register the one-shot job.
// Returns { label, runAt, mechanism, state }. With dryRun nothing outside the
// data folder is touched.
export function scheduleRetry({ sid, cwd, epoch, env = process.env, dryRun = false, deps = {} }) {
  const d = { ...defaultDeps(), ...deps }
  const dirs = retryDirs(env)
  fs.mkdirSync(dirs.state, { recursive: true })
  fs.mkdirSync(dirs.logs, { recursive: true })
  const id = safeId(sid)
  const stateFile = path.join(dirs.state, `${id}.json`)
  const now = d.now()
  const runAt = epoch + GRACE_SEC
  const prev = readJson(stateFile) || {}
  const state = {
    original_session_id: prev.original_session_id || sid,
    session_id: prev.session_id || sid,
    cwd,
    run_at: runAt,
    scheduled_at: now,
    attempts: prev.attempts || 0,
  }
  writeJsonAtomic(stateFile, state)
  const label = labelFor(sid)
  const command = runnerCommand(sid)
  const logFile = path.join(dirs.logs, `${id}.launchd.log`)
  let mechanism
  if (runAt <= now) mechanism = 'immediate'
  else if (d.platform === 'darwin') mechanism = 'launchd'
  else if (d.platform === 'linux' && d.exec('systemd-run', ['--version']).status === 0) mechanism = 'systemd'
  else mechanism = 'waiter'
  const plan = { label, runAt, mechanism, command, state }
  if (dryRun) return { ...plan, dryRun: true }

  if (mechanism === 'immediate') {
    d.spawnDetached(command[0], command.slice(1), jobEnv(env))
  } else if (mechanism === 'launchd') {
    const home = env.HOME || ''
    const plist = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`)
    fs.mkdirSync(path.dirname(plist), { recursive: true })
    fs.writeFileSync(plist, buildPlist({ label, command, runAt, env: jobEnv(env), logFile }))
    const uid = String(process.getuid ? process.getuid() : 0)
    d.exec('launchctl', ['bootout', `gui/${uid}/${label}`])
    d.exec('launchctl', ['bootstrap', `gui/${uid}`, plist])
    plan.plist = plist
  } else if (mechanism === 'systemd') {
    d.exec('systemctl', ['--user', 'stop', `${label}.timer`])
    const envArgs = Object.entries(jobEnv(env)).flatMap(([k, v]) => ['--setenv', `${k}=${v}`])
    d.exec('systemd-run', ['--user', `--unit=${label}`, `--on-calendar=${calendarSpec(runAt)}`, ...envArgs, ...command])
  } else {
    d.spawnDetached(command[0], [command[1], 'wait-run', safeId(sid), String(runAt)], jobEnv(env))
  }
  return plan
}

export function cancelJob(sid, { env = process.env, deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps }
  const label = labelFor(sid)
  if (d.platform === 'darwin') {
    const uid = String(process.getuid ? process.getuid() : 0)
    d.exec('launchctl', ['bootout', `gui/${uid}/${label}`])
    fs.rmSync(path.join(env.HOME || '', 'Library', 'LaunchAgents', `${label}.plist`), { force: true })
  } else if (d.platform === 'linux') {
    d.exec('systemctl', ['--user', 'stop', `${label}.timer`])
  }
}

export function pendingList(env = process.env) {
  const dirs = retryDirs(env)
  const read = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ file: path.join(dir, f), ...(readJson(path.join(dir, f)) || {}) }))
      : []
  return { pending: read(dirs.state), done: read(dirs.done), failed: read(dirs.failed) }
}

export function cancelRetry(target, { env = process.env, deps = {} } = {}) {
  const { pending } = pendingList(env)
  const hit = pending.filter((p) => target === 'all' || (p.original_session_id || '').startsWith(target))
  for (const p of hit) {
    cancelJob(p.original_session_id, { env, deps })
    fs.rmSync(p.file, { force: true })
  }
  return hit.length
}

// Effective resume permission mode. bypassPermissions needs a recorded
// acknowledgement; without it the mode falls back to default.
export function resumeMode(resolved) {
  const mode = getPath(resolved.config, 'personal.auto_retry.permission_mode') || 'default'
  if (mode === 'bypassPermissions' && getPath(resolved.config, 'personal.auto_retry.bypass_ack') !== true) {
    return { mode: 'default', downgraded: true }
  }
  return { mode, downgraded: false }
}

// Hook entry (StopFailure / Stop): detect a limit and schedule the resume.
// Returns null when nothing happened, otherwise the schedule plan.
export function detectAndSchedule(input, { env = process.env, dryRun = env.LANEKEEPER_DRYRUN === '1', deps = {} } = {}) {
  const cwd = input.cwd || process.cwd()
  const resolved = resolveConfig({ projectDir: cwd, env })
  if (resolved.errors.length) return null
  // Off unless the user turned it on (lanekeeper-retry on): scheduling writes a
  // launchd plist or a systemd user timer, so it needs the user's consent.
  if (getPath(resolved.config, 'personal.auto_retry.enabled') !== true) return null
  const sid = input.session_id
  if (!sid) return null
  const { text, tail } = limitEvidence(input)
  if (!isLimitText(text)) return null
  const d = { ...defaultDeps(), ...deps }
  const epoch = parseReset(text, d.now())
  const keys = Object.keys(getPath(resolved.config, 'routing.models') || {})
  const model = modelFromTail(tail, keys) || '*'
  try {
    recordLimit(limitsFile(resolved, env), { model, untilEpoch: epoch, scope: limitScope(text), session: sid, now: d.now() * 1000 })
  } catch {
    /* limits.json is advisory; scheduling must still happen */
  }
  const plan = scheduleRetry({ sid, cwd, epoch, env, dryRun, deps })
  if (!dryRun && plan.mechanism !== 'immediate') {
    const t = translator(resolved.effective.language)
    d.notify(t('retry.notify.title'), t('retry.notify.scheduled', { at: new Date(plan.runAt * 1000).toLocaleString() }), env)
  }
  return plan
}

const claudeBin = (env) => env.LANEKEEPER_CLAUDE_BIN || 'claude'

// Scheduled job entry: resume the session headless; reschedule on a new limit.
export async function runRetry(sid, { env = process.env, deps = {} } = {}) {
  const d = { ...defaultDeps(), runClaude: defaultRunClaude, ...deps }
  const dirs = retryDirs(env)
  const id = safeId(sid)
  const stateFile = path.join(dirs.state, `${id}.json`)
  const logFile = path.join(dirs.logs, `${id}.log`)
  // The log holds the resumed session's output, so only the user can read it.
  fs.mkdirSync(dirs.logs, { recursive: true, mode: 0o700 })
  const log = (s) => fs.appendFileSync(logFile, `${s}\n`, { mode: 0o600 })
  const state = readJson(stateFile)
  const cwd = state?.cwd && fs.existsSync(state.cwd) ? state.cwd : env.HOME || process.cwd()
  const resolved = resolveConfig({ projectDir: cwd, env })
  const t = translator(resolved.effective.language)
  const say = (key, vars) => d.notify(t('retry.notify.title'), t(key, vars), env)
  if (!state) {
    cancelJob(sid, { env, deps: d })
    return { result: 'no-state' }
  }
  if (getPath(resolved.config, 'personal.auto_retry.enabled') !== true) {
    say('retry.notify.off')
    cancelJob(sid, { env, deps: d })
    return { result: 'disabled' }
  }
  const { mode, downgraded } = resumeMode(resolved)
  if (downgraded) say('retry.notify.downgraded')
  state.attempts = (state.attempts || 0) + 1
  state.last_run_at = d.now()
  writeJsonAtomic(stateFile, state)
  say('retry.notify.start')
  log(`=== attempt=${state.attempts} resume=${state.session_id} cwd=${cwd} mode=${mode}`)
  const args = ['--resume', state.session_id, '-p', t('retry.prompt'), '--permission-mode', mode, '--output-format', 'json']
  const r = d.runClaude(claudeBin(env), args, { cwd, env })
  const out = r.stdout || ''
  log(out)
  if (r.stderr) log(r.stderr)
  let newSid = null
  try {
    newSid = JSON.parse(out).session_id || null
  } catch {
    /* not JSON: keep the old id */
  }
  if (newSid) {
    state.session_id = newSid
    writeJsonAtomic(stateFile, state)
  }
  if (isLimitText(out)) {
    cancelJob(sid, { env, deps: d })
    const epoch = parseReset(out, d.now())
    const plan = scheduleRetry({ sid: state.original_session_id, cwd, epoch, env, deps: d })
    say('retry.notify.again', { at: new Date(plan.runAt * 1000).toLocaleString() })
    return { result: 'rescheduled', plan }
  }
  cancelJob(sid, { env, deps: d })
  if (r.status !== 0) {
    fs.mkdirSync(dirs.failed, { recursive: true })
    fs.renameSync(stateFile, path.join(dirs.failed, `${id}.json`))
    say('retry.notify.failed', { code: r.status })
    return { result: 'failed' }
  }
  fs.mkdirSync(dirs.done, { recursive: true })
  fs.renameSync(stateFile, path.join(dirs.done, `${id}.json`))
  say('retry.notify.done', { session: newSid || state.session_id })
  return { result: 'done', session: newSid || state.session_id }
}

function defaultRunClaude(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' }
}

export function statusLines(resolved, env = process.env) {
  const t = translator(resolved.effective.language)
  const on = getPath(resolved.config, 'personal.auto_retry.enabled') === true
  const { mode, downgraded } = resumeMode(resolved)
  const { pending, done, failed } = pendingList(env)
  const lines = [t(on ? 'retry.status.on' : 'retry.status.off'), t('retry.status.mode', { mode }) + (downgraded ? ` ${t('retry.status.downgraded')}` : '')]
  lines.push(t('retry.status.pending', { count: pending.length }))
  for (const p of pending) {
    lines.push(t('retry.status.item', { id: String(p.original_session_id).slice(0, 8), at: new Date(p.run_at * 1000).toLocaleString(), n: p.attempts, cwd: p.cwd, session: p.session_id }))
  }
  if (done.length) lines.push(t('retry.status.done', { count: done.length }))
  if (failed.length) lines.push(t('retry.status.failed', { count: failed.length }))
  return lines
}
