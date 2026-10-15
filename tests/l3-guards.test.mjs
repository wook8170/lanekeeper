import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, runScript, bin, git, ROOT } from './l3-fixture.mjs'
import { localUsage, percent, tierFor, readTier, writeTier } from '../lib/token.mjs'
import { handle as tokenCheck } from '../hooks/scripts/token-guard/check.mjs'
import { handle as stopGuard } from '../hooks/scripts/handoff/stop-guard.mjs'
import { excerpt, isStale } from '../lib/handoff.mjs'
import { checkpointDir } from '../lib/checkpoint.mjs'
import { resolveConfig } from '../lib/config.mjs'
import { translator } from '../lib/i18n.mjs'

// ---- token guard --------------------------------------------------------------
function writeTranscript(f, name, rows) {
  const dir = path.join(f.env.CLAUDE_CONFIG_DIR, 'projects', 'p1')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}
const row = (ts, u) => ({ timestamp: new Date(ts).toISOString(), message: { usage: u } })

test('localUsage sums the window only and weights tokens', () => {
  const f = makeEnv()
  try {
    const now = Date.now()
    writeTranscript(f, 'a.jsonl', [
      row(now - 6 * 3600e3, { output_tokens: 1000 }),
      row(now - 3600e3, { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 80, cache_read_input_tokens: 1000 }),
      row(now - 60e3, { input_tokens: 5, output_tokens: 20 }),
      { timestamp: new Date(now).toISOString(), type: 'user' },
    ])
    const u = localUsage({ env: f.env, now })
    assert.deepEqual([u.msgs, u.output, u.input, u.cache_read, u.cache_creation], [2, 120, 15, 1000, 80])
    assert.equal(u.weighted, Math.floor(15 + 80 * 1.25 + 1000 * 0.1 + 120 * 5))
    assert.equal(localUsage({ env: { ...f.env, CLAUDE_CONFIG_DIR: path.join(f.base, 'none') }, now }).weighted, 0)
  } finally {
    f.cleanup()
  }
})
test('localUsage reads a transcript larger than one chunk from the end', () => {
  const f = makeEnv()
  try {
    const now = Date.now()
    const old = Array.from({ length: 9000 }, () => row(now - 20 * 3600e3, { output_tokens: 1, input_tokens: 0, pad: 'x'.repeat(100) }))
    writeTranscript(f, 'big.jsonl', [...old, row(now - 1000, { output_tokens: 7 })])
    assert.ok(fs.statSync(path.join(f.env.CLAUDE_CONFIG_DIR, 'projects', 'p1', 'big.jsonl')).size > 1 << 20)
    assert.equal(localUsage({ env: f.env, now }).output, 7)
  } finally {
    f.cleanup()
  }
})
test('tierFor maps the percentage to stage and role', () => {
  const s = [90, 95, 99]
  assert.deepEqual(tierFor(89, s), { tier: 0, role: null })
  assert.deepEqual(tierFor(90, s), { tier: 90, role: 'shrink' })
  assert.deepEqual(tierFor(96, s), { tier: 95, role: 'handoff' })
  assert.deepEqual(tierFor(120, s), { tier: 99, role: 'critical' })
  assert.deepEqual(tierFor(80, [80]), { tier: 80, role: 'shrink' })
  assert.equal(percent(50, 0), 0)
  assert.equal(percent(95, 100), 95)
})
test('token guard speaks only when the stage rises, quietly follows a fall, and notifies at the last stage', () => {
  const f = makeEnv()
  try {
    const notes = []
    const run = (util, sid = 's') => tokenCheck({ session_id: sid, hook_event_name: 'PostToolUse', cwd: f.repo }, { ...f.env, WB_TOKEN_FAKE_UTIL: String(util) }, { notify: (a, b) => notes.push([a, b]) })
    assert.equal(run(50), null)
    assert.match(run(91).hookSpecificOutput.additionalContext, /91%.*shorter units/)
    assert.equal(run(92), null, 'same stage: silent')
    assert.match(run(95).hookSpecificOutput.additionalContext, /handoff guard/, 'handoff guard on: delegating wording')
    assert.equal(notes.length, 0)
    const c = run(99)
    assert.match(c.hookSpecificOutput.additionalContext, /critical/)
    assert.equal(c.hookSpecificOutput.hookEventName, 'PostToolUse')
    assert.equal(notes.length, 1)
    assert.equal(run(40), null)
    assert.equal(readTier('s', f.env), 0, 'a fall is written quietly')
    assert.match(run(91).hookSpecificOutput.additionalContext, /shorter/)
    assert.equal(run(95, 'other').hookSpecificOutput.hookEventName, 'PostToolUse')
  } finally {
    f.cleanup()
  }
})
test('token guard: handoff stage names the file duty when the handoff guard is off; off switch and budget 0 stay silent', () => {
  const f = makeEnv()
  try {
    f.personal({ handoff: { enabled: false } })
    const run = (env, util) => tokenCheck({ session_id: 'x', cwd: f.repo }, { ...env, WB_TOKEN_FAKE_UTIL: String(util) })
    assert.match(run(f.env, 96).hookSpecificOutput.additionalContext, /update the handoff file at the end of every wave/)
    f.personal({ token_guard: { enabled: false } })
    assert.equal(run(f.env, 99), null)
    f.personal({})
    assert.equal(tokenCheck({ session_id: 'y', cwd: f.repo }, f.env), null, 'budget 0 = not calibrated')
    f.personal({ token_guard: { budget: 100 } })
    writeTranscript(f, 'u.jsonl', [row(Date.now() - 1000, { output_tokens: 20 })]) // 100 weighted = 100%
    assert.match(tokenCheck({ session_id: 'z', cwd: f.repo, hook_event_name: 'UserPromptSubmit' }, f.env, { notify: () => {} }).hookSpecificOutput.additionalContext, /100%/)
  } finally {
    f.cleanup()
  }
})
test('token guard: custom stages and Korean messages', () => {
  const f = makeEnv()
  try {
    f.personal({ language: 'ko', token_guard: { stages: [50, 70] } })
    const r = tokenCheck({ session_id: 'k', cwd: f.repo }, { ...f.env, WB_TOKEN_FAKE_UTIL: '75' }, { notify: () => {} })
    assert.match(r.hookSpecificOutput.additionalContext, /임계 상태/)
  } finally {
    f.cleanup()
  }
})
test('wb-token: calibrate sets the budget from usage or a number, status reports it', () => {
  const f = makeEnv()
  try {
    writeTranscript(f, 'c.jsonl', [row(Date.now() - 1000, { output_tokens: 1000 })])
    let r = bin('wb-token', ['status'], f.env, f.repo)
    assert.match(r.stdout, /Budget not set/)
    r = bin('wb-token', ['calibrate'], f.env, f.repo)
    assert.equal(f.readPersonal().token_guard.budget, 5000)
    r = bin('wb-token', ['calibrate', '10000'], f.env, f.repo)
    assert.equal(f.readPersonal().token_guard.budget, 10000)
    assert.match(bin('wb-token', ['status'], f.env, f.repo).stdout, /Budget 10000: 50% used/)
    assert.equal(bin('wb-token', ['calibrate', 'abc'], f.env, f.repo).status, 1)
    bin('wb-token', ['off'], f.env, f.repo)
    assert.equal(f.readPersonal().token_guard.enabled, false)
  } finally {
    f.cleanup()
  }
})
test('token guard hook process: JSON on stdout', () => {
  const f = makeEnv({ WB_TOKEN_FAKE_UTIL: '91' })
  try {
    const r = runScript('hooks/scripts/token-guard/check.mjs', { session_id: 'proc', hook_event_name: 'UserPromptSubmit', cwd: f.repo }, f.env)
    assert.equal(r.out.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  } finally {
    f.cleanup()
  }
})

// ---- handoff guard (ported selftest) ---------------------------------------------
const touch = (p, sec) => fs.utimesSync(p, sec, sec)
const nowSec = () => Math.floor(Date.now() / 1000)

test('handoff session start: newest section only; startup and clear inject, resume is silent', () => {
  const f = makeEnv()
  try {
    const hs = (source) => runScript('hooks/scripts/handoff/session-start.mjs', { hook_event_name: 'SessionStart', source, cwd: f.repo }, f.env)
    assert.doesNotMatch(hs('startup').out.hookSpecificOutput.additionalContext, /handoff file/, 'no progress.md: no handoff text')
    fs.writeFileSync(path.join(f.repo, 'progress.md'), '# progress\n\n## newest: wave A\n\n> content A\n\n## older: wave B\n\n> content B\n')
    const a = hs('startup').out.hookSpecificOutput.additionalContext
    assert.match(a, /wave A/)
    assert.doesNotMatch(a, /content B/)
    assert.match(hs('clear').out.hookSpecificOutput.additionalContext, /Session start \(clear\)/)
    assert.equal(hs('resume').out, null)
    assert.equal(hs('compact').out, null)
  } finally {
    f.cleanup()
  }
})
test('handoff session start: chat length guideline follows personal.report.chat_detail', () => {
  const f = makeEnv()
  try {
    const hs = () => runScript('hooks/scripts/handoff/session-start.mjs', { source: 'startup', cwd: f.repo }, f.env).out.hookSpecificOutput.additionalContext
    assert.match(hs(), /keep chat replies short/)
    f.personal({ report: { chat_detail: 'detailed' } })
    assert.match(hs(), /in detail/)
  } finally {
    f.cleanup()
  }
})
test('excerpt caps lines and bytes', () => {
  const big = '# t\n' + Array.from({ length: 500 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n')
  const e = excerpt(big)
  assert.ok(e.split('\n').length <= 200)
  assert.ok(Buffer.byteLength(e) <= 12288)
})
test('handoff stop guard: stale work blocks once, then throttle, stop_hook_active, token stage and disabled', () => {
  const f = makeEnv()
  try {
    const p = path.join(f.repo, 'progress.md')
    fs.writeFileSync(p, '# p\n\n## a\n')
    git(f.repo, 'add', '.')
    git(f.repo, 'commit', '-q', '-m', 'p')
    const t0 = nowSec()
    touch(p, t0 + 10)
    const stop = (extra = {}, now = Date.now()) => stopGuard({ session_id: 'hg', cwd: f.repo, ...extra }, f.env, now)
    assert.equal(stop(), null, 'fresh handoff: pass')
    fs.writeFileSync(path.join(f.repo, 'work.txt'), 'x')
    touch(path.join(f.repo, 'work.txt'), t0 + 20)
    const b = stop()
    assert.equal(b.decision, 'block')
    assert.match(b.reason, /progress\.md/)
    assert.equal(stop(), null, 'throttle')
    assert.equal(stop({ stop_hook_active: true }), null, 'once per turn')
    writeTier('hg', 95, f.env)
    assert.equal(stop().decision, 'block', 'token stage 95 lifts the throttle')
    writeTier('hg', 0, f.env)
    assert.equal(stop(), null, 'throttled again')
    assert.equal(stop({}, Date.now() + 21 * 60e3).decision, 'block', 'throttle expired')
    f.personal({ handoff: { enabled: false } })
    assert.equal(stop({ session_id: 'other' }), null)
  } finally {
    f.cleanup()
  }
})
test('handoff stop guard: a commit newer than the file blocks; updating the file passes; no file or no git is silent', () => {
  const f = makeEnv()
  try {
    const p = path.join(f.repo, 'progress.md')
    fs.writeFileSync(p, '# p\n\n## a\n')
    git(f.repo, 'add', '.')
    git(f.repo, 'commit', '-q', '-m', 'p')
    touch(p, nowSec() - 100)
    assert.equal(isStale(f.repo, 'progress.md'), true, 'last commit is newer than the file')
    touch(p, nowSec() + 5)
    assert.equal(isStale(f.repo, 'progress.md'), false)
    fs.rmSync(p)
    assert.equal(stopGuard({ session_id: 'n', cwd: f.repo }, f.env), null, 'no progress.md')
    const plain = path.join(f.base, 'plain')
    fs.mkdirSync(plain)
    fs.writeFileSync(path.join(plain, 'progress.md'), '# p')
    assert.equal(stopGuard({ session_id: 'n2', cwd: plain }, f.env), null, 'not a git repository')
  } finally {
    f.cleanup()
  }
})
test('handoff stop guard hook process prints decision block as JSON', () => {
  const f = makeEnv()
  try {
    const p = path.join(f.repo, 'progress.md')
    fs.writeFileSync(p, '# p\n')
    git(f.repo, 'add', '.')
    git(f.repo, 'commit', '-q', '-m', 'p')
    touch(p, nowSec() - 100)
    const r = runScript('hooks/scripts/handoff/stop-guard.mjs', { hook_event_name: 'Stop', session_id: 'proc', cwd: f.repo }, f.env)
    assert.equal(r.out.decision, 'block')
  } finally {
    f.cleanup()
  }
})

// ---- terse -----------------------------------------------------------------------
test('terse: per-repository switch, personal default, injection at session start', () => {
  const f = makeEnv()
  try {
    const ss = () => runScript('hooks/scripts/terse/session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup', cwd: f.repo }, f.env)
    assert.equal(ss().out, null)
    assert.match(bin('wb-terse', ['status'], f.env, f.repo).stdout, /off/)
    assert.match(bin('wb-terse', ['on'], f.env, f.repo).stdout, /on for this repository/)
    assert.match(ss().out.hookSpecificOutput.additionalContext, /Terse mode \(on\)/)
    assert.ok(fs.existsSync(path.join(f.repo, '.git', 'wb', 'terse')))
    bin('wb-terse', ['off'], f.env, f.repo)
    assert.equal(ss().out, null)
    fs.rmSync(path.join(f.repo, '.git', 'wb', 'terse'))
    f.personal({ terse: true, language: 'ko' })
    assert.match(ss().out.hookSpecificOutput.additionalContext, /간결 모드/)
    const plain = path.join(f.base, 'plain')
    fs.mkdirSync(plain)
    assert.equal(bin('wb-terse', ['on'], f.env, plain).status, 1, 'no git: no switch file')
  } finally {
    f.cleanup()
  }
})

// ---- checkpoint -------------------------------------------------------------------
test('checkpoint commits WIP on a lane branch only', () => {
  const f = makeEnv()
  try {
    const resolved = resolveConfig({ projectDir: f.repo, env: f.env })
    fs.writeFileSync(path.join(f.repo, 'w.txt'), 'w')
    assert.equal(checkpointDir(f.repo, resolved, 'Stop').skipped, 'protected', 'main is never committed to')
    git(f.repo, 'checkout', '-q', '-b', 'feature/x')
    assert.equal(checkpointDir(f.repo, resolved, 'Stop').skipped, 'not-lane')
    git(f.repo, 'checkout', '-q', '-b', 'wb/mvp/l3')
    const before = git(f.repo, 'rev-parse', 'HEAD')
    const r = checkpointDir(f.repo, resolved, 'StopFailure')
    assert.equal(r.committed, true)
    assert.notEqual(git(f.repo, 'rev-parse', 'HEAD'), before)
    assert.match(git(f.repo, 'log', '-1', '--format=%s'), /^wip\(wb\): checkpoint at StopFailure /)
    assert.equal(git(f.repo, 'status', '--porcelain'), '')
    assert.equal(checkpointDir(f.repo, resolved, 'Stop').skipped, 'clean')
    fs.writeFileSync(path.join(f.repo, '.git', 'MERGE_HEAD'), git(f.repo, 'rev-parse', 'HEAD'))
    fs.writeFileSync(path.join(f.repo, 'w2.txt'), 'w')
    assert.equal(checkpointDir(f.repo, resolved, 'Stop').skipped, 'in-progress')
  } finally {
    f.cleanup()
  }
})
test('checkpoint hook process: commits on a lane branch, disabled setting does nothing', () => {
  const f = makeEnv()
  try {
    git(f.repo, 'checkout', '-q', '-b', 'wb/mvp/l3')
    fs.writeFileSync(path.join(f.repo, 'w.txt'), 'w')
    f.personal({ checkpoint: { enabled: false } })
    runScript('hooks/scripts/checkpoint/checkpoint.mjs', { hook_event_name: 'PreCompact', cwd: f.repo }, f.env)
    assert.notEqual(git(f.repo, 'status', '--porcelain'), '')
    f.personal({})
    const r = runScript('hooks/scripts/checkpoint/checkpoint.mjs', { hook_event_name: 'SubagentStop', cwd: f.repo }, f.env)
    assert.equal(git(f.repo, 'status', '--porcelain'), '')
    assert.match(r.out.systemMessage, /wb\/mvp\/l3@/)
  } finally {
    f.cleanup()
  }
})

// ---- wiring and messages ------------------------------------------------------------
test('hooks.json registers every L3 hook on the right events; scripts exist and are executable', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks
  const want = {
    SessionStart: ['handoff/session-start.mjs', 'auto-retry/session-start.mjs', 'terse/session-start.mjs'],
    UserPromptSubmit: ['token-guard/check.mjs'],
    PostToolUse: ['token-guard/check.mjs'],
    Stop: ['handoff/stop-guard.mjs', 'auto-retry/detect.mjs'],
    StopFailure: ['auto-retry/detect.mjs', 'checkpoint/checkpoint.mjs'],
    SubagentStop: ['checkpoint/checkpoint.mjs'],
    PreCompact: ['checkpoint/checkpoint.mjs'],
  }
  for (const [ev, scripts] of Object.entries(want)) {
    const cmds = (h[ev] || []).flatMap((e) => e.hooks.map((x) => x.command))
    for (const s of scripts) {
      assert.ok(cmds.some((c) => c.includes(s)), `${ev} ${s}`)
      assert.ok(fs.statSync(path.join(ROOT, 'hooks', 'scripts', s)).mode & 0o111, s)
    }
  }
  assert.ok(!h.UserPromptSubmit.some((e) => e.hooks.some((x) => /approve/.test(x.command))), 'grants still do not come from UserPromptSubmit')
  for (const b of ['wb-retry', 'wb-token', 'wb-terse']) assert.ok(fs.statSync(path.join(ROOT, 'bin', b)).mode & 0o111, b)
})
test('every message the L3 code uses exists in ko and en, and ko is translated', () => {
  const src = ['lib/retry.mjs', 'lib/token.mjs', 'hooks/scripts/handoff/session-start.mjs', 'hooks/scripts/handoff/stop-guard.mjs', 'hooks/scripts/auto-retry/session-start.mjs', 'hooks/scripts/token-guard/check.mjs', 'bin/wb-retry', 'bin/wb-token', 'bin/wb-terse']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n')
  const keys = new Set([...src.matchAll(/\bt\('((?:retry|token|handoff|chat|terse)\.[a-z.]+)'/g)].map((m) => m[1]))
  for (const k of ['token.shrink', 'token.handoff', 'token.critical', 'chat.detailed']) keys.add(k)
  const ko = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'ko.json'), 'utf8'))
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'en.json'), 'utf8'))
  for (const k of keys) {
    assert.ok(k in en && k in ko, k)
    assert.notEqual(ko[k], en[k], `${k} is not translated`)
  }
  assert.ok(keys.size > 30)
  assert.match(translator('ko')('retry.status.on'), /켜짐/)
})
test('default settings: retry permission default, handoff and checkpoint on, budget uncalibrated', async () => {
  const f = makeEnv()
  try {
    const r = resolveConfig({ projectDir: f.repo, env: f.env })
    assert.deepEqual(r.errors, [])
    const p = r.config.personal
    assert.equal(p.auto_retry.permission_mode, 'default')
    assert.equal(p.auto_retry.bypass_ack, false)
    assert.deepEqual([p.handoff.enabled, p.handoff.file, p.checkpoint.enabled, p.token_guard.budget], [true, 'progress.md', true, 0])
  } finally {
    f.cleanup()
  }
})
