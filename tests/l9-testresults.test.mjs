// L9 test result workbook: python adapter/workbook tests, wb-test-report, runners, wb-check test-results.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { makeEnv, bin, git, ROOT } from './l3-fixture.mjs'
import { gateSteps, splitChain, runGate } from '../templates/test-results/project/run-gate.mjs'
import { parseArgs, runVerify, slotWrap } from '../templates/test-results/project/verify-all.mjs'
import { findLatest, expandTemplate, summarize, pythonStatus } from '../lib/testresults.mjs'

const py = pythonStatus()
// makeEnv() gives the child a fake HOME, which hides a `pip --user` install of openpyxl.
const userBase = py.python === 'ok' ? spawnSync(py.cmd, ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).stdout.trim() : ''
const w = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body))
  return file
}

test('python: adapters, ledger and workbook unittest suite', { skip: py.python !== 'ok' && 'python3 3.8+ not found' }, () => {
  const r = spawnSync(py.cmd, ['-W', 'error', '-m', 'unittest', 'discover', '-s', 'tests/py', '-t', 'tests/py'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /Ran \d+ tests/)
  // the workbook tests must really run when openpyxl is there
  if (py.openpyxl) assert.doesNotMatch(r.stderr, /skipped/)
})

// ── helpers ─────────────────────────────────────────────────────────────
test('splitChain and gateSteps: script chain, explicit steps, missing script', () => {
  assert.deepEqual(splitChain('npm run lint && npm run typecheck && pnpm -r test').map((s) => s.name), ['lint', 'typecheck', 'pnpm -r'])
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-l9-'))
  w(path.join(tmp, 'package.json'), { scripts: { gate: 'npm run a && npm run b' } })
  assert.deepEqual(gateSteps({ gate: { script: 'gate' } }, tmp).map((s) => s.name), ['a', 'b'])
  assert.deepEqual(gateSteps({ gate: { steps: [{ name: 'x', cmd: 'true' }] } }, tmp), [{ name: 'x', cmd: 'true' }])
  assert.deepEqual(gateSteps({}, tmp), [])
  assert.throws(() => gateSteps({ gate: { script: 'nope' } }, tmp), /no script/)
  fs.rmSync(tmp, { recursive: true })
})

test('expandTemplate and findLatest: newest date folder, then newest file', () => {
  assert.equal(expandTemplate('docs/test-results/{date}/{name}-{HHMM}.xlsx', 'run', new Date(2026, 0, 5, 9, 7)), 'docs/test-results/2026-01-05/run-0907.xlsx')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-l9-'))
  assert.equal(findLatest(path.join(tmp, 'none')), null)
  w(path.join(tmp, '2026-01-02', 'a-0900.xlsx'), 'x')
  w(path.join(tmp, '2026-01-03', 'b-0800.xlsx'), 'x')
  w(path.join(tmp, '2026-01-03', '~$lock.xlsx'), 'x')
  assert.equal(path.basename(findLatest(tmp)), 'b-0800.xlsx')
  fs.rmSync(tmp, { recursive: true })
})

test('summarize counts by kind, gate and ledger', () => {
  const s = summarize({ verdict: 'failed', meta: { name: 'n', commit: 'c', ledgerCases: 3, ledgerCompared: true }, suites: [
    { kind: 'unit', total: 4, passed: 3, failed: 1, skipped: 0, flaky: 0 }, { kind: 'unit', total: 2, passed: 2, failed: 0, skipped: 0, flaky: 0 }],
  gate: [{ status: 'passed' }, { status: 'failed' }, { status: 'notRun' }], failures: [{ status: 'failed' }, { status: 'flaky' }], ledger: [{}, {}] })
  assert.deepEqual(s.kinds.unit, { suites: 2, total: 6, passed: 5, failed: 1, skipped: 0, flaky: 0 })
  assert.deepEqual(s.gate, { steps: 3, failed: 1, notRun: 1 })
  assert.deepEqual([s.failures, s.flaky, s.ledger], [1, 1, { cases: 3, mismatches: 2 }])
  assert.equal(summarize(null), null)
})

test('slotWrap: heavy command goes through wb-slot, none and --no-slot do not', () => {
  assert.deepEqual(slotWrap('echo a', 'heavy,browser', { slotBin: '/x/wb-slot', enabled: true }), { argv: ['/x/wb-slot', '--kind', 'heavy,browser', '--', 'sh', '-c', 'echo a'] })
  assert.deepEqual(slotWrap('echo a', 'none', { slotBin: '/x', enabled: true }), { cmd: 'echo a' })
  assert.deepEqual(slotWrap('echo a', 'heavy', { slotBin: '/x', enabled: false }), { cmd: 'echo a' })
  assert.equal(parseArgs(['--name=n', '--skip=a,b', '--no-slot', '--out-template=t']).slot, false)
  assert.deepEqual(parseArgs(['--skip=a,b']).skip, ['a', 'b'])
})

// ── run-gate ────────────────────────────────────────────────────────────
test('run-gate: pass, fail, notRun after a failure, skip; --no-bail keeps going', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-l9-'))
  const config = { gate: { steps: [
    { name: 'ok', cmd: 'node -e "process.exit(0)"' },
    { name: 'bad', cmd: 'node -e "console.error(\'Error: boom\');process.exit(3)"' },
    { name: 'after', cmd: 'node -e "process.exit(0)"' },
    { name: 'later', cmd: 'node -e "process.exit(0)"' }] } }
  const a = await runGate({ root: tmp, config, resultsDir: 'r1', skip: ['later'], echo: false })
  assert.equal(a.exit, 3)
  assert.deepEqual(a.rows.map((r) => r.status), ['passed', 'failed', 'notRun', 'skipped'])
  assert.match(a.rows[1].detail, /boom/)
  assert.equal(a.rows[1].exit, 3)
  assert.ok(fs.existsSync(a.rows[1].log))
  const rec = JSON.parse(fs.readFileSync(path.join(tmp, 'r1', 'gate.json'), 'utf8'))
  assert.equal(rec.steps.length, 4)
  const b = await runGate({ root: tmp, config, resultsDir: 'r2', bail: false, echo: false })
  assert.deepEqual(b.rows.map((r) => r.status), ['passed', 'failed', 'passed', 'passed'])
  // the log is complete when the step ends (flush before resolve)
  assert.match(fs.readFileSync(b.rows[1].log, 'utf8'), /boom/)
  fs.rmSync(tmp, { recursive: true })
})

// ── verify-all ──────────────────────────────────────────────────────────
function project(extraStages = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-l9-'))
  git(tmp, 'init', '-q', '-b', 'main')
  w(path.join(tmp, 'emit.mjs'), `import fs from 'node:fs'
const [file, failed] = process.argv.slice(2)
const results = [{ name: '/p/a.test.ts', startTime: 1, endTime: 9, assertionResults: [
  { ancestorTitles: [], title: 'one', status: 'passed' },
  ...(failed === '1' ? [{ ancestorTitles: ['grp'], title: 'two', status: 'failed', failureMessages: ['Error: nope\\n at a.test.ts:5:1'] }] : [])] }]
fs.writeFileSync(file, JSON.stringify({ numTotalTests: failed === '1' ? 2 : 1, testResults: results }))
process.exit(failed === '1' ? 1 : 0)
`)
  const config = { version: 1, gate: { steps: [{ name: 'lint', cmd: 'node -e "process.exit(0)"' }, { name: 'types', cmd: 'node -e "process.exit(0)"' }] },
    stages: [{ name: 'unit', adapter: 'vitest', kind: 'unit', suite: 'app', cmd: 'node emit.mjs {file} 1', slot: 'none' }, ...extraStages] }
  w(path.join(tmp, '.wb', 'verify.config.json'), config)
  return { tmp, config }
}

test('verify-all: no-bail run records stages, builds workbook and summary, exit 1 on a failed stage', { skip: !py.ok && 'python3 + openpyxl not available' }, async () => {
  const { tmp, config } = project([{ name: 'unit2', adapter: 'vitest', kind: 'integration', suite: 'db', cmd: 'node emit.mjs {file} 0', slot: 'none' }])
  const r = await runVerify({ root: tmp, configObject: config, name: 'itest', skip: [], only: [], slot: false, echo: false,
    outTemplate: 'docs/test-results/{date}/{name}-{HHMM}.xlsx' })
  assert.equal(r.exit, 1)
  assert.deepEqual(r.manifest.stages.map((s) => `${s.name}:${s.status}`), ['gate:passed', 'unit:failed', 'unit2:passed'])
  assert.equal(r.manifest.results.length, 2)
  const xlsx = findLatest(path.join(tmp, 'docs', 'test-results'))
  assert.ok(xlsx && xlsx.includes('itest-'), 'workbook written under the template')
  const sum = JSON.parse(fs.readFileSync(xlsx.replace(/\.xlsx$/, '.json'), 'utf8'))
  assert.equal(sum.verdict, 'failed')
  assert.deepEqual(sum.suites.map((s) => [s.kind, s.name, s.failed]).sort(), [['integration', 'db', 0], ['unit', 'app', 1]])
  assert.equal(sum.gate.length, 2)
  assert.equal(sum.failures[0].name, 'grp > two')
  fs.rmSync(tmp, { recursive: true })
})

test('verify-all: --only limits the stages; skipped stage is recorded', { skip: !py.ok && 'python3 + openpyxl not available' }, async () => {
  const { tmp, config } = project()
  const r = await runVerify({ root: tmp, configObject: config, name: 'only', skip: [], only: ['gate'], slot: false, echo: false })
  assert.deepEqual(r.manifest.stages.map((s) => `${s.name}:${s.status}`), ['gate:passed', 'unit:skipped'])
  assert.equal(r.exit, 0)
  fs.rmSync(tmp, { recursive: true })
})

test('verify-all: without python the workbook is skipped with an install hint and the raw results stay', async () => {
  const { tmp, config } = project()
  const saved = process.env.WB_PYTHON
  process.env.WB_PYTHON = '/nonexistent/python3'
  const errs = []
  const orig = console.error
  console.error = (...a) => errs.push(a.join(' '))
  try {
    const r = await runVerify({ root: tmp, configObject: config, name: 'nopy', skip: [], only: [], slot: false, echo: false })
    assert.equal(r.report.skipped, true)
    assert.deepEqual(r.failed, ['unit'])
    assert.ok(fs.existsSync(path.join(r.dir, 'manifest.json')))
  } finally {
    console.error = orig
    if (saved === undefined) delete process.env.WB_PYTHON
    else process.env.WB_PYTHON = saved
  }
  assert.match(errs.join('\n'), /python3 was not found/)
  assert.match(errs.join('\n'), /pip install openpyxl/)
  fs.rmSync(tmp, { recursive: true })
})

test('verify-all: a gate.script missing from package.json stops with a fix hint, no stack trace, no results folder', async () => {
  const { tmp } = project()
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node -e 0' } }))
  const config = { version: 1, gate: { script: 'gate' }, stages: [] }
  const errs = []
  const orig = console.error
  console.error = (...a) => errs.push(a.join(' '))
  try {
    for (const lang of ['en', 'ko']) {
      const r = await runVerify({ root: tmp, configObject: config, name: 'nogate', skip: [], only: [], slot: false, echo: false, lang })
      assert.equal(r.exit, 1)
    }
  } finally {
    console.error = orig
  }
  assert.match(errs[0], /package\.json has no script "gate".*gate\.steps/)
  assert.match(errs[1], /package\.json 에 "gate" 스크립트가 없습니다.*gate\.steps/)
  assert.ok(!fs.existsSync(path.join(tmp, 'test-results', 'runs')), 'nothing written before the config is usable')
  fs.rmSync(tmp, { recursive: true })
})

// ── wb-test-report ──────────────────────────────────────────────────────
test('wb-test-report: env guide, skip on missing python (exit 0), --require exit 3, init once', () => {
  const m = makeEnv({ WB_PYTHON: '/nonexistent/python3' })
  try {
    const e = bin('wb-test-report', ['env'], m.env, m.repo)
    assert.equal(e.status, 3)
    assert.match(e.stderr, /python3 was not found/)
    assert.match(e.stderr, /brew install python3/)
    const b = bin('wb-test-report', ['build'], m.env, m.repo)
    assert.equal(b.status, 0)
    assert.match(b.stderr, /Skipping the workbook/)
    assert.equal(bin('wb-test-report', ['build', '--require'], m.env, m.repo).status, 3)
    m.personal({ language: 'ko' })
    assert.match(bin('wb-test-report', ['env'], m.env, m.repo).stderr, /python3 를 찾지 못했습니다/)
    const i1 = bin('wb-test-report', ['init'], m.env, m.repo)
    assert.equal(i1.status, 0)
    assert.ok(fs.existsSync(path.join(m.repo, '.wb', 'verify.config.json')))
    assert.match(bin('wb-test-report', ['init'], m.env, m.repo).stdout, /이미 있습니다/)
    assert.equal(bin('wb-test-report', ['bogus'], m.env, m.repo).status, 2)
  } finally { m.cleanup() }
})

test('wb-test-report: run without a config asks for init; build -> latest -> summary', { skip: !py.ok && 'python3 + openpyxl not available' }, () => {
  const m = makeEnv({ PYTHONUSERBASE: userBase })
  try {
    assert.equal(bin('wb-test-report', ['run'], m.env, m.repo).status, 2)
    assert.equal(bin('wb-test-report', ['latest'], m.env, m.repo).status, 1)
    const v = path.join(m.repo, 'v.json')
    w(v, { numTotalTests: 2, testResults: [{ name: 'a.test.ts', startTime: 1, endTime: 5, assertionResults: [
      { ancestorTitles: [], title: 'ok', status: 'passed' }, { ancestorTitles: [], title: 'bad', status: 'failed', failureMessages: ['x'] }] }] })
    const b = bin('wb-test-report', ['build', '--name', 'smoke', '--input', `vitest:unit:app=${v}`], m.env, m.repo)
    assert.equal(b.status, 0, b.stderr)
    const latest = bin('wb-test-report', ['latest'], m.env, m.repo).stdout.trim()
    assert.match(latest, /^docs\/test-results\/\d{4}-\d\d-\d\d\/smoke-\d{4}\.xlsx$/)
    const s = bin('wb-test-report', ['summary'], m.env, m.repo)
    assert.match(s.stdout, /판정|verdict failed/)
    const j = JSON.parse(bin('wb-test-report', ['summary', '--json'], m.env, m.repo).stdout)
    assert.deepEqual([j.verdict, j.kinds.unit.total, j.kinds.unit.failed], ['failed', 2, 1])
  } finally { m.cleanup() }
})

// ── wb-check test-results ───────────────────────────────────────────────
const summaryJson = (over = {}) => ({ verdict: 'passed', meta: { name: 'run', commit: '', ...over.meta }, suites: [], gate: [], failures: [], ledger: [], ...over, meta: { name: 'run', commit: '', ...over.meta } })

test('wb-check test-results: none -> fail; untracked -> fail; committed -> pass', () => {
  const m = makeEnv()
  try {
    let r = bin('wb-check', ['test-results'], m.env, m.repo)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /No result workbook/)
    assert.match(r.stdout, /wb-test-report run/)
    const x = path.join(m.repo, 'docs', 'test-results', '2026-01-02', 'final-0900.xlsx')
    w(x, 'xlsx')
    w(x.replace('.xlsx', '.json'), summaryJson())
    r = bin('wb-check', ['test-results'], m.env, m.repo)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /Not committed: .*final-0900\.xlsx/)
    git(m.repo, 'add', '.')
    git(m.repo, 'commit', '-q', '-m', 'results')
    r = bin('wb-check', ['test-results'], m.env, m.repo)
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /Committed/)
    assert.match(r.stdout, /Verdict: passed/)
    // a later edit of the workbook makes it dirty again
    w(x, 'xlsx2')
    assert.equal(bin('wb-check', ['test-results'], m.env, m.repo).status, 1)
  } finally { m.cleanup() }
})

test('wb-check test-results: broad .gitignore pattern hides the folder -> not committed', () => {
  const m = makeEnv()
  try {
    w(path.join(m.repo, '.gitignore'), 'test-results/\n')
    w(path.join(m.repo, 'docs', 'test-results', '2026-01-02', 'a-0900.xlsx'), 'x')
    git(m.repo, 'add', '-A', '.')
    git(m.repo, 'commit', '-q', '-m', 'x')
    const r = bin('wb-check', ['test-results'], m.env, m.repo)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /\.gitignore/)
  } finally { m.cleanup() }
})

test('wb-check test-results: verdict failed is a warning unless --require-pass; HEAD mismatch warns; ledger mismatch fails', () => {
  const m = makeEnv()
  try {
    const x = path.join(m.repo, 'docs', 'test-results', '2026-01-02', 'final-0900.xlsx')
    w(x, 'x')
    const head = git(m.repo, 'rev-parse', '--short', 'HEAD')
    w(x.replace('.xlsx', '.json'), summaryJson({ verdict: 'failed', meta: { commit: 'deadbee' } }))
    git(m.repo, 'add', '.')
    git(m.repo, 'commit', '-q', '-m', 'results')
    let r = bin('wb-check', ['test-results'], m.env, m.repo)
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /⚠ Verdict: failed/)
    assert.match(r.stdout, /differs from the current HEAD/)
    assert.equal(bin('wb-check', ['test-results', '--require-pass'], m.env, m.repo).status, 1)

    w(x.replace('.xlsx', '.json'), summaryJson({ verdict: 'passed', meta: { commit: head, ledgerCases: 4, ledgerCompared: true }, ledger: [{ caseId: 'A-001' }] }))
    git(m.repo, 'add', '.')
    git(m.repo, 'commit', '-q', '-m', 'ledger')
    r = bin('wb-check', ['test-results', '--json'], m.env, m.repo)
    assert.equal(r.status, 1)
    const j = JSON.parse(r.stdout)
    assert.equal(j.ok, false)
    assert.ok(j.items.some((i) => i.id === 'ledger_mismatch' && i.level === 'fail' && i.vars.n === 1))

    w(x.replace('.xlsx', '.json'), summaryJson({ verdict: 'passed', meta: { commit: '', ledgerCases: 4, ledgerCompared: true } }))
    git(m.repo, 'add', '.')
    git(m.repo, 'commit', '-q', '-m', 'agree')
    r = bin('wb-check', ['test-results'], m.env, m.repo)
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /0 mismatches/)
  } finally { m.cleanup() }
})

test('wb-check test-results: paths.test_results from the project config and Korean messages', () => {
  const m = makeEnv()
  try {
    m.personal({ language: 'ko' })
    w(path.join(m.repo, '.wb', 'config.json'), { version: 1, paths: { test_results: 'evidence/{date}/{name}.xlsx' } })
    w(path.join(m.repo, 'evidence', '2026-02-01', 'run.xlsx'), 'x')
    w(path.join(m.repo, 'evidence', '2026-02-01', 'run.json'), summaryJson())
    git(m.repo, 'add', '-f', '.')
    git(m.repo, 'commit', '-q', '-m', 'e')
    const r = bin('wb-check', ['test-results'], m.env, m.repo)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /시험 결과 점검 통과/)
    assert.match(r.stdout, /evidence\/2026-02-01\/run\.xlsx/)
  } finally { m.cleanup() }
})

test('wb-test-report run: a heavy stage runs inside wb-slot and the workbook lands at paths.test_results', { skip: !py.ok && 'python3 + openpyxl not available' }, () => {
  const m = makeEnv({ PYTHONUSERBASE: userBase })
  try {
    // a busy machine must not hold this test back
    w(path.join(m.env.WB_HOME, 'machine.json'), { version: 1, load: { max: 100000 } })
    w(path.join(m.repo, 'emit.mjs'), `import fs from 'node:fs'
fs.writeFileSync(process.argv[2], JSON.stringify({ numTotalTests: 1, testResults: [{ name: 'a.test.ts', assertionResults: [{ ancestorTitles: [], title: 'ok', status: 'passed' }] }] }))
fs.writeFileSync(process.argv[2] + '.held', process.env.WB_SLOT_HELD || 'none')
`)
    w(path.join(m.repo, '.wb', 'verify.config.json'), { version: 1, stages: [{ name: 'unit', adapter: 'vitest', kind: 'unit', suite: 'app', cmd: 'node emit.mjs {file}', slot: 'heavy' }] })
    w(path.join(m.repo, '.wb', 'config.json'), { version: 1, paths: { test_results: 'evidence/{date}/{name}-{HHMM}.xlsx' } })
    const r = bin('wb-test-report', ['run', '--name', 'slotted'], m.env, m.repo)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const xlsx = findLatest(path.join(m.repo, 'evidence'))
    assert.ok(xlsx && /slotted-\d{4}\.xlsx$/.test(xlsx), xlsx)
    const runs = path.join(m.repo, 'test-results', 'runs')
    const dir = path.join(runs, fs.readdirSync(runs)[0])
    assert.match(fs.readFileSync(path.join(dir, 'unit', 'result.json.held'), 'utf8'), /heavy/)
    assert.equal(JSON.parse(fs.readFileSync(xlsx.replace(/\.xlsx$/, '.json'), 'utf8')).verdict, 'passed')
  } finally { m.cleanup() }
})
