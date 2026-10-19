// Docs sync: impact map (rules · mirrors · groups · reverse index of screen phrases · capture scenes),
// the gate verdict, wb-docs in a repository, and the `docs` kind it registers with wb-quality.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeEnv, bin, git } from './l3-fixture.mjs'
import * as D from '../lib/docsync.mjs'
import * as Q from '../lib/quality.mjs'
import { check, SCHEMAS } from '../lib/schema.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---- a small repository in memory -------------------------------------------------

const CONFIG = {
  base: 'main',
  screen_sources: ['web/src/screens/**', 'admin/src/screens/**'],
  ignore: ['**/*.test.*'],
  min_phrase_length: 3,
  max_files_per_phrase: 3,
  targets: [
    { id: 'manual', name: 'In-app manual', paths: ['web/src/manual/**', 'admin/src/manual/**'] },
    { id: 'help', name: 'Help pages', paths: ['help/*.md'] },
    { id: 'changelog', name: 'Changelog', paths: ['CHANGELOG.md'] },
    { id: 'backlog', name: 'Backlog', paths: ['docs/backlog.md', 'web/src/backlog.ts', 'admin/src/backlog.ts'] },
    { id: 'api-doc', name: 'API reference', paths: ['docs/api.md'] },
    { id: 'shots', name: 'Screenshots', kind: 'shots', paths: ['web/public/manual/**'] },
  ],
  rules: [
    { when: ['web/src/screens/**', 'admin/src/screens/**'], review: ['manual', 'help', 'changelog'], why: 'screen code changed' },
    { when: ['api/src/**'], require: ['api-doc'], why: 'API changed → regenerate the reference' },
  ],
  mirrors: [
    { from: '^web/src/manual/(.+)\\.tsx$', to: 'admin/src/manual/$1.vue', target: 'manual' },
    { from: '^admin/src/manual/(.+)\\.vue$', to: 'web/src/manual/$1.tsx', target: 'manual' },
  ],
  groups: [{ name: 'backlog and its two copies', target: 'backlog', files: ['docs/backlog.md', 'web/src/backlog.ts', 'admin/src/backlog.ts'] }],
  reverse_index: { targets: ['manual', 'help'] },
  shots: {
    scripts: [{ file: 'capture/capture.mjs', call_pattern: "shot\\(page, '([^']+)'", key_pattern: '^  ([\\w-]+): \\{', image: 'web/public/manual/{name}.png' }],
    command: 'SHOTS={keys} node capture/capture.mjs',
  },
  autofix: [{ name: 'api reference', when: ['api/src/**'], command: 'node api/gen-doc.mjs' }],
  checks: [{ name: 'links', command: 'node check-links.mjs' }],
  manual_items: [{ when: ['VERSION'], text: 'new brochure edition' }],
}

const CAPTURE = [
  'const SHOTS = {',
  '  share: { run: async (page) => {',
  "    await page.locator('[data-testid=\"share-open\"]').click()",
  "    await shot(page, 'share-modal')",
  '  } },',
  '  grid: { run: async (page) => {',
  "    await page.locator('[data-testid=\"grid-root\"]').waitFor()",
  "    await shot(page, 'grid')",
  '  } },',
  '}',
].join('\n')

const SHARE_OLD = ['export function ShareModal() {', '  return <div data-testid="share-open">', '    <button>Copy link now</button>', '  </div>', '}'].join('\n')
const SHARE_NEW = SHARE_OLD.replace('Copy link now', 'Copy the address')

const FILES = {
  'web/src/screens/ShareModal.tsx': SHARE_NEW,
  'admin/src/screens/ShareModal.vue': '<template><div data-testid="share-open"><button>Copy the address</button></div></template>',
  'web/src/manual/Part3.tsx': '<p>In the share window press "Copy link now".</p>\n<img src="/manual/share-modal.png" />',
  'admin/src/manual/Part3.vue': '<p>In the share window press "Copy link now".</p>\n<img src="/manual/share-modal.png" />',
  'help/sharing.md': '# Sharing\nPress Copy link now in the share window.\n',
  'capture/capture.mjs': CAPTURE,
  'CHANGELOG.md': '# Changelog\n',
  'docs/backlog.md': '', 'web/src/backlog.ts': '', 'admin/src/backlog.ts': '',
  'docs/api.md': '',
}

const model = (files) => ({
  read: (f) => (Object.prototype.hasOwnProperty.call(files, f) ? files[f] : null),
  list: (globs) => Object.keys(files).filter((f) => D.matchAny(f, globs)),
})

function unifiedDiff(file, oldText, newText) {
  const o = oldText.split('\n')
  const n = newText.split('\n')
  const out = [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`]
  for (let i = 0; i < Math.max(o.length, n.length); i++) {
    if (o[i] === n[i]) continue
    out.push(`@@ -${i + 1},1 +${i + 1},1 @@`)
    if (o[i] !== undefined) out.push(`-${o[i]}`)
    if (n[i] !== undefined) out.push(`+${n[i]}`)
  }
  return out.join('\n')
}
const SHARE_DIFF = unifiedDiff('web/src/screens/ShareModal.tsx', SHARE_OLD, SHARE_NEW)
const mapFor = (changed, files = FILES, diffs = []) => D.buildImpactMap({ config: CONFIG, changed, diff: D.parseDiff(diffs.join('\n')), ...model(files) })
const SCREEN = [{ file: 'web/src/screens/ShareModal.tsx', status: 'M' }]

// ---- helpers --------------------------------------------------------------------

test('docsync: glob, phrases (default needs two words; comments skipped), test ids', () => {
  assert.ok(D.globToRegExp('apps/*/src/**').test('apps/web/src/a/b.tsx'))
  assert.ok(!D.globToRegExp('help/*.md').test('help/sub/a.md'))
  assert.ok(D.globToRegExp('help/*.{md,txt}').test('help/a.txt'))
  assert.deepEqual([...D.extractPhrases('<button title="Share settings">Copy link now</button> {\'Save\'}', {})].sort(), ['Copy link now', 'Share settings'])
  assert.equal(D.extractPhrases('  // Copy link now', {}).size, 0)
  assert.equal(D.extractPhrases('  ends a comment with Copy link now */', {}).size, 0)
  assert.deepEqual([...D.extractPhrases('<b>저장하기</b>', { textPattern: '\\p{Script=Hangul}' })], ['저장하기'])
  assert.deepEqual([...D.extractTestIds('<div data-testid="a-b"></div> page.getByTestId(\'c\')')].sort(), ['a-b', 'c'])
})

test('docsync: diff phrases — removed, added and paired inside one hunk', () => {
  const ch = D.phraseChanges(D.parseDiff(SHARE_DIFF).get('web/src/screens/ShareModal.tsx'), { minPhraseLength: 3 })
  assert.deepEqual([...ch.removed], ['Copy link now'])
  assert.deepEqual([...ch.added], ['Copy the address'])
  assert.deepEqual(ch.pairs, [{ from: 'Copy link now', to: 'Copy the address' }])
})

test('docsync: capture scenes — key blocks, function callers, entry functions, key scope, later argument as name', () => {
  assert.deepEqual(D.indexShots(CAPTURE, { callPattern: "shot\\(page, '([^']+)'", keyPattern: '^  ([\\w-]+): \\{' }).map((s) => [s.key, s.image, [...s.testids]]),
    [['share', 'share-modal', ['share-open']], ['grid', 'grid', ['grid-root']]])
  const text = [
    'const SHOTS = {',
    '  flow: { run: async (page) => { await runFlow(page) } },',
    "  viz: { run: async (page) => { await vizShot(page, 'Bullet', 'chart-bullet') } },",
    '}',
    'async function runFlow(page) {',
    '  await flowPart(page)',
    '}',
    'async function flowPart(page) {',
    '  const opts = {',
    '  inner: { a: 1 },',
    '  }',
    "  await cut(page, 'flow-02')",
    '}',
    'async function runSet(browser) {',
    "  await cut(page, 'set-01')",
    '}',
  ].join('\n')
  const scenes = D.indexShots(text, { callPattern: "\\bcut\\(page, '([\\w-]+)'|\\bvizShot\\(page, [^,]+, '([\\w-]+)'", keyPattern: '^  ([\\w-]+): \\{', keyScope: '^const SHOTS = \\{', entryFunctions: { runSet: 'set' } })
  assert.deepEqual(scenes.map((s) => [s.key, s.image]), [['viz', 'chart-bullet'], ['flow', 'flow-02'], ['set', 'set-01']])
})

// ---- impact map -------------------------------------------------------------------

test('docsync map: a phrase gone from the screens but left in documents makes those files required, with the new phrase', () => {
  const m = mapFor(SCREEN, FILES, [SHARE_DIFF])
  const req = m.items.filter((i) => i.level === 'required')
  assert.deepEqual(req.map((i) => i.file).sort(), ['admin/src/manual/Part3.vue', 'help/sharing.md', 'web/src/manual/Part3.tsx'])
  const h = req.find((i) => i.file === 'help/sharing.md')
  assert.deepEqual([h.target, h.line, h.phrase, h.suggestion, h.code], ['help', 2, 'Copy link now', 'Copy the address', 'vanished'])
  assert.ok(m.items.some((i) => i.level === 'review' && i.target === 'changelog' && i.code === 'rule'))
})

test('docsync map: a phrase still used by another screen, or one found in too many files, is not required', () => {
  const still = mapFor(SCREEN, { ...FILES, 'web/src/screens/Other.tsx': '<b>Copy link now</b>' }, [SHARE_DIFF])
  assert.equal(still.items.filter((i) => i.level === 'required').length, 0)
  const common = mapFor(SCREEN, { ...FILES, 'help/a.md': 'Copy link now', 'help/b.md': 'Copy link now' }, [SHARE_DIFF])
  assert.equal(common.items.filter((i) => i.level === 'required').length, 0)
  assert.deepEqual(common.skippedPhrases, [{ phrase: 'Copy link now', files: 5 }])
})

test('docsync map: scenes that carry the screen test ids are recapture candidates; their picture and the pages showing it are review', () => {
  const m = mapFor(SCREEN, FILES, [SHARE_DIFF])
  assert.deepEqual(m.shots.map((s) => [s.key, s.image, s.path]), [['share', 'share-modal', 'web/public/manual/share-modal.png']])
  assert.equal(m.recapture, 'SHOTS=share node capture/capture.mjs')
  assert.deepEqual(m.items.filter((i) => i.image).map((i) => i.file).sort(), ['admin/src/manual/Part3.vue', 'web/public/manual/share-modal.png', 'web/src/manual/Part3.tsx'])
})

test('docsync map: mirrors, groups, required rules, autofix, manual items; test files are not screen changes', () => {
  assert.deepEqual(mapFor([{ file: 'web/src/manual/Part3.tsx', status: 'M' }]).items.map((i) => [i.level, i.file, i.code]), [['required', 'admin/src/manual/Part3.vue', 'mirror']])
  assert.deepEqual(mapFor([{ file: 'docs/backlog.md', status: 'M' }]).items.map((i) => i.file).sort(), ['admin/src/backlog.ts', 'web/src/backlog.ts'])
  const m = mapFor([{ file: 'api/src/a.ts', status: 'M' }, { file: 'VERSION', status: 'M' }])
  assert.ok(m.items.some((i) => i.level === 'required' && i.target === 'api-doc' && !i.file))
  assert.deepEqual(m.autofix.map((a) => a.name), ['api reference'])
  assert.deepEqual(m.manual, ['new brochure edition'])
  assert.equal(mapFor([{ file: 'web/src/screens/ShareModal.test.tsx', status: 'M' }]).items.length, 0)
})

// ---- gate -----------------------------------------------------------------------

test('docsync gate: unmet required items fail; one test per target, failed = targets with unmet items', () => {
  const g = D.judgeGate(mapFor(SCREEN, FILES, [SHARE_DIFF]), { changed: SCREEN })
  assert.equal(g.verdict, 'failed')
  assert.deepEqual(g.required, { total: 3, satisfied: 0, acked: 0, missing: 3 })
  assert.deepEqual(g.counts, { total: 6, passed: 4, failed: 2, skipped: 0, fixme: 0, flaky: 0 })
  assert.deepEqual(g.failedTargets.sort(), ['help', 'manual'])
  assert.ok(g.warnings.some((w) => w.target === 'changelog'))
})

test('docsync gate: changing the required files passes; review items only warn unless strict', () => {
  const changed = [...SCREEN, ...['web/src/manual/Part3.tsx', 'admin/src/manual/Part3.vue', 'help/sharing.md'].map((file) => ({ file, status: 'M' }))]
  const files = { ...FILES }
  for (const f of ['web/src/manual/Part3.tsx', 'admin/src/manual/Part3.vue', 'help/sharing.md']) files[f] = files[f].replace('Copy link now', 'Copy the address')
  const m = mapFor(changed, files, [SHARE_DIFF])
  assert.equal(D.judgeGate(m, { changed }).verdict, 'passed')
  assert.equal(D.judgeGate(m, { changed, strict: true }).verdict, 'failed', 'strict counts the unmet review items (changelog)')
})

test('docsync gate: an acknowledgement passes the matching required item only', () => {
  const changed = [{ file: 'api/src/a.ts', status: 'M' }]
  const m = mapFor(changed)
  assert.equal(D.judgeGate(m, { changed }).verdict, 'failed')
  const g = D.judgeGate(m, { changed, acks: [{ target: 'api-doc', reason: 'internal helper only', by: 'owner' }] })
  assert.equal(g.verdict, 'passed')
  assert.equal(g.acked.length, 1)
  assert.equal(D.judgeGate(m, { changed, acks: [{ target: 'help', reason: 'x' }] }).verdict, 'failed')
})

test('docsync gate: no screen change passes with zero required items', () => {
  const g = D.judgeGate(mapFor([{ file: 'README.md', status: 'M' }]), { changed: [{ file: 'README.md', status: 'M' }] })
  assert.equal(g.verdict, 'passed')
  assert.equal(g.required.total, 0)
  assert.equal(g.counts.total, 6)
})

test('docsync settings: snake_case and camelCase read the same; the example validates against the schema', () => {
  const a = D.normalizeConfig({ screen_sources: ['x/**'], reverse_index: { targets: ['m'] }, fail_on: 'review' })
  const b = D.normalizeConfig({ screenSources: ['x/**'], reverseIndex: { targets: ['m'] }, gate: { failOn: 'review' } })
  assert.deepEqual(a.screenSources, b.screenSources)
  assert.deepEqual(a.reverseIndex, b.reverseIndex)
  assert.equal(a.gate.failOn, 'review')
  assert.equal(b.gate.failOn, 'review')
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/docs-sync-config.json'), 'utf8'))
  const r = check(SCHEMAS.project, ex)
  assert.deepEqual([...r.errors, ...r.warnings], [])
})

// ---- wb-docs and wb-quality in a repository ---------------------------------------

function repoWith(f, body = SHARE_OLD) {
  for (const [file, text] of Object.entries({ ...FILES, 'web/src/screens/ShareModal.tsx': body })) {
    fs.mkdirSync(path.join(f.repo, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(f.repo, file), text)
  }
  fs.mkdirSync(path.join(f.repo, '.wb'), { recursive: true })
  fs.writeFileSync(path.join(f.repo, '.wb/config.json'), JSON.stringify({ version: 1, docs_sync: CONFIG, quality: { ship: { requires: ['docs'] } } }))
  fs.writeFileSync(path.join(f.repo, '.gitignore'), 'test-results/\n')
  fs.writeFileSync(path.join(f.repo, 'VERSION'), '1.0.0\n')
  git(f.repo, 'add', '-A')
  git(f.repo, 'commit', '-q', '-m', 'base')
}
const fixDocs = (f) => {
  for (const file of ['web/src/manual/Part3.tsx', 'admin/src/manual/Part3.vue', 'help/sharing.md']) {
    const p = path.join(f.repo, file)
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Copy link now', 'Copy the address'))
  }
}

test('wb-docs: check fails while documents keep the old phrase, writes the quality json, passes once they follow', () => {
  const f = makeEnv()
  try {
    repoWith(f)
    git(f.repo, 'checkout', '-q', '-b', 'feature')
    fs.writeFileSync(path.join(f.repo, 'web/src/screens/ShareModal.tsx'), SHARE_NEW)
    const r1 = bin('wb-docs', ['check', '--json', 'out.json'], f.env, f.repo)
    assert.equal(r1.status, 1, r1.stdout + r1.stderr)
    assert.match(r1.stdout, /help\/sharing\.md:2/)
    const j = JSON.parse(fs.readFileSync(path.join(f.repo, 'out.json'), 'utf8'))
    assert.deepEqual([j.counts.total, j.counts.failed], [6, 2])
    assert.equal(j.suites.length, 6)
    assert.ok(Q.parseResult('json', { files: [path.join(f.repo, 'out.json')] }).counts.failed === 2, 'readable by the quality json parser')
    const map = bin('wb-docs', ['map'], f.env, f.repo)
    assert.equal(map.status, 0, map.stderr)
    assert.match(map.stdout, /SHOTS=share node capture\/capture\.mjs/)
    assert.match(map.stdout, /"Copy link now" → "Copy the address"/)
    fixDocs(f)
    const r2 = bin('wb-docs', ['check'], f.env, f.repo)
    assert.equal(r2.status, 0, r2.stdout + r2.stderr)
  } finally {
    f.cleanup()
  }
})

test('wb-docs: without docs_sync.targets it explains the setting and exits 2', () => {
  const f = makeEnv()
  try {
    const r = bin('wb-docs', ['check'], f.env, f.repo)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /docs_sync\.targets/)
  } finally {
    f.cleanup()
  }
})

test('wb-quality: docs_sync registers the kind docs (category gate); run records it and the precheck uses it', () => {
  const S = Q.qualitySettings({ project: { docs_sync: { targets: [{ id: 'a', paths: ['a/**'] }], quality_base: 'main' } } })
  assert.equal(S.suites.docs.category, 'gate')
  assert.equal(S.suites.docs.parser, 'json')
  assert.match(S.suites.docs.command, /wb-docs" check --base main --json \{file\}$/)
  assert.equal(Q.qualitySettings({ project: {} }).suites.docs, undefined)
  const own = Q.qualitySettings({ project: { docs_sync: { targets: [{ id: 'a' }] }, quality: { suites: { docs: { command: 'mine' } } } } })
  assert.equal(own.suites.docs.command, 'mine', 'a suite of the same name wins')

  const f = makeEnv()
  try {
    repoWith(f)
    git(f.repo, 'tag', 'v1.0.0')
    fs.writeFileSync(path.join(f.repo, 'web/src/screens/ShareModal.tsx'), SHARE_NEW)
    git(f.repo, 'commit', '-qam', 'rename the button')
    const run1 = bin('wb-quality', ['run', 'docs', '--no-xlsx'], f.env, f.repo)
    assert.equal(run1.status, 1, 'a failed suite exits 1: ' + run1.stdout + run1.stderr)
    const idx = () => JSON.parse(fs.readFileSync(path.join(f.repo, 'docs/test-results/index.json'), 'utf8'))
    const h1 = JSON.parse(fs.readFileSync(path.join(f.repo, 'docs/test-results', idx().entries[0].json), 'utf8'))
    assert.deepEqual([h1.kind, h1.category, h1.verdict, h1.counts.total, h1.counts.failed], ['docs', 'gate', 'failed', 6, 2])
    assert.equal(bin('wb-quality', ['precheck'], f.env, f.repo).status, 1)
    fixDocs(f)
    git(f.repo, 'commit', '-qam', 'docs follow')
    const pre = bin('wb-quality', ['precheck', '--run', '--no-xlsx'], f.env, f.repo)
    assert.equal(pre.status, 0, pre.stdout + pre.stderr)
  } finally {
    f.cleanup()
  }
})
