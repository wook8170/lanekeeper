// L5 briefs: templates, required sections and statements, brief file collection.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { checkBrief, collectBrief, parseMarker, SECTION_ORDER } from '../lib/brief.mjs'
import { ROOT, makeEnv, bin } from './l3-fixture.mjs'

const KINDS = ['impl', 'fix', 'mockup', 'research', 'review', 'docs', 'test']
const tpl = (lang, kind) => fs.readFileSync(path.join(ROOT, 'templates', 'briefs', lang, `${kind}.md`), 'utf8')
const fill = (text) => text.replace(/\{\{\s*base_sha\s*\}\}/g, '1a2b3c4d').replace(/\{\{\s*implementer\s*\}\}/g, 'opus').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, 'x-$1')

test('templates: 7 kinds in ko and en with the same placeholders', () => {
  for (const lang of ['ko', 'en']) {
    const files = fs.readdirSync(path.join(ROOT, 'templates', 'briefs', lang)).sort()
    assert.deepEqual(files, KINDS.map((k) => `${k}.md`).sort(), lang)
  }
  for (const k of KINDS) {
    const ph = (s) => [...new Set(s.match(/\{\{\s*[\w.-]+\s*\}\}/g))].sort()
    assert.deepEqual(ph(tpl('ko', k)), ph(tpl('en', k)), k)
  }
})

test('templates: unfilled placeholders block, filled templates pass', () => {
  for (const lang of ['ko', 'en']) {
    for (const k of KINDS) {
      const raw = checkBrief(tpl(lang, k))
      assert.equal(raw.ok, false, `${lang}/${k} raw`)
      assert.ok(raw.placeholder, `${lang}/${k} placeholder`)
      const filled = checkBrief(fill(tpl(lang, k)))
      assert.deepEqual(filled.missing, [], `${lang}/${k}`)
      assert.equal(filled.ok, true, `${lang}/${k}`)
      assert.equal(filled.marker.attrs.template, k)
    }
  }
})

test('templates: marker type is a routing task type', () => {
  const tasks = JSON.parse(fs.readFileSync(path.join(ROOT, 'defaults', 'routing.json'), 'utf8')).tasks
  for (const k of KINDS) assert.ok(tasks[parseMarker(tpl('ko', k)).attrs.type], k)
})

test('each required section is detected when missing or empty', () => {
  const good = fill(tpl('ko', 'impl'))
  const heads = { goal: '## 목표', scope: '## 범위', forbidden: '## 금지', tests: '## 시험 규칙', report: '## 보고 위치', commit: '## 커밋 규칙' }
  for (const name of SECTION_ORDER) {
    const renamed = good.replace(heads[name], '## 기타')
    assert.ok(checkBrief(renamed).missing.includes(name), `${name} renamed`)
    const lines = good.split('\n')
    const i = lines.indexOf(heads[name])
    let j = i + 1
    while (j < lines.length && !lines[j].startsWith('## ')) j++
    const emptied = [...lines.slice(0, i + 1), '', ...lines.slice(j)].join('\n')
    assert.ok(checkBrief(emptied).missing.includes(name), `${name} emptied`)
  }
})

test('english headings are accepted', () => {
  assert.deepEqual(checkBrief(fill(tpl('en', 'fix'))).missing, [])
})

test('statements: headless, full suite with a negation, base commit', () => {
  const good = fill(tpl('ko', 'impl'))
  const noHeadless = good.replace(/헤드리스/g, '')
  assert.ok(checkBrief(noHeadless).missing.includes('headless'))
  // naming the full suite without forbidding it does not count
  const suiteNoNeg = good
    .split('\n')
    .filter((l) => !/스위트/.test(l))
    .concat(['- 전체 시험 스위트를 돌린다.'])
    .join('\n')
  assert.ok(checkBrief(suiteNoNeg).missing.includes('full_suite'))
  const noBase = good.replace('1a2b3c4d', 'latest')
  assert.ok(checkBrief(noBase).missing.includes('base'))
  // base= in the marker is accepted too
  const markerBase = noBase.replace('template=impl', 'template=impl base=1a2b3c4')
  assert.ok(!checkBrief(markerBase).missing.includes('base'))
})

test('no marker is reported as marker', () => {
  const r = checkBrief('## 목표\n무언가')
  assert.ok(r.missing.includes('marker'))
})

test('collectBrief: prompt names a brief file that names a common brief', () => {
  const fx = makeEnv()
  try {
    const dir = path.join(fx.repo, '.wb', 'briefs')
    fs.mkdirSync(dir, { recursive: true })
    const full = fill(tpl('ko', 'impl'))
    const cut = full.indexOf('## 금지')
    // the lane brief carries goal/scope; the common brief carries the rest
    fs.writeFileSync(path.join(dir, 'common.md'), full.slice(cut))
    fs.writeFileSync(path.join(dir, 'l9.md'), `${full.slice(0, cut)}\n공통 규칙은 .wb/briefs/common.md 를 먼저 읽는다.\n`)
    const b = collectBrief('지시서 .wb/briefs/l9.md 를 읽고 진행하라.', { cwd: fx.repo, projectRoot: fx.repo })
    assert.equal(b.files.length, 2)
    assert.equal(b.marker.attrs.template, 'impl')
    assert.equal(checkBrief(b.text).ok, true)
    // an unrelated markdown file outside a briefs folder is not read
    fs.writeFileSync(path.join(fx.repo, 'README.md'), '# readme')
    assert.equal(collectBrief('README.md 참고', { cwd: fx.repo, projectRoot: fx.repo }).files.length, 0)
  } finally {
    fx.cleanup()
  }
})

test('wb-check brief: exit 0 on a filled template, 1 with the missing items', () => {
  const fx = makeEnv({ LANG: 'C' })
  try {
    const ok = path.join(fx.base, 'ok.md')
    fs.writeFileSync(ok, fill(tpl('en', 'review')))
    let r = bin('wb-check', ['brief', ok], fx.env, fx.repo)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const bad = path.join(fx.base, 'bad.md')
    fs.writeFileSync(bad, fill(tpl('en', 'review')).replace('## Commit rules', '## Misc'))
    r = bin('wb-check', ['brief', bad, '--json'], fx.env, fx.repo)
    assert.equal(r.status, 1)
    assert.deepEqual(JSON.parse(r.stdout).missing, ['commit'])
  } finally {
    fx.cleanup()
  }
})
