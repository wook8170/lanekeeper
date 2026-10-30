import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, runScript, bin, git, ROOT } from './l3-fixture.mjs'
import { localUsage, percent, tierFor, readTier, writeTier } from '../lib/token.mjs'
import { handle as tokenCheck } from '../hooks/scripts/token-guard/check.mjs'
import { handle as stopGuard } from '../hooks/scripts/handoff/stop-guard.mjs'
import { excerpt, isStale, countLines, sizeCheck, demoteHeadings, appendArchive, archiveCurrent, migrateLegacy, skeleton, stamp, handoffSettings } from '../lib/handoff.mjs'
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

test('handoff session start: whole current-state file with the archive hint; startup and clear inject, resume is silent', () => {
  const f = makeEnv()
  try {
    f.personal({ handoff: { inject: 'full' } })
    const hs = (source) => runScript('hooks/scripts/handoff/session-start.mjs', { hook_event_name: 'SessionStart', source, cwd: f.repo }, f.env)
    assert.doesNotMatch(hs('startup').out.hookSpecificOutput.additionalContext, /handoff file/, 'no progress.md: no handoff text')
    fs.writeFileSync(path.join(f.repo, 'progress.md'), '# progress\n\n## Goals\n\n> content A\n\n## Next\n\n> content B\n')
    const a = hs('startup').out.hookSpecificOutput.additionalContext
    assert.match(a, /content A/)
    assert.match(a, /content B/, 'a current-state file is injected whole')
    assert.match(a, /\(whole file\)/)
    assert.match(a, /from start to end/)
    assert.match(a, /grep -n '<keyword>' docs\/progress-archive\/\*\.md/)
    assert.doesNotMatch(a, /over the \d+-line target/)
    assert.match(hs('clear').out.hookSpecificOutput.additionalContext, /Session start \(clear\)/)
    assert.equal(hs('resume').out, null)
    assert.equal(hs('compact').out, null)
  } finally {
    f.cleanup()
  }
})
test('handoff session start: an accumulated file over max_lines shows the newest section and a warning with the move command', () => {
  const f = makeEnv()
  try {
    f.personal({ handoff: { inject: 'full', max_lines: 40, archive_dir: 'notes/old' } })
    const filler = Array.from({ length: 60 }, (_, i) => `- old item ${i}`).join('\n')
    fs.writeFileSync(path.join(f.repo, 'progress.md'), `# progress\n\n## newest: wave A\n\n> content A\n\n## older: wave B\n\n> content B\n${filler}\n`)
    const a = runScript('hooks/scripts/handoff/session-start.mjs', { source: 'startup', cwd: f.repo }, f.env).out.hookSpecificOutput.additionalContext
    assert.match(a, /wave A/)
    assert.doesNotMatch(a, /content B/)
    assert.match(a, /newest section only/)
    assert.match(a, /has 6\d lines, over the 40-line target/)
    assert.match(a, /wb-waves handoff migrate/)
    assert.match(a, /notes\/old\/progress-until-/)
  } finally {
    f.cleanup()
  }
})
test('handoff session start: the default injects only the head of progress.md and says to read the file', () => {
  const f = makeEnv()
  try {
    const body = Array.from({ length: 80 }, (_, i) => `- item ${i}`).join('\n')
    fs.writeFileSync(path.join(f.repo, 'progress.md'), `# progress\n\n## Now\n\n> content A\n${body}\n\n## Next\n\n> content B\n`)
    const a = runScript('hooks/scripts/handoff/session-start.mjs', { source: 'startup', cwd: f.repo }, f.env).out.hookSpecificOutput.additionalContext
    assert.match(a, /content A/)
    assert.doesNotMatch(a, /content B/, 'the rest stays in the file')
    assert.doesNotMatch(a, /item 60/, 'at most 40 lines')
    assert.match(a, /the head only/)
    assert.match(a, /from start to end/)
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
test('excerpt: an accumulated file caps lines and bytes; a current-state file is whole up to 9,000 characters', () => {
  const big = '# t\n' + Array.from({ length: 500 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n')
  const e = excerpt(big)
  assert.ok(e.split('\n').length <= 200)
  assert.ok(Buffer.byteLength(e) <= 12288)
  const cur = '# p\n\n## a\n\none\n\n## b\n\ntwo\n'
  assert.equal(excerpt(cur), cur.trimEnd())
  assert.equal(excerpt(cur, { maxLines: 3 }), '# p\n\n## a\n\none\n', 'over maxLines: header + newest section')
  const wide = '# p\n' + Array.from({ length: 250 }, (_, i) => `row ${i} ${'y'.repeat(60)}`).join('\n')
  const w = excerpt(wide)
  assert.ok(w.length <= 9002 && w.endsWith('\n…'), 'long current-state file is cut with a marker')
  assert.equal(countLines(''), 0)
  assert.equal(countLines('a\nb\n'), 2)
})
test('handoff settings and size check: defaults 300 lines and docs/progress-archive', () => {
  assert.deepEqual(handoffSettings({}), { file: 'progress.md', maxLines: 300, archiveDir: 'docs/progress-archive' })
  assert.deepEqual(handoffSettings({ file: 'HANDOFF.md', max_lines: 50, archive_dir: 'h/' }), { file: 'HANDOFF.md', maxLines: 50, archiveDir: 'h' })
  const f = makeEnv()
  try {
    assert.deepEqual(sizeCheck(f.repo, 'progress.md'), { exists: false, lines: 0, max: 300, over: false })
    fs.writeFileSync(path.join(f.repo, 'progress.md'), Array.from({ length: 301 }, () => 'x').join('\n'))
    assert.deepEqual(sizeCheck(f.repo, 'progress.md'), { exists: true, lines: 301, max: 300, over: true })
    assert.equal(sizeCheck(f.repo, 'progress.md', 301).over, false)
  } finally {
    f.cleanup()
  }
})
test('archive: dated sections append to the monthly file, headings are demoted, history is kept', () => {
  const f = makeEnv()
  try {
    const now = new Date(2026, 9, 17, 18, 5)
    const rel = appendArchive({ cwd: f.repo, title: 'wave 3 done', body: '# progress\n\n## Done\n\n- merged #12\n\n```\n# not a heading\n```\n', now })
    assert.equal(rel, path.join('docs', 'progress-archive', 'progress-2026-10.md'))
    appendArchive({ cwd: f.repo, title: 'question answered', body: '- owner chose A', now: new Date(2026, 9, 18, 9, 0) })
    const text = fs.readFileSync(path.join(f.repo, rel), 'utf8')
    assert.match(text, /^# progress archive 2026-10\n/)
    assert.equal((text.match(/^# progress archive/gm) || []).length, 1, 'header written once')
    assert.match(text, /\n## 2026-10-17 18:05 — wave 3 done\n\n### progress\n\n#### Done\n\n- merged #12\n/)
    assert.match(text, /```\n# not a heading\n```/, 'code fences untouched')
    assert.ok(text.indexOf('wave 3 done') < text.indexOf('2026-10-18 09:00 — question answered'), 'appended at the end')
    assert.equal(appendArchive({ cwd: f.repo, title: 'next month', body: 'x', now: new Date(2026, 10, 1, 0, 0) }), path.join('docs', 'progress-archive', 'progress-2026-11.md'))
    assert.equal(demoteHeadings('plain\n### deep'), 'plain\n### deep', 'already level 3: unchanged')
    assert.deepEqual(stamp(now), { ym: '2026-10', ymd: '2026-10-17', hm: '18:05' })
  } finally {
    f.cleanup()
  }
})
test('archive current: the whole progress.md goes to the archive and the file is left for the rewrite', () => {
  const f = makeEnv()
  try {
    assert.equal(archiveCurrent({ cwd: f.repo, title: 'x' }).reason, 'missing')
    const p = path.join(f.repo, 'progress.md')
    fs.writeFileSync(p, '   \n')
    assert.equal(archiveCurrent({ cwd: f.repo, title: 'x' }).reason, 'empty')
    fs.writeFileSync(p, '# progress\n\n## In progress\n\n- lane l3 running\n')
    const r = archiveCurrent({ cwd: f.repo, title: 'before rewrite', now: new Date(2026, 9, 17, 18, 30) })
    assert.equal(r.archived, true)
    assert.equal(r.lines, 5)
    assert.match(fs.readFileSync(path.join(f.repo, r.to), 'utf8'), /## 2026-10-17 18:30 — before rewrite\n\n### progress\n\n#### In progress\n\n- lane l3 running/)
    assert.match(fs.readFileSync(p, 'utf8'), /lane l3 running/, 'progress.md itself is untouched')
  } finally {
    f.cleanup()
  }
})
test('migrate: an accumulated progress.md over max_lines moves whole (git mv) and a fresh current-state file replaces it', () => {
  const f = makeEnv()
  try {
    const t = translator('ko')
    const p = path.join(f.repo, 'progress.md')
    const old = '# progress\n\n' + Array.from({ length: 40 }, (_, i) => `## 2026-10-${String((i % 28) + 1).padStart(2, '0')} wave ${i}\n\n- done ${i}\n`).join('\n')
    fs.writeFileSync(p, old)
    git(f.repo, 'add', '.')
    git(f.repo, 'commit', '-q', '-m', 'old progress')
    const now = new Date(2026, 9, 17, 18, 40)
    assert.equal(migrateLegacy({ cwd: f.repo, maxLines: 1000, t, now }).reason, 'small', 'within the target: not moved')
    const r = migrateLegacy({ cwd: f.repo, maxLines: 100, t, now })
    assert.equal(r.moved, true)
    assert.equal(r.git, true)
    assert.equal(r.to, path.join('docs', 'progress-archive', 'progress-until-2026-10-17.md'))
    assert.equal(fs.readFileSync(path.join(f.repo, r.to), 'utf8'), old, 'nothing lost')
    assert.match(git(f.repo, 'status', '--short'), /R {2}progress\.md -> docs\/progress-archive\/progress-until-2026-10-17\.md/)
    const fresh = fs.readFileSync(p, 'utf8')
    assert.ok(countLines(fresh) < 40)
    assert.match(fresh, /^# progress — 현재 상태 \(2026-10-17 18:40\)/)
    assert.match(fresh, /grep -n '<키워드>' docs\/progress-archive\/\*\.md/)
    assert.match(fresh, /이전 누적 기록 전체: `docs\/progress-archive\/progress-until-2026-10-17\.md`/)
    for (const h of ['목표와 오너 결정', '브랜치와 서버', '진행 중', '다음 할 일', '확인 대기', '시스템 지식', '재개 명령']) assert.match(fresh, new RegExp(`^## ${h}$`, 'm'), h)
    // a second move the same day gets a suffix; an untracked file is renamed without git
    fs.writeFileSync(p, old)
    const r2 = migrateLegacy({ cwd: f.repo, maxLines: 10, t, now, force: true })
    assert.equal(r2.to, path.join('docs', 'progress-archive', 'progress-until-2026-10-17-2.md'))
    assert.equal(r2.git, false)
    assert.equal(fs.readFileSync(path.join(f.repo, r2.to), 'utf8'), old)
    assert.equal(migrateLegacy({ cwd: f.repo, file: 'none.md', t }).reason, 'missing')
    assert.match(skeleton(translator('en')), /^## Resume commands$/m)
  } finally {
    f.cleanup()
  }
})
test('wb-waves handoff: check, archive (whole file or --from) and migrate', () => {
  const f = makeEnv()
  try {
    f.personal({ handoff: { max_lines: 30 } })
    const run = (...a) => bin('wb-waves', ['handoff', ...a], f.env, f.repo)
    const p = path.join(f.repo, 'progress.md')
    assert.match(run('check').stdout, /does not exist/)
    assert.notEqual(run('archive', 'x').status, 0, 'archive without a file fails')
    fs.writeFileSync(p, '# progress\n\n## Next\n\n- do y\n')
    let r = run('check')
    assert.equal(r.status, 0)
    assert.match(r.stdout, /progress\.md: 5 lines \(target 30 or fewer\)/)
    assert.match(r.stdout, /Archive docs\/progress-archive\/: 0 files/)
    r = run('archive', 'wave 1 done')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /Appended to the archive: docs\/progress-archive\/progress-\d{4}-\d{2}\.md/)
    assert.match(r.stdout, /rewrite progress\.md whole/)
    const finished = path.join(f.base, 'finished.md')
    fs.writeFileSync(finished, '- merged #7\n')
    assert.equal(run('archive', 'merge', '--from', finished).status, 0)
    const arch = fs.readdirSync(path.join(f.repo, 'docs', 'progress-archive'))
    assert.equal(arch.length, 1)
    const at = fs.readFileSync(path.join(f.repo, 'docs', 'progress-archive', arch[0]), 'utf8')
    assert.match(at, /— wave 1 done\n\n### progress/)
    assert.match(at, /— merge\n\n- merged #7/)
    assert.notEqual(run('archive', 'm', '--from', path.join(f.base, 'nope.md')).status, 0)
    assert.match(run('migrate').stdout, /was not moved/)
    fs.writeFileSync(p, Array.from({ length: 40 }, (_, i) => `- ${i}`).join('\n'))
    r = run('check', '--json')
    assert.equal(r.status, 1, 'over the target: exit 1')
    assert.equal(JSON.parse(r.stdout).over, true)
    r = run('migrate')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /Moved progress\.md \(40 lines\) to docs\/progress-archive\/progress-until-/)
    assert.match(fs.readFileSync(p, 'utf8'), /current state/)
    assert.equal(run('check').status, 0)
  } finally {
    f.cleanup()
  }
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
    assert.match(b.reason, /current state only \(target: 300 lines or fewer\)/)
    assert.match(b.reason, /docs\/progress-archive\/progress-<YYYY-MM>\.md/)
    assert.match(b.reason, /wb-waves handoff archive/)
    assert.doesNotMatch(b.reason, /newest section on top|keep still-valid items, newest/, 'no accumulate-on-top instruction')
    assert.doesNotMatch(b.reason, /over the \d+-line target/)
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
test('handoff stop guard: an oversized file adds the move step', () => {
  const f = makeEnv()
  try {
    f.personal({ handoff: { max_lines: 20 } })
    const p = path.join(f.repo, 'progress.md')
    fs.writeFileSync(p, Array.from({ length: 25 }, (_, i) => `- ${i}`).join('\n'))
    git(f.repo, 'add', '.')
    git(f.repo, 'commit', '-q', '-m', 'p')
    touch(p, nowSec() - 100)
    const b = stopGuard({ session_id: 'big', cwd: f.repo }, f.env)
    assert.equal(b.decision, 'block')
    assert.match(b.reason, /target: 20 lines/)
    assert.match(b.reason, /has 25 lines, over the 20-line target/)
    assert.match(b.reason, /wb-waves handoff migrate/)
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
    fs.writeFileSync(path.join(f.repo, 'a.txt'), 'w')
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
    fs.writeFileSync(path.join(f.repo, 'a.txt'), 'w2')
    assert.equal(checkpointDir(f.repo, resolved, 'Stop').skipped, 'in-progress')
  } finally {
    f.cleanup()
  }
})
test('checkpoint: untracked files are not committed (recorded), secret-like tracked files are excluded, project hooks are not bypassed', () => {
  const f = makeEnv()
  try {
    const resolved = resolveConfig({ projectDir: f.repo, env: f.env })
    fs.writeFileSync(path.join(f.repo, '.env'), 's=1\n')
    fs.writeFileSync(path.join(f.repo, 'id_rsa'), 'k\n')
    git(f.repo, 'add', '.')
    git(f.repo, 'commit', '-q', '-m', 'secrets tracked')
    git(f.repo, 'checkout', '-q', '-b', 'wb/mvp/l3')
    fs.writeFileSync(path.join(f.repo, '.env'), 's=2\n')
    fs.writeFileSync(path.join(f.repo, 'id_rsa'), 'k2\n')
    fs.writeFileSync(path.join(f.repo, 'a.txt'), 'changed\n')
    fs.writeFileSync(path.join(f.repo, 'new.txt'), 'new\n')
    const notes = []
    const r = checkpointDir(f.repo, resolved, 'Stop', new Date(), { env: f.env, notifyFn: (a, b) => notes.push(b) })
    assert.equal(r.committed, true)
    assert.deepEqual(git(f.repo, 'show', '--name-only', '--format=', 'HEAD').split('\n'), ['a.txt'])
    assert.deepEqual(r.secrets.sort(), ['.env', 'id_rsa'])
    assert.deepEqual(r.untracked, ['new.txt'])
    const rec = JSON.parse(fs.readFileSync(path.join(f.repo, '.git', 'wb', 'checkpoint.json'), 'utf8'))
    assert.deepEqual([rec.untracked_count, rec.untracked, rec.secrets_skipped.length], [1, ['new.txt'], 2])
    assert.match(notes[0], /1 untracked.*secret-like/)
    assert.match(git(f.repo, 'status', '--porcelain'), /\.env/)
    // only secrets/untracked left: nothing committed
    const r2 = checkpointDir(f.repo, resolved, 'Stop', new Date(), { env: f.env, notifyFn: () => {} })
    assert.equal(r2.skipped, 'nothing-tracked')
    // a failing project pre-commit hook skips the checkpoint and records the reason
    fs.writeFileSync(path.join(f.repo, 'a.txt'), 'again\n')
    const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit')
    fs.mkdirSync(path.dirname(hook), { recursive: true })
    fs.writeFileSync(hook, '#!/bin/sh\necho nope >&2\nexit 1\n', { mode: 0o755 })
    const head = git(f.repo, 'rev-parse', 'HEAD')
    const r3 = checkpointDir(f.repo, resolved, 'Stop', new Date(), { env: f.env, notifyFn: (a, b) => notes.push(b) })
    assert.equal(r3.skipped, 'commit-failed')
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), head)
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.repo, '.git', 'wb', 'checkpoint.json'), 'utf8')).skipped, 'commit-failed')
  } finally {
    f.cleanup()
  }
})
test('checkpoint hook process: commits on a lane branch, disabled setting does nothing', () => {
  const f = makeEnv()
  try {
    git(f.repo, 'checkout', '-q', '-b', 'wb/mvp/l3')
    fs.writeFileSync(path.join(f.repo, 'a.txt'), 'w')
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
  const src = ['lib/retry.mjs', 'lib/token.mjs', 'lib/handoff.mjs', 'hooks/scripts/handoff/session-start.mjs', 'hooks/scripts/handoff/stop-guard.mjs', 'hooks/scripts/auto-retry/session-start.mjs', 'hooks/scripts/token-guard/check.mjs', 'bin/wb-retry', 'bin/wb-token', 'bin/wb-terse']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n')
  const keys = new Set([...src.matchAll(/\bt\('((?:retry|token|handoff|chat|terse)\.[a-z.]+)'/g)].map((m) => m[1]))
  for (const k of ['token.shrink', 'token.handoff', 'token.critical', 'chat.detailed', 'handoff.shown.whole', 'handoff.shown.newest', 'handoff.template.until']) keys.add(k)
  for (const k of ['ok', 'over', 'missing', 'archive', 'archived', 'rewrite', 'small', 'migrated']) keys.add(`handoff.cli.${k}`)
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
    assert.deepEqual([p.handoff.max_lines, p.handoff.archive_dir], [300, 'docs/progress-archive'])
  } finally {
    f.cleanup()
  }
})
