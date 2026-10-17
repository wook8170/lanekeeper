// L7: /wb:integrate — trial merge, conflict classes, abort with a return brief on a
// code conflict, rule-based resolution, regeneration, number check, guards, locks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, git, bin } from './l3-fixture.mjs'
import { resolveConfig } from '../lib/config.mjs'
import * as I from '../lib/integrate.mjs'
import { checkBrief } from '../lib/brief.mjs'

const write = (repo, f, body) => {
  fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true })
  fs.writeFileSync(path.join(repo, f), typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`)
}
const commit = (repo, msg) => {
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', msg)
}

// main with `base` files; lane branch applies `lane`, main then applies `main`.
function setup({ base = {}, lane = {}, main = {}, config = {} } = {}) {
  const fx = makeEnv()
  const { repo } = fx
  write(repo, '.wb/config.json', { version: 1, ...config })
  write(repo, '.gitignore', '.wb/briefs/\n')
  for (const [f, b] of Object.entries(base)) write(repo, f, b)
  commit(repo, 'base')
  git(repo, 'checkout', '-q', '-b', 'wb/t/l1')
  for (const [f, b] of Object.entries(lane)) write(repo, f, b)
  commit(repo, 'lane')
  git(repo, 'checkout', '-q', 'main')
  for (const [f, b] of Object.entries(main)) write(repo, f, b)
  if (Object.keys(main).length) commit(repo, 'main moves')
  const before = git(repo, 'rev-parse', 'HEAD')
  const env = { ...fx.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
  const run = (o = {}) => I.integrate({ root: repo, branch: 'wb/t/l1', lane: 'l1', config: resolveConfig({ projectDir: repo, env }).config, env, lang: 'en', ...o })
  const clean = () => {
    assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=no'), '')
    assert.throws(() => git(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'))
  }
  return { ...fx, env, before, run, clean }
}

test('classify: first matching rule, unmatched files are code', () => {
  const rules = resolveConfig({ projectDir: null, env: { HOME: '/nonexistent', WB_HOME: '/nonexistent' } }).config.project.integrate.rules
  assert.equal(I.classify('docs/e2e/pay.cases.json', rules), 'ledger')
  assert.equal(I.classify('defect-register.json', rules), 'ledger')
  assert.equal(I.classify('hooks/hooks.json', rules), 'union')
  assert.equal(I.classify('docs/test-results/2026-10-17/final-1200.xlsx', rules), 'generated')
  assert.equal(I.classify('pnpm-lock.yaml', rules), 'generated')
  assert.equal(I.classify('src/app.ts', rules), 'code')
})

test('mergeJson / mergeLedger: union, integration side wins, retired ids stay retired', () => {
  const ours = { version: 1, prefix: 'PAY', retired_ids: ['PAY-002'], cases: [{ id: 'PAY-001', title: 'ours' }, { id: 'PAY-003', title: 'mine' }] }
  const theirs = { version: 1, prefix: 'PAY', retired_ids: [], cases: [{ id: 'PAY-001', title: 'theirs' }, { id: 'PAY-002', title: 'old' }, { id: 'PAY-004', title: 'new' }] }
  const m = I.mergeLedger(ours, theirs)
  assert.deepEqual(m.cases.map((c) => `${c.id}:${c.title}`), ['PAY-001:ours', 'PAY-003:mine', 'PAY-004:new'])
  assert.deepEqual(m.retired_ids, ['PAY-002'])
  const h = I.mergeJson({ hooks: { Stop: [{ a: 1 }], X: 'ours' } }, { hooks: { Stop: [{ a: 1 }, { b: 2 }], Y: [1] , X: 'theirs' } })
  assert.deepEqual(h, { hooks: { Stop: [{ a: 1 }, { b: 2 }], X: 'ours', Y: [1] } })
})

test('clean merge is committed with the trailer; the lane is recorded', () => {
  const s = setup({ lane: { 'src/a.ts': 'a\n' }, main: { 'src/b.ts': 'b\n' } })
  const r = s.run({ trailer: 'Co-Authored-By: Example <x@example.com>' })
  assert.equal(r.status, 'merged', JSON.stringify(r))
  assert.equal(git(s.repo, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3)
  assert.match(git(s.repo, 'log', '-1', '--format=%B'), /merge wb\/t\/l1 into main\n\nCo-Authored-By/)
  assert.equal(s.run().status, 'up-to-date')
})

test('code conflict: abort, tree untouched, return brief asks for a fast-forwardable HEAD', () => {
  const s = setup({ base: { 'src/a.ts': '1\n' }, lane: { 'src/a.ts': 'lane\n' }, main: { 'src/a.ts': 'main\n' } })
  const r = s.run({ lang: 'ko' })
  assert.equal(r.status, 'aborted')
  assert.equal(r.reason, 'code_conflict')
  assert.deepEqual(r.conflicts, { 'src/a.ts': 'code' })
  s.clean()
  assert.equal(git(s.repo, 'rev-parse', 'HEAD'), s.before)
  const brief = fs.readFileSync(r.brief, 'utf8')
  assert.ok(checkBrief(brief).ok, JSON.stringify(checkBrief(brief)))
  assert.match(brief, /src\/a\.ts/)
  assert.match(brief, /빨리 감기/)
  assert.ok(brief.includes(s.before.slice(0, 12)))
})

test('ledger and registration conflicts are united; the integration side wins', () => {
  const cases = (rows) => ({ version: 1, module: 'pay', prefix: 'PAY', retired_ids: [], cases: rows })
  const hooks = (extra) => ({ hooks: { Stop: [{ hooks: [{ command: 'a' }, ...extra] }] } })
  const s = setup({
    base: { 'docs/e2e/pay.cases.json': cases([{ id: 'PAY-001', title: 'base' }]), 'hooks/hooks.json': hooks([]) },
    lane: { 'docs/e2e/pay.cases.json': cases([{ id: 'PAY-001', title: 'lane' }, { id: 'PAY-003', title: 'lane add' }]), 'hooks/hooks.json': hooks([{ command: 'lane' }]) },
    main: { 'docs/e2e/pay.cases.json': cases([{ id: 'PAY-001', title: 'main' }, { id: 'PAY-002', title: 'main add' }]), 'hooks/hooks.json': hooks([{ command: 'main' }]) },
  })
  const r = s.run()
  assert.equal(r.status, 'merged', JSON.stringify(r))
  assert.deepEqual(r.conflicts, { 'docs/e2e/pay.cases.json': 'ledger', 'hooks/hooks.json': 'union' })
  const merged = JSON.parse(fs.readFileSync(path.join(s.repo, 'docs/e2e/pay.cases.json'), 'utf8'))
  assert.deepEqual(merged.cases.map((c) => `${c.id}:${c.title}`), ['PAY-001:main', 'PAY-002:main add', 'PAY-003:lane add'])
  const h = JSON.parse(fs.readFileSync(path.join(s.repo, 'hooks/hooks.json'), 'utf8'))
  assert.deepEqual(h.hooks.Stop.map((x) => x.hooks.map((y) => y.command)), [['a', 'main'], ['a', 'lane']])
})

test('generated conflict takes the integration side, then regenerates', () => {
  const s = setup({
    base: { 'out/report.xlsx': 'base' },
    lane: { 'out/report.xlsx': 'lane' },
    main: { 'out/report.xlsx': 'main' },
    config: { integrate: { rules: [{ glob: '**/*.xlsx', kind: 'generated' }], regenerate: [{ name: 'xlsx', glob: '**/*.xlsx', command: 'printf regenerated > out/report.xlsx' }] } },
  })
  const r = s.run()
  assert.equal(r.status, 'merged', JSON.stringify(r))
  assert.deepEqual(r.regenerated, ['xlsx'])
  assert.equal(fs.readFileSync(path.join(s.repo, 'out/report.xlsx'), 'utf8'), 'regenerated')
  assert.equal(git(s.repo, 'show', 'HEAD:out/report.xlsx'), 'regenerated')
})

test('a JSON ledger that does not parse is a code conflict', () => {
  const s = setup({ base: { 'docs/e2e/x.cases.json': '{}' }, lane: { 'docs/e2e/x.cases.json': '{ broken' }, main: { 'docs/e2e/x.cases.json': '{"a":1}' } })
  const r = s.run()
  assert.equal(r.status, 'aborted')
  assert.equal(r.reason, 'code_conflict')
  s.clean()
})

test('guards run on the merged tree before the commit; a failure aborts and returns', () => {
  const s = setup({ lane: { 'src/a.ts': 'a\n' }, config: { integrate: { guards: [{ name: 'has-a', command: 'test -f src/a.ts' }, { name: 'drift', command: 'echo docs out of date; exit 1' }] } } })
  const r = s.run()
  assert.equal(r.status, 'aborted')
  assert.equal(r.reason, 'guard_failed')
  assert.deepEqual(r.guards, ['drift'])
  s.clean()
  assert.equal(git(s.repo, 'rev-parse', 'HEAD'), s.before)
  assert.match(fs.readFileSync(r.brief, 'utf8'), /docs out of date/)
})

test('a failed regeneration aborts', () => {
  const s = setup({ lane: { 'src/a.ts': 'a\n' }, config: { integrate: { regenerate: [{ name: 'gen', command: 'exit 4' }] } } })
  const r = s.run()
  assert.equal(r.reason, 'regenerate_failed')
  s.clean()
})

test('reserved number used twice after the merge aborts', () => {
  const s = setup({
    lane: { 'db/migrations/003_lane.sql': '--\n' },
    main: { 'db/migrations/003_main.sql': '--\n' },
    config: { numbers: { migration: { dir: 'db/migrations', pattern: '^(\\d+)_', width: 3, start: 1 } } },
  })
  const r = s.run()
  assert.equal(r.reason, 'number_conflict')
  assert.match(fs.readFileSync(r.brief, 'utf8'), /wb-number reserve migration/)
  s.clean()
})

test('dry run merges and rolls back; dirty tree, running merge and locks block', () => {
  const s = setup({ lane: { 'src/a.ts': 'a\n' } })
  assert.equal(s.run({ dryRun: true }).status, 'dry-run')
  s.clean()
  assert.equal(git(s.repo, 'rev-parse', 'HEAD'), s.before)
  fs.writeFileSync(path.join(s.repo, 'a.txt'), 'dirty\n')
  assert.equal(s.run().reason, 'dirty')
  git(s.repo, 'checkout', '--', 'a.txt')
  assert.equal(s.run({ branch: 'nope' }).reason, 'no_branch')
  const sd = path.join(git(s.repo, 'rev-parse', '--absolute-git-dir'), 'wb')
  fs.mkdirSync(sd, { recursive: true })
  fs.writeFileSync(path.join(sd, 'gate.lock'), JSON.stringify({ pid: process.pid }))
  assert.equal(s.run().reason, 'gate_locked')
  const cli = bin('wb-integrate', ['wb/t/l1'], s.env, s.repo)
  assert.equal(cli.status, 3)
  fs.writeFileSync(path.join(sd, 'gate.lock'), JSON.stringify({ pid: 999999 }))
  assert.equal(s.run().status, 'merged')
})

test('wb-integrate CLI: exit 1 on a code conflict, prints the classes and the brief', () => {
  const s = setup({ base: { 'src/a.ts': '1\n' }, lane: { 'src/a.ts': 'lane\n' }, main: { 'src/a.ts': 'main\n' } })
  const r = bin('wb-integrate', ['wb/t/l1', '--lane', 'l1'], s.env, s.repo)
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stdout, /code conflict\s+src\/a\.ts/)
  assert.match(r.stdout, /Return brief: .*l1-return-1\.md/)
  const j = JSON.parse(bin('wb-integrate', ['wb/t/l1', '--json'], s.env, s.repo).stdout)
  assert.equal(j.reason, 'code_conflict')
})
