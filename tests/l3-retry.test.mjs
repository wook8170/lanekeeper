import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, runScript, bin, ROOT } from './l3-fixture.mjs'
import { parseReset, isLimitText, scheduleRetry, detectAndSchedule, runRetry, buildPlist, resumeMode, retryDirs, pendingList, cancelRetry, limitScope, modelFromTail, calendarSpec } from '../lib/retry.mjs'
import { readLimits, exhaustedModels, recordLimit } from '../lib/limits.mjs'
import { resolveConfig } from '../lib/config.mjs'

const NOW = 1754900000

// ---- reset time parsing (ported from the original selftest) ---------------
test('parseReset: epoch after a pipe', () => assert.equal(parseReset('Usage limit reached|1754903600', NOW), 1754903600))
test('parseReset: epoch near the word reset', () => assert.equal(parseReset('usage limit reached. resets at 1754905000', NOW), 1754905000))
test('parseReset: ISO with +00:00 and Z are read as UTC', () => {
  const e = Math.floor(Date.parse('2025-08-11T14:59:59Z') / 1000)
  assert.equal(parseReset('limit reached, resets 2025-08-11T14:59:59.745293+00:00', 1754800000), e)
  assert.equal(parseReset('limit reached, resets 2025-08-11T14:59:59Z', 1754800000), e)
})
test('parseReset: ISO without a zone is local time', () => {
  const d = new Date((NOW + 7200) * 1000)
  const p = (n) => String(n).padStart(2, '0')
  const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  assert.equal(parseReset(`limit reached, resets ${iso}`, NOW), NOW + 7200)
})
test('parseReset: "resets 3pm" is the next 15:00 local time', () => {
  const d = new Date(NOW * 1000)
  d.setHours(15, 0, 0, 0)
  let e = Math.floor(d.getTime() / 1000)
  if (e <= NOW) e += 86400
  assert.equal(parseReset('You have hit your usage limit. It resets 3pm.', NOW), e)
  const m = new Date(NOW * 1000)
  m.setHours(0, 30, 0, 0)
  let e2 = Math.floor(m.getTime() / 1000)
  if (e2 <= NOW) e2 += 86400
  assert.equal(parseReset('usage limit reached, resets 12:30 AM', NOW), e2)
})
test('parseReset: unparsable text and past times fall back to +30 minutes', () => {
  assert.equal(parseReset('some unrelated error text', NOW), NOW + 1800)
  assert.equal(parseReset('limit reached|1600000000', NOW), NOW + 1800)
  assert.equal(parseReset('limit reached|1999999999', NOW), NOW + 1800, 'more than ten days ahead is ignored')
})
test('isLimitText matches limit messages only', () => {
  for (const s of ['Claude AI usage limit reached|1754903600', 'You hit your usage limit', 'weekly limit reached', '5-hour limit reached']) assert.ok(isLimitText(s), s)
  for (const s of ['normal completion', 'rate of change', '']) assert.ok(!isLimitText(s), s)
  assert.equal(limitScope('weekly limit reached'), 'weekly')
  assert.equal(limitScope('5-hour limit reached'), '5h')
  assert.equal(limitScope('usage limit reached'), 'unknown')
})
test('modelFromTail picks the routing key of the latest model field', () => {
  const tail = '{"message":{"model":"claude-sonnet-x"}}\n{"message":{"model":"claude-opus-4-8"}}\n{"error":"limit"}'
  assert.equal(modelFromTail(tail, ['fable', 'opus', 'sonnet', 'haiku']), 'opus')
  assert.equal(modelFromTail('{"x":1}', ['opus']), null)
})

// ---- scheduling -------------------------------------------------------------
const fakeDeps = (platform, extra = {}) => {
  const calls = []
  return {
    calls,
    deps: {
      now: () => NOW,
      platform,
      exec: (cmd, args) => (calls.push([cmd, ...args]), { status: cmd === 'systemd-run' && args[0] === '--version' ? 0 : 0, stdout: '', stderr: '' }),
      spawnDetached: (cmd, args) => calls.push(['detached', cmd, ...args]),
      notify: (title, body) => calls.push(['notify', title, body]),
      ...extra,
    },
  }
}

test('scheduleRetry on macOS writes a launchd plist (reset + 2 minutes) and bootstraps it', () => {
  const f = makeEnv()
  try {
    const { calls, deps } = fakeDeps('darwin')
    const plan = scheduleRetry({ sid: 'abc-123', cwd: f.repo, epoch: NOW + 3600, env: f.env, deps })
    assert.equal(plan.mechanism, 'launchd')
    assert.equal(plan.runAt, NOW + 3600 + 120)
    const plist = fs.readFileSync(path.join(f.env.HOME, 'Library', 'LaunchAgents', 'wb.auto-retry.abc-123.plist'), 'utf8')
    assert.match(plist, /<key>Label<\/key><string>wb\.auto-retry\.abc-123<\/string>/)
    assert.match(plist, /<string>run<\/string>\s*<string>abc-123<\/string>/)
    assert.match(plist, /<key>WB_HOME<\/key>/)
    assert.match(plist, /<key>CLAUDE_PLUGIN_DATA<\/key>/)
    assert.ok(calls.some((c) => c[0] === 'launchctl' && c[1] === 'bootstrap'))
    const state = JSON.parse(fs.readFileSync(path.join(retryDirs(f.env).state, 'abc-123.json'), 'utf8'))
    assert.deepEqual([state.original_session_id, state.cwd, state.run_at, state.attempts], ['abc-123', f.repo, NOW + 3720, 0])
  } finally {
    f.cleanup()
  }
})
test('scheduleRetry dry run touches nothing outside the data folder', () => {
  const f = makeEnv()
  try {
    const { calls, deps } = fakeDeps('darwin')
    const plan = scheduleRetry({ sid: 's1', cwd: f.repo, epoch: NOW + 600, env: f.env, dryRun: true, deps })
    assert.equal(plan.dryRun, true)
    assert.equal(calls.length, 0)
    assert.ok(!fs.existsSync(path.join(f.env.HOME, 'Library')))
  } finally {
    f.cleanup()
  }
})
test('scheduleRetry on Linux uses a systemd user timer when available, else a detached waiter', () => {
  const f = makeEnv()
  try {
    let r = fakeDeps('linux')
    let plan = scheduleRetry({ sid: 's2', cwd: f.repo, epoch: NOW + 600, env: f.env, deps: r.deps })
    assert.equal(plan.mechanism, 'systemd')
    const run = r.calls.find((c) => c[0] === 'systemd-run' && c[1].startsWith('--user'))
    assert.ok(run.some((a) => a === '--unit=wb.auto-retry.s2'))
    assert.ok(run.some((a) => a.startsWith('--on-calendar=')))
    r = fakeDeps('linux', { exec: () => ({ status: 1, stdout: '', stderr: '' }) })
    plan = scheduleRetry({ sid: 's3', cwd: f.repo, epoch: NOW + 600, env: f.env, deps: r.deps })
    assert.equal(plan.mechanism, 'waiter')
    assert.ok(r.calls.some((c) => c[0] === 'detached' && c.includes('wait-run')))
    r = fakeDeps('win32')
    assert.equal(scheduleRetry({ sid: 's4', cwd: f.repo, epoch: NOW + 600, env: f.env, deps: r.deps }).mechanism, 'waiter')
  } finally {
    f.cleanup()
  }
})
test('scheduleRetry with a reset already past runs the resume at once', () => {
  const f = makeEnv()
  try {
    const r = fakeDeps('darwin')
    const plan = scheduleRetry({ sid: 's5', cwd: f.repo, epoch: NOW - 500, env: f.env, deps: r.deps })
    assert.equal(plan.mechanism, 'immediate')
    assert.ok(r.calls.some((c) => c[0] === 'detached'))
  } finally {
    f.cleanup()
  }
})
test('scheduleRetry keeps attempts and the latest session id of an earlier state', () => {
  const f = makeEnv()
  try {
    const { deps } = fakeDeps('darwin')
    scheduleRetry({ sid: 's6', cwd: f.repo, epoch: NOW + 600, env: f.env, deps })
    const file = path.join(retryDirs(f.env).state, 's6.json')
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify({ ...s, attempts: 2, session_id: 'newer' }))
    scheduleRetry({ sid: 's6', cwd: f.repo, epoch: NOW + 900, env: f.env, deps })
    const s2 = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.deepEqual([s2.attempts, s2.session_id, s2.original_session_id], [2, 'newer', 's6'])
  } finally {
    f.cleanup()
  }
})
test('buildPlist escapes XML and calendarSpec is a local date time', () => {
  const p = buildPlist({ label: 'a&b', command: ['/x y/<n>', 'run'], runAt: NOW, env: { K: 'v"<' }, logFile: '/l' })
  assert.match(p, /a&amp;b/)
  assert.match(p, /&lt;n&gt;/)
  assert.match(calendarSpec(NOW), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
})

// ---- detection chain (ported selftest: detect -> schedule in dry-run) -------
function transcript(f, lines) {
  const p = path.join(f.base, 't.jsonl')
  fs.writeFileSync(p, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
  return p
}
test('detect -> schedule chain (dry run): limit in the transcript tail', () => {
  const f = makeEnv()
  try {
    const t = transcript(f, [{ type: 'assistant', message: { model: 'claude-opus-4-8', content: 'working' } }, { type: 'error', message: 'Claude AI usage limit reached|1754903600' }])
    const { calls, deps } = fakeDeps('darwin')
    const plan = detectAndSchedule({ session_id: 'selftest-sid', transcript_path: t, cwd: f.repo }, { env: f.env, dryRun: true, deps })
    assert.equal(plan.label, 'wb.auto-retry.selftest-sid')
    assert.equal(plan.runAt, 1754903720)
    assert.equal(calls.length, 0)
    const lim = readLimits(path.join(f.env.CLAUDE_PLUGIN_DATA, 'limits.json'))
    assert.equal(lim.models.opus.until, new Date(1754903600 * 1000).toISOString())
  } finally {
    f.cleanup()
  }
})
test('detect: StopFailure fields count as evidence; normal completion does nothing', () => {
  const f = makeEnv()
  try {
    const { deps } = fakeDeps('darwin')
    const plan = detectAndSchedule({ session_id: 's7', cwd: f.repo, error: 'rate_limit', error_details: 'You have hit your usage limit. resets 3pm' }, { env: f.env, dryRun: true, deps })
    assert.ok(plan)
    const t = transcript(f, [{ type: 'assistant', message: 'normal completion' }])
    assert.equal(detectAndSchedule({ session_id: 's8', transcript_path: t, cwd: f.repo }, { env: f.env, dryRun: true, deps }), null)
  } finally {
    f.cleanup()
  }
})
test('detect: disabled in personal settings does nothing', () => {
  const f = makeEnv()
  try {
    f.personal({ auto_retry: { enabled: false } })
    const { deps } = fakeDeps('darwin')
    assert.equal(detectAndSchedule({ session_id: 's9', cwd: f.repo, error_details: 'usage limit reached|1754903600' }, { env: f.env, dryRun: true, deps }), null)
  } finally {
    f.cleanup()
  }
})
test('limits.json: unidentified model is recorded as "*", expired entries are dropped, format is stable', () => {
  const f = makeEnv()
  try {
    const file = path.join(f.base, 'limits.json')
    recordLimit(file, { untilEpoch: 2000, session: 'x', now: 1000 * 1000 })
    assert.deepEqual(exhaustedModels(file, 1500 * 1000), ['*'])
    assert.deepEqual(exhaustedModels(file, 2500 * 1000), [])
    recordLimit(file, { model: 'opus', untilEpoch: 9000, scope: 'weekly', now: 3000 * 1000 })
    const d = readLimits(file)
    assert.deepEqual(Object.keys(d.models), ['opus'])
    assert.deepEqual(Object.keys(d.models.opus).sort(), ['recorded_at', 'scope', 'session', 'until'])
    assert.equal(d.version, 1)
  } finally {
    f.cleanup()
  }
})
test('detect hook process: writes limits.json at the configured path and schedules in dry-run', () => {
  const f = makeEnv({ WB_DRYRUN: '1' })
  try {
    const r = runScript('hooks/scripts/auto-retry/detect.mjs', { hook_event_name: 'StopFailure', session_id: 'p1', cwd: f.repo, error_details: 'usage limit reached|4102444800' }, f.env)
    assert.equal(r.status, 0)
    assert.ok(fs.existsSync(path.join(f.env.CLAUDE_PLUGIN_DATA, 'limits.json')))
    assert.ok(fs.existsSync(path.join(retryDirs(f.env).state, 'p1.json')))
    assert.ok(!fs.existsSync(path.join(f.env.HOME, 'Library', 'LaunchAgents')), 'dry run registers nothing')
  } finally {
    f.cleanup()
  }
})

// ---- permission mode (decision B3) ------------------------------------------
test('permission mode defaults to "default"; bypassPermissions needs the acknowledgement', () => {
  const f = makeEnv()
  try {
    assert.deepEqual(resumeMode(resolveConfig({ projectDir: f.repo, env: f.env })), { mode: 'default', downgraded: false })
    f.personal({ auto_retry: { permission_mode: 'bypassPermissions' } })
    assert.deepEqual(resumeMode(resolveConfig({ projectDir: f.repo, env: f.env })), { mode: 'default', downgraded: true })
    f.personal({ auto_retry: { permission_mode: 'bypassPermissions', bypass_ack: true } })
    assert.deepEqual(resumeMode(resolveConfig({ projectDir: f.repo, env: f.env })), { mode: 'bypassPermissions', downgraded: false })
  } finally {
    f.cleanup()
  }
})
test('wb-retry mode: bypassPermissions is refused without --i-understand and records the acknowledgement with it', () => {
  const f = makeEnv()
  try {
    let r = bin('wb-retry', ['mode', 'bypassPermissions'], f.env, f.repo)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /bypassPermissions/)
    assert.equal(fs.existsSync(path.join(f.env.WB_HOME, 'personal.json')), false)
    r = bin('wb-retry', ['mode', 'bypassPermissions', '--i-understand'], f.env, f.repo)
    assert.equal(r.status, 0)
    assert.deepEqual([f.readPersonal().auto_retry.permission_mode, f.readPersonal().auto_retry.bypass_ack], ['bypassPermissions', true])
    r = bin('wb-retry', ['mode', 'plan'], f.env, f.repo)
    assert.deepEqual([f.readPersonal().auto_retry.permission_mode, f.readPersonal().auto_retry.bypass_ack], ['plan', false])
  } finally {
    f.cleanup()
  }
})

// ---- runner -----------------------------------------------------------------
function seedState(f, sid, extra = {}) {
  const dirs = retryDirs(f.env)
  fs.mkdirSync(dirs.state, { recursive: true })
  fs.writeFileSync(path.join(dirs.state, `${sid}.json`), JSON.stringify({ original_session_id: sid, session_id: sid, cwd: f.repo, run_at: NOW, scheduled_at: NOW, attempts: 0, ...extra }))
}
test('runRetry resumes with the default permission mode, updates the session id and files the state as done', async () => {
  const f = makeEnv()
  try {
    seedState(f, 'r1')
    const seen = []
    const { calls, deps } = fakeDeps('darwin', { runClaude: (cmd, args, opts) => (seen.push({ cmd, args, cwd: opts.cwd }), { status: 0, stdout: JSON.stringify({ session_id: 'r1-new', result: 'ok' }), stderr: '' }) })
    const r = await runRetry('r1', { env: f.env, deps })
    assert.equal(r.result, 'done')
    assert.equal(seen[0].cmd, 'claude')
    const a = seen[0].args
    assert.deepEqual([a[0], a[1], a[a.indexOf('--permission-mode') + 1]], ['--resume', 'r1', 'default'])
    assert.ok(!a.includes('bypassPermissions'))
    assert.equal(seen[0].cwd, f.repo)
    const done = JSON.parse(fs.readFileSync(path.join(retryDirs(f.env).done, 'r1.json'), 'utf8'))
    assert.deepEqual([done.session_id, done.attempts], ['r1-new', 1])
    assert.ok(calls.some((c) => c[0] === 'notify'))
  } finally {
    f.cleanup()
  }
})
test('runRetry reschedules when the resumed run hits a limit again', async () => {
  const f = makeEnv()
  try {
    seedState(f, 'r2')
    const { deps } = fakeDeps('darwin', { runClaude: () => ({ status: 0, stdout: JSON.stringify({ session_id: 'r2b', result: 'usage limit reached|1754909000' }), stderr: '' }) })
    const r = await runRetry('r2', { env: f.env, deps })
    assert.equal(r.result, 'rescheduled')
    assert.equal(r.plan.runAt, 1754909120)
    assert.equal(pendingList(f.env).pending.length, 1)
  } finally {
    f.cleanup()
  }
})
test('runRetry: failure files the state under failed; off skips the resume', async () => {
  const f = makeEnv()
  try {
    seedState(f, 'r3')
    let ran = 0
    const { deps } = fakeDeps('darwin', { runClaude: () => (ran++, { status: 2, stdout: '', stderr: 'boom' }) })
    assert.equal((await runRetry('r3', { env: f.env, deps })).result, 'failed')
    assert.ok(fs.existsSync(path.join(retryDirs(f.env).failed, 'r3.json')))
    seedState(f, 'r4')
    f.personal({ auto_retry: { enabled: false } })
    ran = 0
    assert.equal((await runRetry('r4', { env: f.env, deps })).result, 'disabled')
    assert.equal(ran, 0)
  } finally {
    f.cleanup()
  }
})
test('cancelRetry removes waiting resumes by id prefix or all', () => {
  const f = makeEnv()
  try {
    seedState(f, 'aaa111')
    seedState(f, 'bbb222')
    const { deps } = fakeDeps('darwin')
    assert.equal(cancelRetry('aaa', { env: f.env, deps }), 1)
    assert.equal(pendingList(f.env).pending.length, 1)
    assert.equal(cancelRetry('all', { env: f.env, deps }), 1)
  } finally {
    f.cleanup()
  }
})
test('wb-retry status / off / on work as a process and the session hook reports waiting resumes', () => {
  const f = makeEnv()
  try {
    seedState(f, 'st123456')
    let r = bin('wb-retry', ['status'], f.env, f.repo)
    assert.match(r.stdout, /Automatic resume: on/)
    assert.match(r.stdout, /permission mode: default/)
    assert.match(r.stdout, /Waiting resumes: 1/)
    const h = runScript('hooks/scripts/auto-retry/session-start.mjs', { hook_event_name: 'SessionStart', cwd: f.repo }, f.env)
    assert.match(h.out.hookSpecificOutput.additionalContext, /1 automatic resume\(s\) waiting/)
    bin('wb-retry', ['off'], f.env, f.repo)
    assert.equal(f.readPersonal().auto_retry.enabled, false)
    assert.match(runScript('hooks/scripts/auto-retry/session-start.mjs', { cwd: f.repo }, f.env).out.hookSpecificOutput.additionalContext, /off/)
    bin('wb-retry', ['on'], f.env, f.repo)
    assert.equal(f.readPersonal().auto_retry.enabled, true)
    r = bin('wb-retry', ['limits'], f.env, f.repo)
    assert.equal(JSON.parse(r.stdout).version, 1)
  } finally {
    f.cleanup()
  }
})
