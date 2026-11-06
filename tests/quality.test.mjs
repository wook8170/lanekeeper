// Quality results per kind: parsers, common head, index, ship precheck (missing · stale · failed ·
// weakened · accepted), weakening chain, version roll-up, lanekeeper-quality and the ship gate hook.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeEnv, bin, git, runScript } from './l3-fixture.mjs'
import * as Q from '../lib/quality.mjs'
import { translator } from '../lib/i18n.mjs'
import { pythonStatus } from '../lib/testresults.mjs'

const t = translator('en')
const py = pythonStatus()
const w = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  return file
}
const S = (extra = {}) => Q.qualitySettings({ project: { quality: { suites: { unit: { command: 'x' }, e2e: { command: 'y', category: 'e2e' } }, ship: { requires: ['unit', 'e2e'] }, ...extra } } })

// A result file in the new layout, written directly so a test controls commit, time and counts.
let seq = 0
function result(repo, { kind = 'unit', version = '1.0.0', commit, verdict = 'passed', counts = {}, thresholds = [], dirty = false, minute }) {
  const m = minute ?? seq++
  const hh = String(10 + Math.floor(m / 60)).padStart(2, '0')
  const mm = String(m % 60).padStart(2, '0')
  const rel = `docs/test-results/${version}/2026-10-18/${kind}-${hh}${mm}.json`
  const head = Q.makeHead({
    kind, category: kind === 'e2e' ? 'e2e' : 'unit', version, commit, branch: 'main', dirty,
    startedAt: `2026-10-18T${hh}:${mm}:00.000+09:00`, endedAt: `2026-10-18T${hh}:${mm}:30.000+09:00`, env: Q.envInfo(),
    verdict, counts: { total: 10, passed: 10, ...counts }, thresholds, files: { json: rel, xlsx: null },
  })
  w(path.join(repo, rel), head)
  return rel
}
const commitAll = (repo, msg) => {
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', msg)
  return git(repo, 'rev-parse', 'HEAD')
}
const stateOf = (res, kind) => res.rows.find((r) => r.kind === kind).state

// ---- parsers -------------------------------------------------------------------

test('parsers: vitest todo is fixme, pending is skipped, failures keep the first line', () => {
  const f = w(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wbq-')), 'v.json'), { testResults: [{ assertionResults: [
    { status: 'passed' }, { status: 'failed', fullName: 'a b', failureMessages: ['\x1b[31mboom\x1b[0m\n at x'] }, { status: 'todo' }, { status: 'pending' }, { status: 'skipped' },
  ] }] })
  const r = Q.parseResult('vitest', { files: [f], suiteName: 'web' })
  assert.deepEqual(r.counts, { total: 5, passed: 1, failed: 1, skipped: 2, fixme: 1, flaky: 0 })
  assert.deepEqual(r.failures, [{ suite: 'web', name: 'a b', message: 'boom' }])
})

test('parsers: playwright fixme annotation, flaky counts as passed, per project suites', () => {
  const f = w(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wbq-')), 'p.json'), { suites: [{ title: 'a.spec.ts', specs: [
    { title: 'ok', tests: [{ projectName: 'react', status: 'expected' }, { projectName: 'vue', status: 'flaky' }] },
    { title: 'held', tests: [{ projectName: 'react', status: 'skipped', annotations: [{ type: 'fixme' }] }, { projectName: 'vue', status: 'skipped' }] },
  ], suites: [{ title: 'inner', specs: [{ title: 'bad', tests: [{ projectName: 'react', status: 'unexpected', results: [{ error: { message: 'expected 1' } }] }] }] }] }] })
  const r = Q.parseResult('playwright', { files: [f], suiteName: 'e2e' })
  assert.deepEqual(r.counts, { total: 5, passed: 2, failed: 1, skipped: 1, fixme: 1, flaky: 1 })
  assert.deepEqual(r.suites.map((s) => [s.name, s.total]), [['react', 3], ['vue', 2]])
  assert.equal(r.failures[0].name, 'a.spec.ts › inner › bad')
  assert.equal(r.failures[0].message, 'expected 1')
})

test('parsers: junit xml, vitest log lines summed per package, custom json, steps, exit', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wbq-'))
  const x = w(path.join(d, 'j.xml'), '<testsuite><testcase name="a" classname="m"/><testcase name="b" classname="m"><failure message="nope"/></testcase><testcase name="c"><skipped/></testcase><testcase name="d"><skipped type="pytest.xfail"/></testcase></testsuite>')
  assert.deepEqual(Q.parseResult('pytest', { files: [x] }).counts, { total: 4, passed: 1, failed: 1, skipped: 1, fixme: 1, flaky: 0 })
  const log = 'packages/a test:       Tests  12 passed | 1 skipped (13)\npackages/b test:       Tests  3 passed | 2 todo (5)\n'
  const v = Q.parseResult('vitest-log', { log, suiteName: 'unit' })
  assert.deepEqual(v.counts, { total: 18, passed: 15, failed: 0, skipped: 1, fixme: 2, flaky: 0 })
  assert.deepEqual(v.suites.map((s) => s.name), ['packages/a', 'packages/b'])
  assert.throws(() => Q.parseResult('vitest-log', { log: 'nothing' }), /summary line/)
  const j = w(path.join(d, 'c.json'), { counts: { total: 4, passed: 3, failed: 1 }, failures: [{ name: 'task 2', message: 'lost' }] })
  assert.equal(Q.parseResult('json', { files: [j] }).counts.failed, 1)
  assert.throws(() => Q.parseResult('json', { files: [w(path.join(d, 'n.json'), {})] }), /counts.total/)
  const s = Q.parseResult('steps', { steps: [{ name: 'lint', exitCode: 0 }, { name: 'docs', exitCode: 2, tail: 'drift' }], suiteName: 'gate' })
  assert.deepEqual([s.counts.total, s.counts.failed, s.failures[0].message], [2, 1, 'exit 2 · drift'])
  assert.equal(Q.parseResult('exit', { exitCode: 3 }).counts.failed, 1)
  assert.throws(() => Q.parseResult('vitest', { files: [] }), /not found/)
  const many = [w(path.join(d, 'r-a.json'), { testResults: [{ assertionResults: [{ status: 'passed' }] }] }), w(path.join(d, 'r-b.json'), { testResults: [{ assertionResults: [{ status: 'passed' }] }] })]
  assert.deepEqual(Q.expandResultFiles(path.join(d, 'r-*.json')), many)
  assert.equal(Q.parseResult('vitest', { files: many }).suites.length, 2)
})

test('verdict: exit code, failures and an empty run', () => {
  assert.equal(Q.verdictOf({ exitCode: 0, counts: { total: 3, failed: 0 } }), 'passed')
  assert.equal(Q.verdictOf({ exitCode: 1, counts: { total: 3, failed: 0 } }), 'failed')
  assert.equal(Q.verdictOf({ exitCode: 0, counts: { total: 3, failed: 1 } }), 'failed')
  assert.equal(Q.verdictOf({ exitCode: 0, counts: { total: 0, failed: 0 } }), 'error')
  assert.equal(Q.verdictOf({ exitCode: 0, counts: {}, parseError: 'x' }), 'error')
})

test('head: required keys, schema and counts are checked', () => {
  const h = Q.makeHead({ kind: 'unit', category: 'unit', version: '1', commit: 'a', branch: 'b', startedAt: 's', endedAt: 'e', env: {}, verdict: 'passed', counts: { total: 1, passed: 1 }, files: {} })
  assert.deepEqual(Q.validateHead(h), [])
  assert.deepEqual(Q.validateHead({ ...h, category: 'x', verdict: 'ok' }), ['category x', 'verdict ok'])
  const { files, ...noFiles } = h
  assert.deepEqual(Q.validateHead(noFiles), ['missing files'])
  assert.match(Q.isoLocal(new Date(2026, 9, 18, 22, 5, 1)), /^2026-10-18T22:05:01\.000[+-]\d{2}:\d{2}$/)
})

// ---- weakening ------------------------------------------------------------------

test('weakening: fewer tests, more skipped or fixme, a changed threshold file', () => {
  const base = { commit: 'b', counts: { total: 10, skipped: 1, fixme: 0 }, thresholds: [{ file: 't.json', rule: 'hash', sha256: 'x' }] }
  assert.deepEqual(Q.weakening({ ...base, commit: 'c' }, base), [])
  const r = Q.weakening({ commit: 'c', counts: { total: 9, skipped: 1, fixme: 1 }, thresholds: [{ file: 't.json', rule: 'hash', sha256: 'y' }] }, base)
  assert.deepEqual(r.map((x) => x.code), ['total_down', 'skip_up', 'threshold_changed'])
  assert.deepEqual(Q.weakening({ commit: 'c', counts: { total: 12, skipped: 0 } }, base), [], 'more tests and fewer skips are fine')
  assert.deepEqual(Q.weakening({ commit: 'c', counts: { total: null } }, base), [], 'unknown counts are not compared')
})

test('weakening: max and min rules flag only the loosened direction, array growth always', () => {
  const files = { 'b:max.json': '{"p95":200,"allow":["a"]}', 'c:max.json': '{"p95":250,"allow":["a"]}', 'd:max.json': '{"p95":150,"allow":["a","b"]}', 'b:min.json': '{"score":0.9}', 'c:min.json': '{"score":0.8}', 'd:min.json': '{"score":0.95}' }
  const show = (commit, file) => files[`${commit}:${file}`] ?? null
  const thr = (sha) => [{ file: 'max.json', rule: 'max', sha256: sha }, { file: 'min.json', rule: 'min', sha256: sha }]
  const base = { commit: 'b', counts: {}, thresholds: thr('1') }
  const loose = Q.weakening({ commit: 'c', counts: {}, thresholds: thr('2') }, base, { show })
  assert.deepEqual(loose.map((x) => [x.code, x.vars.file]), [['threshold_loosened', 'max.json'], ['threshold_loosened', 'min.json']])
  assert.match(loose[0].vars.leaves, /p95 200→250/)
  const tight = Q.weakening({ commit: 'd', counts: {}, thresholds: thr('3') }, base, { show })
  assert.deepEqual(tight.map((x) => x.vars.leaves), ['allow.length 1→2'], 'a lower max is fine, a longer allow list is not')
  assert.deepEqual(Q.weakening({ commit: 'z', counts: {}, thresholds: thr('4') }, base, { show }).map((x) => x.code), ['threshold_changed', 'threshold_changed'], 'unreadable content falls back to changed')
})

test('baseline chain: a weakened result does not become the next baseline by running again', () => {
  const e = (json, commit, total, minute) => ({ kind: 'unit', verdict: 'passed', commit, json, counts: { total }, endedAt: `2026-10-18T10:${String(minute).padStart(2, '0')}` })
  const a = e('a', 'c1', 10, 1)
  const b = e('b', 'c2', 8, 2) // weaker than a, not accepted
  const c = e('c', 'c3', 8, 3) // same as b: must still compare against a
  const weaker = (cur, base) => Q.weakening(cur, base)
  assert.equal(Q.baselineOf([a, b, c], c, { weaker }), a)
  assert.equal(Q.baselineOf([a, b, c], c, { weaker, isAccepted: (x) => x === b }), b, 'an accepted weakening becomes the baseline')
  assert.equal(Q.baselineOf([a, b], a, { weaker }), null)
  assert.equal(Q.baselineOf([a, e('a2', 'c1', 10, 5)], e('x', 'c1', 10, 6), { weaker }), null, 'results on the same commit are not a baseline')
})

// ---- precheck in a repository ----------------------------------------------------------

test('precheck: missing, failed, stale after a code change, results-only commits stay valid, dirty run', () => {
  const f = makeEnv()
  const s = S()
  let head = git(f.repo, 'rev-parse', 'HEAD')
  let res = Q.precheck(f.repo, s)
  assert.deepEqual(res.rows.map((r) => r.state), ['missing', 'missing'])
  assert.ok(res.rows.every(Q.needsRun))
  result(f.repo, { kind: 'unit', commit: head })
  result(f.repo, { kind: 'e2e', commit: head, verdict: 'failed', counts: { failed: 2 } })
  head = commitAll(f.repo, 'results')
  res = Q.precheck(f.repo, s)
  assert.equal(stateOf(res, 'unit'), 'ok', 'a commit that only adds results keeps the run valid')
  assert.equal(stateOf(res, 'e2e'), 'failed')
  result(f.repo, { kind: 'e2e', commit: head })
  commitAll(f.repo, 'more results')
  assert.equal(Q.precheck(f.repo, s).ok, true)
  fs.writeFileSync(path.join(f.repo, 'a.txt'), 'changed\n')
  commitAll(f.repo, 'code')
  res = Q.precheck(f.repo, s)
  assert.deepEqual(res.rows.map((r) => r.state), ['stale', 'stale'])
  assert.equal(res.rows[0].reasons[0].vars.files, 'a.txt')
  head = git(f.repo, 'rev-parse', 'HEAD')
  result(f.repo, { kind: 'unit', commit: head, dirty: true })
  assert.equal(stateOf(Q.precheck(f.repo, s), 'unit'), 'stale', 'a run with uncommitted changes is stale')
  f.cleanup()
})

test('precheck: stale_paths limits what makes a result stale', () => {
  const f = makeEnv()
  const s = Q.qualitySettings({ project: { quality: { suites: { usability: { category: 'usability', stale_paths: ['src/**'] } }, ship: { requires: ['usability'] } } } })
  result(f.repo, { kind: 'usability', commit: git(f.repo, 'rev-parse', 'HEAD') })
  commitAll(f.repo, 'r')
  fs.writeFileSync(path.join(f.repo, 'README.md'), 'x\n')
  commitAll(f.repo, 'docs only')
  assert.equal(stateOf(Q.precheck(f.repo, s), 'usability'), 'ok')
  w(path.join(f.repo, 'src/ui/a.tsx'), 'x')
  commitAll(f.repo, 'ui')
  assert.equal(stateOf(Q.precheck(f.repo, s), 'usability'), 'stale')
  f.cleanup()
})

test('precheck: weakened against the previous passed result, accepted by the owner, manual kinds', () => {
  const f = makeEnv()
  const s = Q.qualitySettings({ project: { quality: { suites: { unit: { command: 'x' }, usability: { category: 'usability' } }, ship: { requires: ['unit', 'usability'] } } } })
  let res = Q.precheck(f.repo, s)
  assert.equal(stateOf(res, 'usability'), 'manual', 'no command: the skill runs it, the gate cannot')
  assert.ok(!Q.needsRun(res.rows[1]))
  result(f.repo, { kind: 'unit', commit: git(f.repo, 'rev-parse', 'HEAD'), counts: { total: 10, passed: 10 } })
  fs.writeFileSync(path.join(f.repo, 'a.txt'), 'b\n')
  const c2 = commitAll(f.repo, 'c2')
  result(f.repo, { kind: 'unit', commit: c2, counts: { total: 10, passed: 8, skipped: 1, fixme: 1 } })
  result(f.repo, { kind: 'usability', commit: c2 })
  commitAll(f.repo, 'results')
  res = Q.precheck(f.repo, s)
  assert.equal(stateOf(res, 'unit'), 'weakened')
  assert.deepEqual(res.rows[0].reasons.map((r) => r.code), ['skip_up'])
  assert.ok(!Q.needsRun(res.rows[0]), 'running again cannot fix a weakening')
  Q.recordAcceptance(f.repo, s, { kind: 'unit', commit: c2, reason: 'two tests moved to e2e' })
  assert.throws(() => Q.recordAcceptance(f.repo, s, { kind: 'unit', commit: c2, reason: ' ' }), /reason/)
  res = Q.precheck(f.repo, s)
  assert.equal(res.ok, true)
  f.cleanup()
})

// ---- index and roll-up ------------------------------------------------------------------

test('index: new layout, older date folders, inferred summaries, kept optional keys, markdown', () => {
  const f = makeEnv()
  const s = S()
  const head = git(f.repo, 'rev-parse', 'HEAD')
  result(f.repo, { kind: 'unit', commit: head, version: '1.10.0' })
  result(f.repo, { kind: 'e2e', commit: head, version: '1.9.0' })
  w(path.join(f.repo, 'docs/test-results/2026-10-01/integration-0930.json'), { meta: { commit: 'abc', name: 'integration' }, verdict: 'passed', suites: [{ total: 5, passed: 4, skipped: 1 }] })
  w(path.join(f.repo, 'docs/test-results/2026-10-01/integration-0930.xlsx'), 'x')
  w(path.join(f.repo, 'docs/test-results/2026-10-01/old-0800.xlsx'), 'x')
  w(path.join(f.repo, 'docs/test-results/1.9.0/quality-1.9.0.json'), { not: 'a result' })
  const idx = Q.writeIndex(f.repo, s, t)
  assert.equal(idx.schema, Q.INDEX_SCHEMA)
  assert.deepEqual(idx.entries.map((e) => [e.version, e.kind]), [['-', 'integration'], ['-', 'old'], ['1.9.0', 'e2e'], ['1.10.0', 'unit']])
  const legacy = idx.entries[0]
  assert.deepEqual([legacy.legacy, legacy.inferred, legacy.commit, legacy.counts.total, legacy.counts.fixme, legacy.xlsx], [true, true, 'abc', 5, null, '2026-10-01/integration-0930.xlsx'])
  // optional keys written by another tool survive a rebuild
  const file = path.join(f.repo, 'docs/test-results/index.json')
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  j.entries[0].originalPath = 'docs/test-results/2026-10-01/integration-0930.json'
  j.entries[0].run = 'verify-final'
  fs.writeFileSync(file, JSON.stringify(j))
  const again = Q.writeIndex(f.repo, s, t)
  assert.equal(again.entries[0].originalPath, 'docs/test-results/2026-10-01/integration-0930.json')
  assert.equal(again.entries[0].run, 'verify-final')
  const md = fs.readFileSync(path.join(f.repo, 'docs/test-results/INDEX.md'), 'utf8')
  assert.ok(md.indexOf('## 1.10.0') < md.indexOf('## 1.9.0') && md.indexOf('## 1.9.0') < md.indexOf('## Older layout'), 'newest version first')
  assert.match(md, /\| integration \(inferred\) \| passed \| abc \| 5 \| 4 \| 0 \| 1 \| - \|/)
  f.cleanup()
})

test('roll-up: latest result per kind of the version, missing kinds, issues, md and html', () => {
  const f = makeEnv()
  const s = S()
  const head = git(f.repo, 'rev-parse', 'HEAD')
  result(f.repo, { kind: 'unit', commit: head, verdict: 'failed', counts: { failed: 1 } })
  const latest = result(f.repo, { kind: 'unit', commit: head, counts: { skipped: 2 } })
  result(f.repo, { kind: 'e2e', commit: head, version: '0.9.0' })
  const r = Q.writeRollup(f.repo, s, '1.0.0', t, { noXlsx: true })
  assert.equal(r.latest.find((l) => l.kind === 'unit').entry.json, latest.replace('docs/test-results/', ''))
  assert.deepEqual(r.missing, ['e2e'], 'a result of another version does not count')
  assert.equal(r.allPassed, false)
  assert.equal(r.history.length, 2)
  const md = fs.readFileSync(path.join(f.repo, r.files.md), 'utf8')
  assert.match(md, /^# Quality report 1\.0\.0/)
  assert.match(md, /## Required verifications without a result\n\n- e2e/)
  assert.match(md, /unit: 2 skipped, 0 fixme/)
  const html = fs.readFileSync(path.join(f.repo, r.files.html), 'utf8')
  assert.match(html, /prefers-color-scheme: dark/)
  assert.match(html, /<table>/)
  assert.doesNotMatch(html, /<script/)
  f.cleanup()
})

test('roll-up: a weakened latest result is not reported as all passed', () => {
  const f = makeEnv()
  const s = Q.qualitySettings({ project: { quality: { suites: { unit: { command: 'x' } }, ship: { requires: ['unit'] } } } })
  result(f.repo, { kind: 'unit', commit: git(f.repo, 'rev-parse', 'HEAD'), counts: { total: 10 } })
  fs.writeFileSync(path.join(f.repo, 'a.txt'), 'b\n')
  result(f.repo, { kind: 'unit', commit: commitAll(f.repo, 'c2'), counts: { total: 7, passed: 7 } })
  const r = Q.writeRollup(f.repo, s, '1.0.0', t, { noXlsx: true })
  assert.equal(r.allPassed, false)
  assert.deepEqual(r.latest[0].weakened.map((x) => x.code), ['total_down'])
  assert.match(fs.readFileSync(path.join(f.repo, r.files.md), 'utf8'), /## Verifications weaker than the previous passed result\n\n- unit: fewer tests 10→7/)
  f.cleanup()
})

test('roll-up and result workbooks are written with openpyxl', { skip: !py.ok && 'python3 + openpyxl not available' }, () => {
  const f = makeEnv()
  const s = S()
  const head = git(f.repo, 'rev-parse', 'HEAD')
  const h = Q.makeHead({ kind: 'unit', category: 'unit', version: '1.0.0', commit: head, branch: 'main', startedAt: 's', endedAt: 'e', env: Q.envInfo(), verdict: 'failed', counts: { total: 2, passed: 1, failed: 1 }, failures: [{ suite: 'a', name: 'b', message: 'c\x07' }], files: {} })
  const base = Q.resultBase(f.repo, s, '1.0.0', 'unit', new Date(2026, 9, 18, 9, 5))
  Q.saveResult(f.repo, base, h, t)
  assert.equal(h.files.xlsx, 'docs/test-results/1.0.0/2026-10-18/unit-0905.xlsx')
  assert.ok(fs.statSync(path.join(f.repo, h.files.xlsx)).size > 1000)
  assert.equal(Q.resultBase(f.repo, s, '1.0.0', 'unit', new Date(2026, 9, 18, 9, 5)).endsWith('unit-0905-2'), true, 'the same minute gets a number')
  const r = Q.writeRollup(f.repo, s, '1.0.0', t)
  assert.equal(r.files.xlsx, 'docs/test-results/1.0.0/quality-1.0.0.xlsx')
  f.cleanup()
})

// ---- lanekeeper-quality and the hook ------------------------------------------------------------

function project(f, quality) {
  w(path.join(f.repo, '.lanekeeper/config.json'), { version: 1, quality })
  fs.writeFileSync(path.join(f.repo, '.gitignore'), 'test-results/\n')
  fs.writeFileSync(path.join(f.repo, 'VERSION'), '2.0.0\n')
  commitAll(f.repo, 'config')
}

test('lanekeeper-quality: run writes the head json and the index, precheck --run runs what is missing and blocks failures', () => {
  const f = makeEnv()
  project(f, {
    suites: {
      unit: { command: `printf '{"testResults":[{"assertionResults":[{"status":"passed"},{"status":"todo"}]}]}' > {file}`, parser: 'vitest', slot: 'none' },
      gate: { category: 'gate', steps: [{ name: 'lint', cmd: 'true' }, { name: 'docs', cmd: 'exit 3' }], slot: 'none' },
    },
    ship: { requires: ['unit', 'gate'] },
  })
  const run = bin('lanekeeper-quality', ['run', 'unit', '--no-xlsx'], f.env, f.repo)
  assert.equal(run.status, 0, run.stderr)
  const idx = JSON.parse(fs.readFileSync(path.join(f.repo, 'docs/test-results/index.json'), 'utf8'))
  assert.equal(idx.entries.length, 1)
  const h = JSON.parse(fs.readFileSync(path.join(f.repo, 'docs/test-results', idx.entries[0].json), 'utf8'))
  assert.deepEqual(Q.validateHead(h), [])
  assert.deepEqual([h.version, h.kind, h.verdict, h.counts.fixme, h.dirty, h.raw.committed], ['2.0.0', 'unit', 'passed', 1, false, false])
  assert.ok(fs.existsSync(path.join(f.repo, h.raw.log)))
  const pre = bin('lanekeeper-quality', ['precheck', '--run', '--no-xlsx'], f.env, f.repo)
  assert.equal(pre.status, 1, pre.stdout)
  assert.match(pre.stdout, /running gate \(missing\)/)
  assert.doesNotMatch(pre.stdout, /running unit/, 'a valid result is not run again')
  assert.match(pre.stdout, /gate\s+failed/)
  assert.match(pre.stdout, /gate: read the failures/)
  const st = JSON.parse(bin('lanekeeper-quality', ['status', '--json'], f.env, f.repo).stdout)
  assert.deepEqual(st.rows.map((r) => r.state), ['ok', 'failed'])
  f.cleanup()
})

test('lanekeeper-quality: heavy suites run through lanekeeper-slot, record, report, accept is left to the owner', () => {
  const f = makeEnv()
  project(f, { suites: { e2e: { category: 'e2e', command: 'true' }, usability: { category: 'usability' } }, ship: { requires: ['e2e', 'usability'] } })
  const r = bin('lanekeeper-quality', ['run', 'e2e', '--no-xlsx'], f.env, f.repo)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /slot heavy/)
  const head = JSON.parse(fs.readFileSync(path.join(f.repo, 'docs/test-results', JSON.parse(fs.readFileSync(path.join(f.repo, 'docs/test-results/index.json'), 'utf8')).entries[0].json), 'utf8'))
  assert.equal(head.counts.total, 1, 'exit parser')
  assert.equal(bin('lanekeeper-quality', ['run', 'usability'], f.env, f.repo).status, 2, 'a kind without a command is recorded, not run')
  const scen = w(path.join(f.base, 'usability.json'), { counts: { total: 3, passed: 3, failed: 0 }, detail: { scenarios: ['sign in', 'make a chart', 'share'] } })
  assert.equal(bin('lanekeeper-quality', ['record', 'usability', '--verdict', 'passed', '--from', scen, '--no-xlsx'], f.env, f.repo).status, 0)
  assert.equal(bin('lanekeeper-quality', ['precheck'], f.env, f.repo).status, 0)
  const ship = bin('lanekeeper-quality', ['record', 'ship', '--verdict', 'passed', '--report', 'docs/release/vpr.md', '--no-xlsx'], f.env, f.repo)
  assert.equal(ship.status, 0, ship.stderr)
  const rep = bin('lanekeeper-quality', ['report', '--json', '--no-xlsx'], f.env, f.repo)
  const j = JSON.parse(rep.stdout)
  assert.deepEqual([j.version, j.allPassed, j.files.md], ['2.0.0', true, 'docs/test-results/2.0.0/quality-2.0.0.md'])
  const shipHead = j.latest.find((l) => l.kind === 'ship').entry
  assert.equal(shipHead.category, 'ship')
  const acc = bin('lanekeeper-quality', ['accept', 'e2e', '--reason', 'x'], f.env, f.repo)
  assert.equal(acc.status, 4, 'refused')
  assert.match(acc.stderr, /\/lanekeeper:approve accept-quality/)
  assert.equal(fs.existsSync(path.join(f.repo, 'docs/test-results/accepted.json')), false)
  f.cleanup()
})

test('ship gate hook: denies VPR before the precheck passes, ignores other calls, warn mode, prompt naming the skill', () => {
  const f = makeEnv()
  project(f, { suites: { unit: { command: 'true', slot: 'none' } }, ship: { requires: ['unit'] } })
  const hook = (ti, tool = 'Agent') => runScript('hooks/scripts/quality/ship-gate.mjs', { tool_name: tool, tool_input: ti, cwd: f.repo }, f.env)
  let r = hook({ subagent_type: 'some-plugin:readiness-auditor', prompt: 'audit' })
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /unit=missing/)
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /\/lanekeeper:ship-verify/)
  assert.equal(hook({ skill: 'verifying-production-readiness' }, 'Skill').out.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(hook({ subagent_type: 'general-purpose', prompt: 'Use the verifying-production-readiness skill' }).out.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(hook({ subagent_type: 'general-purpose', prompt: 'fix the chart' }).out, null)
  assert.equal(hook({ skill: 'lanekeeper:ship-verify' }, 'Skill').out, null, 'the skill that runs the precheck is not blocked')
  assert.equal(bin('lanekeeper-quality', ['run', 'unit', '--no-xlsx'], f.env, f.repo).status, 0)
  r = hook({ subagent_type: 'readiness-auditor' })
  assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined, 'passes once the precheck is ok')
  assert.match(r.out.hookSpecificOutput.additionalContext, /ux-adversarial=manual/, 'the default advisory kind only warns')
  fs.writeFileSync(path.join(f.repo, 'a.txt'), 'dirty\n')
  r = hook({ subagent_type: 'readiness-auditor' })
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /uncommitted changes/)
  git(f.repo, 'checkout', '--', 'a.txt')
  w(path.join(f.repo, '.lanekeeper/config.json'), { version: 1, quality: { suites: { unit: { command: 'true' }, e2e: { command: 'true' } }, ship: { requires: ['unit', 'e2e'], enforce: 'warn' } } })
  r = hook({ subagent_type: 'readiness-auditor' })
  assert.match(r.out.hookSpecificOutput.additionalContext, /e2e=missing/)
  assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined)
  f.cleanup()
})

// ---- advisory kinds (ux-adversarial) -------------------------------------------------------

test('precheck: advisory kinds are checked but do not block; a kind in requires blocks as usual', () => {
  const f = makeEnv()
  const head = git(f.repo, 'rev-parse', 'HEAD')
  const s = Q.qualitySettings({ project: { quality: { suites: { unit: { command: 'x' } }, ship: { requires: ['unit'], advisory: ['ux-adversarial'] } } } })
  assert.ok(Q.CATEGORIES.includes('ux-adversarial'))
  result(f.repo, { kind: 'unit', commit: head })
  let res = Q.precheck(f.repo, s)
  assert.equal(res.ok, true, 'a missing advisory kind does not block')
  assert.deepEqual(res.rows.map((r) => r.kind), ['unit'], 'required rows keep their shape')
  assert.deepEqual(res.advisory.map((r) => [r.kind, r.state, r.advisory]), [['ux-adversarial', 'manual', true]])
  result(f.repo, { kind: 'ux-adversarial', commit: head, verdict: 'failed', counts: { total: 12, passed: 11, failed: 1 } })
  res = Q.precheck(f.repo, s)
  assert.equal(res.ok, true, 'an open blocker finding warns')
  assert.equal(res.advisory[0].state, 'failed')
  const strict = Q.qualitySettings({ project: { quality: { suites: { unit: { command: 'x' } }, ship: { requires: ['unit', 'ux-adversarial'], advisory: ['ux-adversarial'] } } } })
  assert.deepEqual(strict.ship.advisory, [], 'requires wins over advisory')
  res = Q.precheck(f.repo, strict)
  assert.equal(res.ok, false)
  assert.equal(stateOf(res, 'ux-adversarial'), 'failed')
  f.cleanup()
})

test('lanekeeper-quality: advisory kind is listed apart, warns, keeps exit 0; ship gate warns only for it', () => {
  const f = makeEnv()
  project(f, { suites: { unit: { command: 'true', slot: 'none' }, 'ux-adversarial': { category: 'ux-adversarial' } }, ship: { requires: ['unit'] } })
  assert.equal(bin('lanekeeper-quality', ['run', 'unit', '--no-xlsx'], f.env, f.repo).status, 0)
  assert.equal(bin('lanekeeper-quality', ['run', 'ux-adversarial'], f.env, f.repo).status, 2, 'a kind without a command is recorded, not run')
  let pre = bin('lanekeeper-quality', ['precheck'], f.env, f.repo)
  assert.equal(pre.status, 0, pre.stdout)
  assert.match(pre.stdout, /Warning kinds/)
  assert.match(pre.stdout, /Warning: ux-adversarial=manual/)
  const hook = (ti) => runScript('hooks/scripts/quality/ship-gate.mjs', { tool_name: 'Agent', tool_input: ti, cwd: f.repo }, f.env)
  let r = hook({ subagent_type: 'readiness-auditor' })
  assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined)
  assert.match(r.out.hookSpecificOutput.additionalContext, /Warning kinds did not pass \(ux-adversarial=manual\)/)
  const found = w(path.join(f.base, 'uxadv.json'), {
    counts: { total: 8, passed: 7, failed: 1, skipped: 0, fixme: 0, flaky: 0 },
    failures: [{ suite: 'blocker', name: 'F-03 publish', message: 'after publishing, the user cannot find where the result is' }],
    detail: { findings: [{ id: 'F-03', severity: 'blocker', axis: [4], status: 'open' }] },
  })
  assert.equal(bin('lanekeeper-quality', ['record', 'ux-adversarial', '--verdict', 'failed', '--from', found, '--no-xlsx'], f.env, f.repo).status, 0)
  pre = bin('lanekeeper-quality', ['precheck'], f.env, f.repo)
  assert.equal(pre.status, 0, 'still a warning')
  assert.match(pre.stdout, /ux-adversarial=failed/)
  const head = JSON.parse(fs.readFileSync(path.join(f.repo, 'docs/test-results', JSON.parse(fs.readFileSync(path.join(f.repo, 'docs/test-results/index.json'), 'utf8')).entries.find((e) => e.kind === 'ux-adversarial').json), 'utf8'))
  assert.equal(head.category, 'ux-adversarial')
  assert.equal(head.failures[0].name, 'F-03 publish')
  const ship = bin('lanekeeper-quality', ['record', 'ship', '--verdict', 'passed', '--no-xlsx'], f.env, f.repo)
  assert.equal(ship.status, 0, ship.stderr)
  w(path.join(f.repo, '.lanekeeper/config.json'), { version: 1, quality: { suites: { unit: { command: 'true', slot: 'none' }, 'ux-adversarial': { category: 'ux-adversarial' } }, ship: { requires: ['unit'], advisory: [] } } })
  commitAll(f.repo, 'no advisory')
  assert.equal(bin('lanekeeper-quality', ['run', 'unit', '--no-xlsx'], f.env, f.repo).status, 0)
  r = hook({ subagent_type: 'readiness-auditor' })
  assert.equal(r.out, null, 'advisory: [] turns the warning off')
  w(path.join(f.repo, '.lanekeeper/config.json'), { version: 1, quality: { suites: { unit: { command: 'true', slot: 'none' }, 'ux-adversarial': { category: 'ux-adversarial' } }, ship: { requires: ['unit', 'ux-adversarial'] } } })
  commitAll(f.repo, 'require it')
  assert.equal(bin('lanekeeper-quality', ['run', 'unit', '--no-xlsx'], f.env, f.repo).status, 0)
  r = hook({ subagent_type: 'readiness-auditor' })
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny', 'in requires it blocks')
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /ux-adversarial=(failed|stale)/)
  f.cleanup()
})
