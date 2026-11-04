// Regression tests for the defects found while following the user manual on a
// sample repository (gate pass stamp, result-only commits, messages, local time).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeEnv, bin, git } from './l3-fixture.mjs'
import { makeFixture } from './safety-fixture.mjs'
import { formatReasons } from '../hooks/scripts/safety/common.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const w = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body))
  return file
}

// ── 1 gate pass stamp ───────────────────────────────────────────────────
test('1 wb-test-report gate-pass: a pass on a clean HEAD writes the stamp with head, time and command', () => {
  const m = makeEnv()
  try {
    const stamp = path.join(m.repo, '.git', 'wb', 'wb-gate-pass.json')
    w(path.join(m.repo, '.wb', 'config.json'), { version: 1, gate: { command: 'node -e "process.exit(0)"' } })
    git(m.repo, 'add', '.')
    git(m.repo, 'commit', '-q', '-m', 'config')
    const r = bin('wb-test-report', ['gate-pass'], m.env, m.repo)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /Gate pass stamp written/)
    const s = JSON.parse(fs.readFileSync(stamp, 'utf8'))
    assert.equal(s.head, git(m.repo, 'rev-parse', 'HEAD'))
    assert.equal(s.command, 'node -e "process.exit(0)"')
    assert.ok(Number.isFinite(Date.parse(s.at)))
    assert.ok(!fs.existsSync(path.join(m.repo, '.git', 'wb', 'gate.lock')), 'the gate lock is released')

    // a failing gate leaves no stamp
    fs.rmSync(stamp)
    w(path.join(m.repo, '.wb', 'config.json'), { version: 1, gate: { command: 'node -e "process.exit(4)"' } })
    git(m.repo, 'commit', '-q', '-am', 'fail gate')
    const bad = bin('wb-test-report', ['gate-pass'], m.env, m.repo)
    assert.equal(bad.status, 4)
    assert.ok(!fs.existsSync(stamp))

    // uncommitted tracked changes: the pass does not count for HEAD
    w(path.join(m.repo, '.wb', 'config.json'), { version: 1, gate: { command: 'node -e "process.exit(0)"' } })
    const dirty = bin('wb-test-report', ['gate-pass'], m.env, m.repo)
    assert.equal(dirty.status, 0)
    assert.match(dirty.stderr, /no stamp was written/)
    assert.ok(!fs.existsSync(stamp))
  } finally {
    m.cleanup()
  }
})

test('1 wb-test-report gate-pass: without project.gate.command it explains and exits 2', () => {
  const m = makeEnv()
  try {
    const r = bin('wb-test-report', ['gate-pass'], m.env, m.repo)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /project\.gate\.command is empty/)
  } finally {
    m.cleanup()
  }
})

test('1 wb-test-report run: a full pass writes the stamp, a --only run does not', () => {
  const m = makeEnv({ WB_PYTHON: 'wb-no-such-python' })
  try {
    const stamp = path.join(m.repo, '.git', 'wb', 'wb-gate-pass.json')
    w(path.join(m.repo, '.gitignore'), '/test-results/\n')
    w(path.join(m.repo, '.wb', 'verify.config.json'), { version: 1, stages: [{ name: 'ok', adapter: 'vitest', cmd: 'node -e "0"', slot: 'none' }] })
    git(m.repo, 'add', '.')
    git(m.repo, 'commit', '-q', '-m', 'verify config')
    let r = bin('wb-test-report', ['run', '--only', 'ok'], m.env, m.repo)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.ok(!fs.existsSync(stamp))
    r = bin('wb-test-report', ['run'], m.env, m.repo)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const s = JSON.parse(fs.readFileSync(stamp, 'utf8'))
    assert.equal(s.head, git(m.repo, 'rev-parse', 'HEAD'))
    assert.equal(s.command, 'wb-test-report run')
  } finally {
    m.cleanup()
  }
})

test('1 wb-test-report run: without python or openpyxl the passed stages still count — stamp written, workbook only a warning', () => {
  const m = makeEnv({ WB_PYTHON: 'wb-no-such-python' })
  try {
    const stamp = path.join(m.repo, '.git', 'wb', 'wb-gate-pass.json')
    w(path.join(m.repo, '.gitignore'), '/test-results/\n')
    w(path.join(m.repo, '.wb', 'verify.config.json'), { version: 1, stages: [{ name: 'ok', adapter: 'vitest', cmd: 'node -e "0"', slot: 'none' }] })
    git(m.repo, 'add', '.')
    git(m.repo, 'commit', '-q', '-m', 'verify config')
    const r = bin('wb-test-report', ['run'], m.env, m.repo)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stderr, /workbook skipped/)
    assert.match(r.stderr, /pip install openpyxl/)
    assert.match(r.stderr, /optional for the gate/)
    assert.ok(fs.existsSync(stamp))
    // a failed stage still blocks the stamp, with or without the workbook
    fs.rmSync(stamp)
    w(path.join(m.repo, '.wb', 'verify.config.json'), { version: 1, stages: [{ name: 'bad', adapter: 'vitest', cmd: 'node -e "process.exit(1)"', slot: 'none' }] })
    git(m.repo, 'commit', '-qam', 'failing stage')
    const bad = bin('wb-test-report', ['run'], m.env, m.repo)
    assert.equal(bad.status, 1, bad.stdout + bad.stderr)
    assert.ok(!fs.existsSync(stamp))
  } finally {
    m.cleanup()
  }
})

test('1 end to end: gate-pass on the integration branch lets the granted merge into main through', () => {
  const f = makeFixture()
  try {
    const cfg = { version: 1, gate: { command: 'node -e "0"' } }
    f.projectConfig(cfg)
    w(path.join(f.wt.int, '.wb', 'config.json'), cfg) // untracked: does not make the tree dirty
    const r = bin('wb-test-report', ['gate-pass'], f.env, f.wt.int)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    f.grant('merge-main', f.sha('wb/t/int'))
    assert.equal(f.judge('git merge wb/t/int').decision, 'allow')
  } finally {
    f.cleanup()
  }
})

// ── 4 a commit that only adds result files keeps the run valid ─────────
test('4 safety hook: a stamp stays valid when later commits only add result files', () => {
  const f = makeFixture()
  try {
    f.projectConfig({ version: 1, gate: { command: 'npm test' } })
    f.stamp(f.sha('wb/t/int'))
    w(path.join(f.wt.int, 'docs', 'test-results', '2026-10-17', 'integration-2238.xlsx'), 'x')
    git(f.wt.int, 'add', '.')
    git(f.wt.int, 'commit', '-q', '-m', 'results')
    f.grant('merge-main', f.sha('wb/t/int'))
    assert.equal(f.judge('git merge wb/t/int').decision, 'allow')

    // any other change after the stamp: run the gate again
    f.stamp(f.sha('wb/t/int'))
    w(path.join(f.wt.int, 'src.txt'), 'y')
    git(f.wt.int, 'add', '.')
    git(f.wt.int, 'commit', '-q', '-m', 'code')
    f.grant('merge-main', f.sha('wb/t/int'))
    const r = f.judge('git merge wb/t/int')
    assert.equal(r.decision, 'deny')
    assert.deepEqual(r.codes, ['stamp.head'])
    assert.match(formatReasons('en', r.reasons), /wb-test-report gate-pass/)
  } finally {
    f.cleanup()
  }
})

test('4 wb-check test-results: committing only the workbook does not ask to run again', () => {
  const m = makeEnv()
  try {
    const ran = git(m.repo, 'rev-parse', '--short', 'HEAD')
    const x = path.join(m.repo, 'docs', 'test-results', '2026-10-17', 'final-2238.xlsx')
    w(x, 'x')
    w(x.replace('.xlsx', '.json'), { verdict: 'passed', meta: { name: 'final', commit: ran }, suites: [], gate: [], failures: [], ledger: [] })
    git(m.repo, 'add', '.')
    git(m.repo, 'commit', '-q', '-m', 'results')
    let r = bin('wb-check', ['test-results', '--json'], m.env, m.repo)
    let j = JSON.parse(r.stdout)
    assert.ok(j.items.some((i) => i.id === 'head_results_only' && i.level === 'ok'), r.stdout)
    assert.ok(!j.items.some((i) => i.id === 'head_differs'))

    w(path.join(m.repo, 'a.txt'), 'changed\n')
    git(m.repo, 'commit', '-q', '-am', 'code')
    r = bin('wb-check', ['test-results', '--json'], m.env, m.repo)
    j = JSON.parse(r.stdout)
    assert.ok(j.items.some((i) => i.id === 'head_differs' && i.level === 'warn'), r.stdout)
  } finally {
    m.cleanup()
  }
})

// ── 5 push block names the target branch ───────────────────────────────
test('5 protected push message names the pushed-to branch, not the checked-out one', () => {
  const f = makeFixture()
  try {
    const r = f.judge('git push origin wb/t/int:main', { cwd: f.wt.int })
    assert.equal(r.decision, 'deny')
    const text = formatReasons('en', r.reasons)
    assert.match(text, /protected branch `main`/)
    assert.doesNotMatch(text, /`wb\/t\/int`/)
  } finally {
    f.cleanup()
  }
})

// ── 2 test counts in a lane report ─────────────────────────────────────
test('2 review item 8: counts after the word are read, a failure-before-the-fix record is not a failure', async () => {
  const { passCount, failCount } = await import('../lib/review.mjs')
  assert.equal(passCount('시험: 통과 1 / 실패 0'), 1)
  assert.equal(failCount('시험: 통과 1 / 실패 0'), 0)
  assert.equal(passCount('tests: passed: 7'), 7)
  assert.equal(passCount('12 passed'), 12)
  assert.equal(failCount('수정 전 실패 1건'), null)
  assert.equal(failCount('회귀 시험: 수정 전 실패 1건, 수정 후 통과 3'), null)
  assert.equal(failCount('failed before the fix: 1'), null)
  assert.equal(failCount('시험: 통과 5 / 실패 2'), 2)
  assert.equal(failCount('3 failed'), 3)
})

test('2 lane briefs tell how to write the test result line', () => {
  for (const lang of ['ko', 'en']) {
    for (const kind of ['impl', 'fix', 'test']) {
      const body = fs.readFileSync(path.join(HERE, '..', 'templates', 'briefs', lang, `${kind}.md`), 'utf8')
      assert.match(body, lang === 'ko' ? /`시험: 통과 12 \/ 실패 0`/ : /`tests: 12 passed \/ 0 failed`/, `${lang}/${kind}`)
    }
  }
})

// ── 7 run output follows the language setting ──────────────────────────
test('7 wb-test-report run: [verify] lines in the configured language', () => {
  const m = makeEnv({ WB_PYTHON: 'wb-no-such-python' })
  try {
    m.personal({ language: 'ko' })
    w(path.join(m.repo, '.wb', 'verify.config.json'), { version: 1, stages: [{ name: 'ok', adapter: 'vitest', cmd: 'node -e "0"', slot: 'none' }] })
    const r = bin('wb-test-report', ['run'], m.env, m.repo)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /\[verify\] 결과 폴더 .* 실패 단계 없음/)
    assert.match(r.stderr, /\[verify\] 엑셀 생성을 건너뜁니다/)
    assert.doesNotMatch(r.stdout + r.stderr, /results folder|workbook skipped/)
  } finally {
    m.cleanup()
  }
})

// ── 6 only skills that ship are mentioned ──────────────────────────────
test('6 messages, skills and READMEs name only skills that exist', () => {
  const root = path.join(HERE, '..')
  const names = new Set(fs.readdirSync(path.join(root, 'skills')).filter((d) => fs.existsSync(path.join(root, 'skills', d, 'SKILL.md'))))
  const files = ['locales/ko.json', 'locales/en.json', 'README.md', 'README.ko.md', ...[...names].map((n) => `skills/${n}/SKILL.md`)]
  for (const f of files) {
    for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/\/wb:([a-z][a-z0-9-]*)/g)) assert.ok(names.has(m[1]), `${f}: /wb:${m[1]}`)
  }
})

// ── 8 return brief names the real branch ───────────────────────────────
test('8 wb-check lane: the return brief carries the lane branch name', () => {
  const m = makeEnv()
  try {
    const wt = path.join(m.base, 'wt-l1')
    git(m.repo, 'worktree', 'add', '-q', '-b', 'wb/search/l1', wt)
    const sd = path.join(m.repo, '.git', 'wb')
    w(path.join(sd, 'lanes.json'), { lanes: [{ id: 'l1', branch: 'wb/search/l1', worktree: wt, integration: 'main' }] })
    const brief = path.join(m.repo, '.wb', 'briefs', 'l1-return-1.md')
    let r = bin('wb-check', ['lane', 'l1', '--lane-dir', wt], m.env, m.repo)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    let body = fs.readFileSync(brief, 'utf8')
    assert.match(body, /\(branch wb\/search\/l1\)/)
    assert.match(body, /own lane branch \(wb\/search\/l1\)/)
    // without --lane-dir the lane ledger gives the branch
    r = bin('wb-check', ['lane', 'l1'], m.env, m.repo)
    body = fs.readFileSync(path.join(m.repo, '.wb', 'briefs', 'l1-return-2.md'), 'utf8')
    assert.match(body, /\(branch wb\/search\/l1\)/)
  } finally {
    m.cleanup()
  }
})

// ── 9 wb-explain code fills value slots ────────────────────────────────
test('9 wb-explain code: no raw {name} slot in the message', () => {
  const m = makeEnv()
  try {
    const r = bin('wb-explain', ['code', 'safety.kill.pattern'], m.env, m.repo)
    assert.equal(r.status, 0, r.stderr)
    assert.doesNotMatch(r.stdout, /\{\w+\}/)
    assert.match(r.stdout.split('\n')[0], /`<cmd>`/)
  } finally {
    m.cleanup()
  }
})

// ── 10 missing brief file ──────────────────────────────────────────────
test('10 wb-check brief: a missing file gives a message, not a stack', () => {
  const m = makeEnv()
  try {
    const r = bin('wb-check', ['brief', '.wb/briefs/none.md'], m.env, m.repo)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /The brief file \.wb\/briefs\/none\.md does not exist/)
    assert.doesNotMatch(r.stderr, /ENOENT|at .*\.mjs/)
  } finally {
    m.cleanup()
  }
})

// ── 11 grant expiry in local time ──────────────────────────────────────
test('11 /wb:approve: the expiry is shown in local time with the offset', async () => {
  const { localTime, handleApprove } = await import('../hooks/scripts/safety/approve.mjs')
  assert.match(localTime('2026-10-17T13:55:35.519Z'), /^2026-10-1[78] \d\d:\d\d \(UTC[+-]\d\d:\d\d\)$/)
  const f = makeFixture()
  try {
    const r = handleApprove({ hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'wb:approve', command_args: 'merge-main', command_source: 'plugin', cwd: f.repo, session_id: 's1' }, f.env)
    const text = r.hookSpecificOutput.additionalContext
    assert.ok(text.includes(localTime(f.readGrant().expires)), text)
    assert.doesNotMatch(text, /\d{4}-\d\d-\d\dT\d\d:\d\d/)
  } finally {
    f.cleanup()
  }
})

// ── 12 SECURITY states what reads conversation logs ────────────────────
test('12 SECURITY: the token guard row says what it reads from ~/.claude.json and that the command reads logs without a budget', () => {
  const root = path.join(HERE, '..')
  assert.match(fs.readFileSync(path.join(root, 'SECURITY.ko.md'), 'utf8'), /훅은 공식 사용량도 예산\(`token_guard\.budget`\)도 없으면 대화 기록을 읽지 않는다\. 사람이 `wb-token status`/)
  assert.match(fs.readFileSync(path.join(root, 'SECURITY.md'), 'utf8'), /With neither an official value nor a budget .* the hook reads no conversation logs\. Running `wb-token status`/)
})

// ── 14 no internal lane names in rule text ─────────────────────────────
test('14 rule catalog: a planned rule does not show an internal lane name', async () => {
  const { translator } = await import('../lib/i18n.mjs')
  for (const lang of ['ko', 'en']) {
    const text = translator(lang)('rules.where.planned', { lane: 'L10' })
    assert.doesNotMatch(text, /L\d+/)
  }
  const root = path.join(HERE, '..')
  for (const f of ['rules/catalog.ko.md', 'rules/catalog.en.md', 'docs/ko/04-rules.md', 'docs/en/04-rules.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /\bL\d+ (레인|lane)|lane L\d+/, f)
  }
})
