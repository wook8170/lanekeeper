// Docs search (project.docs_search): off by default, the {{docs_search}} and {{code_search}}
// lines in impl, fix and return briefs, the session start line, the gate kind `docs-index`,
// the {wiki_index} lookup and the wiki set-up in /lanekeeper:init.
// Read tests/readability.test.mjs first: this file uses the same fixture and brief checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, makeEnv, bin } from './l3-fixture.mjs'
import { resolveConfig } from '../lib/config.mjs'
import { checkBrief } from '../lib/brief.mjs'
import { writeReturnBrief } from '../lib/review.mjs'
import { qualitySettings } from '../lib/quality.mjs'
import { initProject } from '../lib/init.mjs'
import { findWikiIndex, WIKI_SETTINGS } from '../lib/wiki.mjs'
import * as DS from '../lib/docs-search.mjs'
import { handle as rulesStart } from '../hooks/scripts/rules/session-start.mjs'

const OWN_INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/docs-search-config.json'), 'utf8')).docs_search

function repo(docsSearch, extra = {}) {
  const fx = makeEnv()
  fs.mkdirSync(path.join(fx.repo, '.lanekeeper'))
  const cfg = { version: 1, ...(docsSearch ? { docs_search: docsSearch } : {}), ...extra }
  fs.writeFileSync(path.join(fx.repo, '.lanekeeper', 'config.json'), JSON.stringify(cfg))
  return fx
}

const fillRest = (text) => text.replace(/\{\{\s*base_sha\s*\}\}/g, '1a2b3c4d').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, 'x-$1')
const ctx = (out) => out?.hookSpecificOutput?.additionalContext || ''

// A fake wook-skills install with a project-wiki indexer that records its arguments.
function fakeWiki(env, version = '0.2.0') {
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'plugins', 'cache', 'm', 'wook-skills', version, 'skills', 'project-wiki', 'bin')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'wiki-index.mjs')
  fs.writeFileSync(file, "import fs from 'node:fs'\nfs.mkdirSync('.wiki', { recursive: true })\nfs.writeFileSync('.wiki/config.json', JSON.stringify({ args: process.argv.slice(2) }))\n")
  return file
}

// ---- settings ---------------------------------------------------------------------

test('settings: docs_search is off by default; the example is valid; bad values are errors', () => {
  const fx = repo(null)
  try {
    const r = resolveConfig({ projectDir: fx.repo, env: fx.env })
    assert.deepEqual(r.errors, [])
    assert.equal(DS.isEnabled(r.config, fx.env), false)
    assert.equal(DS.docsSearch(r.config, fx.env).skill, 'wook-skills:project-wiki')
    assert.equal(DS.docsSearch(r.config, fx.env).rebuild, 'gate')
  } finally {
    fx.cleanup()
  }
  const ok = repo(OWN_INDEX)
  try {
    const r = resolveConfig({ projectDir: ok.repo, env: ok.env })
    assert.deepEqual(r.errors, [])
    assert.equal(DS.docsSearch(r.config, ok.env).search, 'pnpm -s wiki:search "{query}" --limit 5')
  } finally {
    ok.cleanup()
  }
  const bad = repo({ search: 1, rebuild: 'always' })
  try {
    const paths = resolveConfig({ projectDir: bad.repo, env: bad.env }).errors.map((e) => e.path).sort()
    assert.deepEqual(paths, ['project.docs_search.rebuild', 'project.docs_search.search'])
  } finally {
    bad.cleanup()
  }
})

// ---- briefs -----------------------------------------------------------------------

test('brief: no docs_search line without a search command; the codegraph line stays', () => {
  const fx = repo(null)
  try {
    for (const lang of ['ko', 'en']) {
      for (const type of ['impl', 'fix']) {
        const r = bin('lanekeeper-style', ['brief', type, '--lang', lang], fx.env, fx.repo)
        assert.equal(r.status, 0, r.stderr)
        assert.ok(!r.stdout.includes('{{docs_search}}') && !r.stdout.includes('{{code_search}}'))
        assert.ok(!r.stdout.includes(lang === 'ko' ? '문서 색인:' : 'Docs search:'), `${lang}/${type}: no docs line`)
        assert.match(r.stdout, lang === 'ko' ? /- 코드 찾기: 코드 흐름 · 위치는 codegraph/ : /- Finding code: look up code flow/)
        assert.ok(!r.stdout.includes('\n- \n'), 'no empty bullet left behind')
        assert.equal(checkBrief(fillRest(r.stdout)).ok, true)
      }
    }
  } finally {
    fx.cleanup()
  }
})

test('brief: with own index commands, impl and fix carry the search, read, backlinks, MCP, stale and skill parts', () => {
  const fx = repo(OWN_INDEX)
  try {
    for (const type of ['impl', 'fix']) {
      const ko = bin('lanekeeper-style', ['brief', type, '--lang', 'ko'], fx.env, fx.repo).stdout
      assert.ok(ko.includes('- 문서 색인: 문서 · 설계 · 운영 · 결정 이력 질문은 먼저 `pnpm -s wiki:search "{query}" --limit 5` 로 찾고, 정확한 줄은 `rg` 로 확인한다.'))
      for (const part of ['`pnpm -s wiki:read {id}`', '`pnpm -s wiki:backlinks {id}`', 'MCP 서버 `wiki`', '`[stale-candidate]`', '`wook-skills:project-wiki`', '색인 ID 나 문서 절']) assert.ok(ko.includes(part), `${type}: ${part}`)
      assert.equal(checkBrief(fillRest(ko)).ok, true)
      const en = bin('lanekeeper-style', ['brief', type, '--lang', 'en'], fx.env, fx.repo).stdout
      assert.ok(en.includes('- Docs search: for questions about documents'))
    }
    const own = bin('lanekeeper-style', ['brief', 'impl', '--lang', 'en', '--var', 'docs_search=See docs/x.md'], fx.env, fx.repo)
    assert.ok(own.stdout.includes('- See docs/x.md\n'))
  } finally {
    fx.cleanup()
  }
})

test('brief: codegraph nudge off drops the codegraph line; missing codegraph adds how to go on', () => {
  const off = repo(null, { codegraph: { nudge: 'off' } })
  try {
    const r = bin('lanekeeper-style', ['brief', 'impl', '--lang', 'en'], off.env, off.repo)
    assert.ok(!r.stdout.includes('Finding code') && !r.stdout.includes('code_search'))
  } finally {
    off.cleanup()
  }
  const t = (k) => k
  assert.equal(DS.codeSearchLine({}, t, { LANEKEEPER_CODEGRAPH: 'off' }), 'codesearch.brief codesearch.missing')
})

test('return brief: carries the docs search line only when a search command is set', () => {
  const fx = repo(null)
  try {
    const off = fs.readFileSync(writeReturnBrief({ root: fx.repo, config: {}, lang: 'ko', lane: 'l3', title: 't', findings: ['a'], base: '1a2b3c4d' }), 'utf8')
    assert.ok(!off.includes('문서 색인:') && !off.includes('{{docs_search}}') && !off.includes('{{code_search}}'))
    assert.ok(off.includes('- 코드 찾기: '))
    const on = fs.readFileSync(writeReturnBrief({ root: fx.repo, config: { project: { docs_search: OWN_INDEX } }, lang: 'en', lane: 'l3', title: 't', findings: ['a'], base: '1a2b3c4d' }), 'utf8')
    assert.ok(on.includes('- Docs search: ') && on.includes('wiki:search'))
  } finally {
    fx.cleanup()
  }
})

// ---- session start ----------------------------------------------------------------

test('session start: one docs search line when set, none by default', () => {
  const fx = repo(null)
  try {
    assert.ok(!ctx(rulesStart({ cwd: fx.repo, source: 'startup' }, fx.env)).includes('Docs search'))
  } finally {
    fx.cleanup()
  }
  const on = repo(OWN_INDEX)
  try {
    fs.writeFileSync(path.join(on.env.LANEKEEPER_HOME, 'personal.json'), JSON.stringify({ version: 1, session_rules: { conduct: false } }))
    const text = ctx(rulesStart({ cwd: on.repo, source: 'startup' }, on.env))
    assert.match(text, /^Docs search: .*`pnpm -s wiki:search "\{query\}" --limit 5`/)
    assert.match(text, /codegraph first; documents and decisions: the wiki first/)
    assert.equal(rulesStart({ cwd: on.repo, source: 'resume' }, on.env), null)
  } finally {
    on.cleanup()
  }
})

// ---- gate and {wiki_index} --------------------------------------------------------

test('gate: build with rebuild gate registers docs-index; manual or no build does not', () => {
  const cfg = (ds) => ({ project: { docs_search: ds } })
  const suite = qualitySettings(cfg({ search: 's', build: 'npm run wiki:build' })).suites['docs-index']
  assert.equal(suite.category, 'gate')
  assert.equal(suite.command, 'npm run wiki:build')
  assert.equal(qualitySettings(cfg({ search: 's', build: 'b', rebuild: 'manual' })).suites['docs-index'], undefined)
  assert.equal(qualitySettings(cfg(OWN_INDEX)).suites['docs-index'], undefined)
  assert.equal(qualitySettings({}).suites['docs-index'], undefined)
})

test('{wiki_index}: resolves to the newest installed indexer and stays as written when none is found', () => {
  const fx = makeEnv()
  try {
    assert.equal(findWikiIndex(fx.env), null)
    assert.equal(DS.docsSearch({ project: { docs_search: WIKI_SETTINGS } }, fx.env).search, 'node {wiki_index} search "{query}"')
    fakeWiki(fx.env, '0.1.9')
    const newest = fakeWiki(fx.env, '0.1.10')
    assert.equal(findWikiIndex(fx.env), newest)
    assert.equal(DS.docsSearch({ project: { docs_search: WIKI_SETTINGS } }, fx.env).build, `node "${newest}" build --if-changed --quiet`)
    assert.equal(findWikiIndex({ ...fx.env, LANEKEEPER_WIKI_INDEX: 'off' }), null)
  } finally {
    fx.cleanup()
  }
})

test('findWikiIndex: marketplace folder and personal skill folder are searched; the cache wins; a missing file gives null', () => {
  const fx = makeEnv()
  try {
    const rel = path.join('skills', 'project-wiki', 'bin', 'wiki-index.mjs')
    const put = (...parts) => {
      const f = path.join(fx.env.CLAUDE_CONFIG_DIR, ...parts, rel)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, '')
      return f
    }
    const personal = put()
    assert.equal(findWikiIndex(fx.env), personal)
    const market = put('plugins', 'marketplaces', 'm', 'wook-skills')
    assert.equal(findWikiIndex(fx.env), market)
    const cached = fakeWiki(fx.env, '0.1.2')
    assert.equal(findWikiIndex(fx.env), cached)
    assert.equal(findWikiIndex({ ...fx.env, LANEKEEPER_WIKI_INDEX: path.join(fx.repo, 'nope.mjs') }), null)
  } finally {
    fx.cleanup()
  }
})

// ---- init -------------------------------------------------------------------------

test('init: with a docs folder and the wiki skill, runs its init and fills docs_search', () => {
  const fx = makeEnv()
  try {
    fakeWiki(fx.env)
    fs.mkdirSync(path.join(fx.repo, 'docs'))
    const actions = initProject(fx.repo, { kind: 'other', language: 'en' }, fx.env)
    assert.ok(actions.some((a) => a.type === 'wikiInit'))
    assert.ok(actions.some((a) => a.type === 'wikiConfig'))
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fx.repo, '.wiki', 'config.json'), 'utf8')).args, ['init', '--root', fx.repo])
    const cfg = JSON.parse(fs.readFileSync(path.join(fx.repo, '.lanekeeper', 'config.json'), 'utf8'))
    assert.deepEqual(cfg.docs_search, { ...WIKI_SETTINGS })
    assert.deepEqual(resolveConfig({ projectDir: fx.repo, env: fx.env }).errors, [])
  } finally {
    fx.cleanup()
  }
})

test('init: no wiki skill gives one notice; no docs folder or an existing search does nothing; a kept config is not changed', () => {
  const fx = makeEnv()
  try {
    fs.mkdirSync(path.join(fx.repo, 'docs'))
    const actions = initProject(fx.repo, { kind: 'other', language: 'en' }, fx.env)
    assert.deepEqual(actions.filter((a) => a.type.startsWith('wiki')), [{ type: 'wikiMissing', dir: 'docs' }])
    const out = bin('lanekeeper-config', ['init', '--lang', 'en'], fx.env, fx.repo)
    assert.match(out.stdout, /the wiki skill \(wook-skills project-wiki\) is not installed/)
  } finally {
    fx.cleanup()
  }
  const none = makeEnv()
  try {
    fakeWiki(none.env)
    assert.deepEqual(initProject(none.repo, { kind: 'other', language: 'en' }, none.env).filter((a) => a.type.startsWith('wiki')), [])
  } finally {
    none.cleanup()
  }
  const kept = repo(null)
  try {
    fakeWiki(kept.env)
    fs.mkdirSync(path.join(kept.repo, 'docs'))
    const before = fs.readFileSync(path.join(kept.repo, '.lanekeeper', 'config.json'), 'utf8')
    const actions = initProject(kept.repo, { kind: 'other', language: 'en' }, kept.env)
    assert.ok(actions.some((a) => a.type === 'wikiConfigSuggest' && a.json.includes('docs_search')))
    assert.equal(fs.readFileSync(path.join(kept.repo, '.lanekeeper', 'config.json'), 'utf8'), before)
  } finally {
    kept.cleanup()
  }
  const has = repo(OWN_INDEX)
  try {
    fakeWiki(has.env)
    fs.mkdirSync(path.join(has.repo, 'docs'))
    assert.deepEqual(initProject(has.repo, { kind: 'other', language: 'en' }, has.env).filter((a) => a.type.startsWith('wiki')), [])
    assert.ok(!fs.existsSync(path.join(has.repo, '.wiki')))
  } finally {
    has.cleanup()
  }
})

// ---- review -----------------------------------------------------------------------

test('review-lane: the docs search citation item is advice only', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/review-lane/SKILL.md'), 'utf8')
  const section = skill.slice(skill.indexOf('## Docs search citations'), skill.indexOf('## Do not'))
  assert.ok(section.includes('project.docs_search.search'))
  assert.match(section, /never fails a lane/)
  assert.match(section, /never goes into a return brief/)
})
