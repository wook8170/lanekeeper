// L7: /lanekeeper:review-lane — every one of the nine items with a passing and a failing sample,
// the return brief and the ledger record.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { makeEnv, git, bin } from './l3-fixture.mjs'
import { resolveConfig } from '../lib/config.mjs'
import * as R from '../lib/review.mjs'
import { checkBrief } from '../lib/brief.mjs'
import { translator } from '../lib/i18n.mjs'
import * as W from '../lib/waves.mjs'

const REPORT_OK = (head) => `# lane report

New HEAD ${head}

## Tests
Before the fix the regression test failed; after the fix 12 tests passed, failed 0.

## Remaining
Nothing open.
`

// A repo with an integration branch (main) and a lane branch that changes `files`.
function setup({ files = { 'src/a.ts': 'export const a = 2\n' }, config = {}, brief = null } = {}) {
  const fx = makeEnv()
  const { repo } = fx
  fs.mkdirSync(path.join(repo, '.lanekeeper'), { recursive: true })
  fs.writeFileSync(path.join(repo, '.lanekeeper', 'config.json'), JSON.stringify({ version: 1, ...config }))
  fs.writeFileSync(path.join(repo, '.gitignore'), '.lanekeeper/briefs/\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'config')
  git(repo, 'checkout', '-q', '-b', 'lane')
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true })
    fs.writeFileSync(path.join(repo, f), body)
  }
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'lane work')
  const head = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', '-q', 'main')
  const report = path.join(fx.base, 'report.md')
  fs.writeFileSync(report, REPORT_OK(head.slice(0, 10)))
  let briefFile = null
  if (brief) {
    briefFile = path.join(fx.base, 'brief.md')
    fs.writeFileSync(briefFile, brief)
  }
  const cfg = () => resolveConfig({ projectDir: repo, env: fx.env }).config
  const run = (o = {}) => R.reviewLane({ root: repo, head, report, brief: briefFile, config: cfg(), env: fx.env, termsRunner: () => ({ status: 0, json: { ok: true } }), ...o })
  return { ...fx, head, report, briefFile, cfg, run }
}
const item = (r, id) => r.items.find((i) => i.id === id)

test('nine items, in order, all pass or skip on a clean lane', async () => {
  const s = setup()
  const r = await s.run()
  assert.deepEqual(r.items.map((i) => i.id), R.ITEMS)
  assert.deepEqual(r.items.map((i) => i.n), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.equal(r.verdict, 'pass', JSON.stringify(r.items))
})

test('1 head: pass when based on the integration HEAD; fail missing, unknown, not based', async () => {
  const s = setup()
  assert.equal(item(await s.run(), 'head').status, 'pass')
  fs.writeFileSync(s.report, '## Tests\n3 passed\n## Remaining\nnone\n')
  assert.equal(item(await s.run({ head: undefined }), 'head').code, 'head.missing')
  assert.equal(item(await s.run({ head: 'deadbeefdeadbeef' }), 'head').code, 'head.unknown')
  // the integration branch moves on: the lane no longer has its HEAD as ancestor
  fs.writeFileSync(path.join(s.repo, 'b.txt'), 'b\n')
  git(s.repo, 'add', '.')
  git(s.repo, 'commit', '-q', '-m', 'int moves')
  const h = item(await s.run(), 'head')
  assert.equal(h.status, 'fail')
  assert.equal(h.code, 'head.not_based')
})

test('2 report: pass; fail when missing, incomplete or different from the returned message', async () => {
  const s = setup()
  assert.equal(item(await s.run(), 'report').status, 'pass')
  assert.equal(item(await s.run({ report: path.join(s.base, 'none.md') }), 'report').code, 'report.missing')
  fs.writeFileSync(path.join(s.base, 'thin.md'), `HEAD ${s.head.slice(0, 8)}\n`)
  const thin = item(await s.run({ report: path.join(s.base, 'thin.md') }), 'report')
  assert.equal(thin.code, 'report.fields')
  assert.match(thin.vars.fields, /tests/)
  assert.match(thin.vars.fields, /remaining/)
  const differs = item(await s.run({ returnText: `HEAD ${s.head.slice(0, 10)}\n11 tests passed` }), 'report')
  assert.equal(differs.code, 'report.differs')
  assert.match(differs.vars.diffs, /pass 12 ≠ 11/)
  assert.equal(item(await s.run({ returnText: 'HEAD 0123456789\n12 passed' }), 'report').code, 'report.differs')
  assert.equal(item(await s.run({ returnText: `HEAD ${s.head.slice(0, 10)}\n12 passed` }), 'report').status, 'pass')
})

test('3 guards: skip without guards; pass and fail by exit code', async () => {
  assert.equal(item(await setup().run(), 'guards').status, 'skip')
  const ok = setup({ config: { review: { guards: [{ name: 'lint', command: 'true' }] } } })
  assert.equal(item(await ok.run(), 'guards').status, 'pass')
  const bad = setup({ config: { review: { guards: [{ name: 'lint', command: 'true' }, { name: 'drift', command: 'echo drift >&2; exit 1' }] } } })
  const g = item(await bad.run(), 'guards')
  assert.equal(g.status, 'fail')
  assert.equal(g.vars.names, 'drift')
})

test('4 prefail: pass when recorded (ko or en); fail when not; skip for docs only', async () => {
  const s = setup()
  assert.equal(item(await s.run(), 'prefail').status, 'pass')
  fs.writeFileSync(s.report, `HEAD ${s.head}\n## 시험\n수정 전 코드에서 회귀 시험 실패 확인, 수정 후 5건 통과\n## 남은 것\n없음\n`)
  assert.equal(item(await s.run(), 'prefail').status, 'pass')
  fs.writeFileSync(s.report, `HEAD ${s.head}\n## Tests\n5 passed\n## Remaining\nnone\n`)
  assert.equal(item(await s.run(), 'prefail').code, 'prefail.missing')
  const docs = setup({ files: { 'docs/guide.md': '# guide\n' } })
  fs.writeFileSync(docs.report, `HEAD ${docs.head}\n## Tests\n0 failed, 1 passed\n## Remaining\nnone\n`)
  assert.equal(item(await docs.run(), 'prefail').status, 'skip')
})

const BRIEF = (owned, forbidden = '') => `<!-- lanekeeper-brief v1 type=impl-multi lane=l1 template=impl -->
# l1
## 범위
- 소유 파일(이 밖은 고치지 않는다): ${owned}
## 금지
- 손대지 말 파일: ${forbidden || '없음'}
`

test('5 scope: pass inside owned files; fail outside or on a forbidden file; skip without a brief', async () => {
  assert.equal(item(await setup().run(), 'scope').status, 'skip')
  const inScope = setup({ brief: BRIEF('`src/`') })
  assert.equal(item(await inScope.run(), 'scope').status, 'pass')
  const out = setup({ files: { 'src/a.ts': 'x\n', 'lib/b.ts': 'y\n' }, brief: BRIEF('`src/**`') })
  const o = item(await out.run(), 'scope')
  assert.equal(o.status, 'fail')
  assert.equal(o.vars.files, 'lib/b.ts')
  const forb = setup({ files: { 'src/a.ts': 'x\n', 'src/gen/schema.ts': 'y\n' }, brief: BRIEF('`src/**`', '`src/gen/**`') })
  assert.equal(item(await forb.run(), 'scope').vars.files, 'src/gen/schema.ts')
  assert.deepEqual(R.briefScope(BRIEF('`src/`, `test/x.test.ts`', '`db/**`')), { owned: ['src/**', 'test/x.test.ts'], forbidden: ['db/**'] })
})

test('6 captures: skip without UI change; fail none, missing or unseen; pass when seen', async () => {
  assert.equal(item(await setup().run(), 'captures').status, 'skip')
  const ui = setup({ files: { 'src/List.tsx': 'export const L = () => <ul />\n' }, config: { project_kind: 'web-ui' } })
  assert.equal(item(await ui.run(), 'captures').code, 'captures.none')
  assert.equal(item(await ui.run({ captures: [path.join(ui.base, 'after.png')] }), 'captures').code, 'captures.missing')
  fs.writeFileSync(path.join(ui.base, 'after.png'), 'x')
  fs.appendFileSync(ui.report, '\nCapture: after.png\n')
  assert.equal(item(await ui.run(), 'captures').code, 'captures.unseen')
  assert.equal(item(await ui.run({ capturesSeen: true }), 'captures').status, 'pass')
  // ui_globs decide what a UI change is when they are set
  const globbed = setup({ files: { 'app/view.txt': 'x\n' }, config: { mockup: { ui_globs: ['app/**'] } } })
  assert.equal(item(await globbed.run(), 'captures').code, 'captures.none')
})

test('7 serving: skip without UI change; fail unknown, stale, unreachable; pass with the marker', async () => {
  assert.equal(item(await setup().run(), 'serving').status, 'skip')
  const ui = setup({ files: { 'src/List.tsx': 'x\n' }, config: { project_kind: 'web-ui' } })
  assert.equal(item(await ui.run(), 'serving').code, 'serving.unknown')
  let body = 'old code'
  const srv = http.createServer((q, res) => res.end(body)).listen(0, '127.0.0.1')
  await new Promise((r) => srv.once('listening', r))
  const url = `http://127.0.0.1:${srv.address().port}/src/List.tsx`
  try {
    assert.equal(item(await ui.run({ serveUrl: url, marker: 'data-sort-v2' }), 'serving').code, 'serving.stale')
    body = 'new code data-sort-v2'
    assert.equal(item(await ui.run({ serveUrl: url, marker: 'data-sort-v2' }), 'serving').status, 'pass')
  } finally {
    srv.close()
  }
  assert.equal(item(await ui.run({ serveUrl: 'http://127.0.0.1:9/x', marker: 'm' }), 'serving').code, 'serving.unreachable')
  assert.equal(item(await ui.run({ serveUrl: 'http://example.com/x', marker: 'm' }), 'serving').code, 'serving.not_local')
})

test('8 tests (lane): pass with a passed count; fail when missing or failing', async () => {
  const s = setup()
  assert.equal(item(await s.run(), 'tests').status, 'pass')
  fs.writeFileSync(s.report, `HEAD ${s.head}\n## 시험\n수정 전 실패 확인. 14건 중 12건 통과, 실패 2\n## 남은 것\n없음\n`)
  assert.equal(item(await s.run(), 'tests').code, 'tests.failing')
  fs.writeFileSync(s.report, `HEAD ${s.head}\n## Tests\nran them\n## Remaining\nnone\n`)
  assert.equal(item(await s.run(), 'tests').code, 'tests.missing')
})

test('8 tests (integration): committed workbook for this HEAD passes; none or another run fails', async () => {
  const s = setup()
  assert.equal(item(await s.run({ stage: 'integration' }), 'tests').code, 'tests.workbook')
  const run = git(s.repo, 'rev-parse', '--short', 'HEAD')
  const dir = path.join(s.repo, 'docs', 'test-results', '2026-10-17')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'integration-1200.xlsx'), 'xlsx')
  fs.writeFileSync(path.join(dir, 'integration-1200.json'), JSON.stringify({ verdict: 'passed', meta: { commit: run } }))
  git(s.repo, 'add', '.')
  git(s.repo, 'commit', '-q', '-m', 'results')
  assert.equal(item(await s.run({ stage: 'integration' }), 'tests').status, 'pass')
  fs.writeFileSync(path.join(s.repo, 'src.txt'), 'later\n')
  git(s.repo, 'add', '.')
  git(s.repo, 'commit', '-q', '-m', 'code after the run')
  assert.equal(item(await s.run({ stage: 'final' }), 'tests').code, 'tests.head_differs')
})

test('9 terms: skip without a glossary or the check; fail grew or unqueued; pass', async () => {
  const s = setup()
  assert.equal(item(await s.run(), 'terms').code, 'terms.no_dict')
  fs.mkdirSync(path.join(s.repo, 'docs', 'glossary'), { recursive: true })
  fs.writeFileSync(path.join(s.repo, 'docs', 'glossary', 'terms.yaml'), 'terms: []\n')
  assert.equal(item(await s.run({ termsRunner: () => ({ status: 2 }) }), 'terms').code, 'terms.unavailable')
  // the real runner: lanekeeper-check has no `terms` subcommand yet, so it is unavailable, not a failure
  assert.equal(item(await s.run({ termsRunner: undefined }), 'terms').code, 'terms.unavailable')
  assert.equal(item(await s.run({ termsRunner: () => ({ status: 1 }) }), 'terms').code, 'terms.grew')
  const nq = item(await s.run({ termsRunner: () => ({ status: 0, json: { new_terms: ['sync', 'rollup'], queued: ['sync'] } }) }), 'terms')
  assert.equal(nq.code, 'terms.not_queued')
  assert.equal(nq.vars.terms, 'rollup')
  assert.equal(item(await s.run({ termsRunner: () => ({ status: 0, json: { new_terms: ['sync'], queued: ['sync'] } }) }), 'terms').status, 'pass')
})

test('return brief: filled template passes the dispatch brief check (ko and en)', () => {
  const fx = makeEnv()
  for (const lang of ['ko', 'en']) {
    const file = R.writeReturnBrief({ root: fx.repo, config: {}, lang, lane: 'l3', title: 'two findings', findings: ['1. a', '2. b'], base: 'abcdef1234567' })
    const text = fs.readFileSync(file, 'utf8')
    const c = checkBrief(text)
    assert.ok(c.ok, `${lang}: ${JSON.stringify(c)}`)
    assert.equal(c.marker.attrs.lane, 'l3')
    assert.match(text, /- 1\. a\n- 2\. b/)
    assert.match(text, /abcdef1234567/)
  }
  // numbered, never overwritten
  assert.ok(fs.existsSync(path.join(fx.repo, '.lanekeeper', 'briefs', 'l3-return-1.md')))
  assert.ok(fs.existsSync(path.join(fx.repo, '.lanekeeper', 'briefs', 'l3-return-2.md')))
})

test('lanekeeper-check lane: exit 1 with a return brief and a ledger return; exit 0 records done', () => {
  const s = setup({ files: { 'src/a.ts': 'x\n', 'lib/b.ts': 'y\n' }, brief: BRIEF('`src/**`') })
  const sd = path.join(git(s.repo, 'rev-parse', '--absolute-git-dir'), 'lanekeeper')
  W.initWave(sd, { id: 'w1', title: 'w1' })
  W.addLane(sd, 'w1', { lane: 'l1' })
  W.setStatus(sd, 'w1', 'l1', 'review')
  const r = bin('lanekeeper-check', ['lane', 'l1', '--head', s.head, '--report', s.report, '--brief', s.briefFile, '--wave', 'w1', '--record'], s.env, s.repo)
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stdout, /5\. Brief scope/)
  const brief = fs.readFileSync(path.join(s.repo, '.lanekeeper', 'briefs', 'l1-return-1.md'), 'utf8')
  assert.match(brief, /lib\/b\.ts/)
  assert.ok(checkBrief(brief).ok)
  let lane = W.readWaves(sd).waves[0].lanes[0]
  assert.equal(lane.returns, 1)
  assert.equal(lane.verifications.at(-1).result, 'fail')

  const ok = bin('lanekeeper-check', ['lane', 'l1', '--head', s.head, '--report', s.report, '--scope', 'src/**,lib/**', '--wave', 'w1', '--record', '--json'], s.env, s.repo)
  assert.equal(ok.status, 0, ok.stdout)
  assert.equal(JSON.parse(ok.stdout).verdict, 'pass')
  lane = W.readWaves(sd).waves[0].lanes[0]
  assert.equal(lane.status, 'done')
})

test('every review code has a ko and en message', async () => {
  const src = fs.readFileSync(new URL('../lib/review.mjs', import.meta.url), 'utf8')
  const codes = [...src.matchAll(/add\('(\w+)', '(?:pass|fail|skip)', '(\w+)'/g)].map((m) => `review.${m[1]}.${m[2]}`)
  assert.ok(codes.length >= 30)
  for (const lang of ['ko', 'en']) {
    const t = translator(lang)
    for (const k of [...codes, ...R.ITEMS.flatMap((i) => [`review.item.${i}`, `review.fix.${i}`])]) assert.notEqual(t(k), k, `${lang} ${k}`)
  }
})
