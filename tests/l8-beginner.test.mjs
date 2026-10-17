// L8: beginner layer — writing style, rule catalog, explain, work plan and progress, decisions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, makeEnv, bin, git } from './l3-fixture.mjs'
import * as S from '../lib/style.mjs'
import * as R from '../lib/rules.mjs'
import * as X from '../lib/explain.mjs'
import * as K from '../lib/work.mjs'
import * as D from '../lib/decide.mjs'
import * as W from '../lib/waves.mjs'
import { upsertLane } from '../lib/ledger.mjs'
import { recordLimit } from '../lib/limits.mjs'
import { boardRows } from '../lib/board.mjs'
import { resolveConfig, stateDir } from '../lib/config.mjs'
import { limitsFile } from '../lib/runtime.mjs'
import { translator, messages } from '../lib/i18n.mjs'
import { buildPlan } from '../lib/work.mjs'
import { routingOf } from '../lib/route.mjs'

const tko = translator('ko')
const ten = translator('en')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const project = (fx, obj) => {
  fs.mkdirSync(path.join(fx.repo, '.wb'), { recursive: true })
  fs.writeFileSync(path.join(fx.repo, '.wb', 'config.json'), JSON.stringify({ version: 1, ...obj }))
}
const withEnv = (fx, extra = {}) => ({ ...fx.env, LANG: 'ko_KR.UTF-8', ...extra })
const MAP = [
  { glob: 'apps/**/screens/**', style: 'haeyo' },
  { glob: 'docs/**/*.md', style: 'report' },
]

// ---- style -------------------------------------------------------------

test('style: glob matching of **, * and ?', () => {
  assert.ok(S.globToRe('docs/**/*.md').test('docs/a/b/c.md'))
  assert.ok(S.globToRe('docs/**/*.md').test('docs/c.md'))
  assert.ok(!S.globToRe('docs/*.md').test('docs/a/c.md'))
  assert.ok(S.globToRe('src/?.ts').test('src/a.ts'))
  assert.ok(!S.globToRe('src/?.ts').test('src/ab.ts'))
  assert.ok(!S.globToRe('a.md').test('axmd'), 'dot is literal')
  assert.ok(S.globToRe('**/x.vue').test('apps/vue/src/x.vue'))
})

test('style: first matching entry wins; no match gives null', () => {
  const map = [{ glob: 'docs/ui/**', style: 'haeyo' }, { glob: 'docs/**', style: 'report' }]
  assert.equal(S.styleFor(map, 'docs/ui/a.md').style, 'haeyo')
  assert.equal(S.styleFor(map, 'docs/dev/a.md').style, 'report')
  assert.equal(S.styleFor(map, 'src/a.ts'), null)
  assert.equal(S.styleFor(map, './docs/dev/a.md').style, 'report')
})

test('style: renderStyle gives one line, per-group lines, or the no-style text', () => {
  const one = S.renderStyle(MAP, ['docs/a.md', 'docs/b/c.md'], tko)
  assert.equal(one, tko('style.report.line'))
  const mixed = S.renderStyle(MAP, ['docs/a.md', 'apps/x/screens/Home.tsx', 'src/z.ts'], tko)
  assert.ok(mixed.includes(tko('style.haeyo.line')) && mixed.includes(tko('style.report.line')) && mixed.includes(tko('style.none')))
  assert.ok(mixed.includes('apps/x/screens/Home.tsx') && mixed.includes('docs/a.md'))
  assert.equal(S.renderStyle(MAP, [], tko), tko('style.none'))
  assert.equal(S.renderStyle(MAP, ['src/z.ts'], ten), ten('style.none'))
})

test('style: rule text exists for each style in ko and en', () => {
  for (const lang of ['ko', 'en']) for (const s of S.STYLES) assert.ok(S.styleRules(s, lang)?.length > 40, `${lang} ${s}`)
  assert.equal(S.styleRules('nope', 'ko'), null)
  assert.match(S.styleRules('haeyo', 'ko'), /질문형 제목/)
  assert.match(S.styleRules('report', 'ko'), /한 문장에는 한 가지 사실/)
})

test('style: fillTemplate fills known names and leaves the rest', () => {
  assert.equal(S.fillTemplate('{{a}} {{ b }} {{c}}', { a: '1', b: '2' }), '1 2 {{c}}')
})

test('wb-style brief: {{style}} follows style.map for the owned files (ko and en templates)', () => {
  const fx = makeEnv()
  project(fx, { style: { map: MAP } })
  for (const lang of ['ko', 'en']) {
    const r = bin('wb-style', ['brief', 'docs', '--owned', 'docs/a.md', '--var', 'lane=l8', '--lang', lang], withEnv(fx), fx.repo)
    assert.equal(r.status, 0, r.stderr)
    const tr = translator(lang)
    assert.ok(r.stdout.includes(tr('style.report.line')), 'report style line is in the brief')
    assert.ok(!r.stdout.includes('{{style}}'))
    assert.ok(r.stdout.includes('{{title}}'), 'other placeholders stay')
    const m = bin('wb-style', ['brief', 'docs', '--owned', 'apps/a/screens/X.tsx,docs/b.md', '--lang', lang], withEnv(fx), fx.repo)
    assert.ok(m.stdout.includes(tr('style.haeyo.line')) && m.stdout.includes(tr('style.report.line')), 'mixed owned files list both')
  }
  fx.cleanup()
})

test('wb-style: of, text, rules and error exits', () => {
  const fx = makeEnv()
  project(fx, { style: { map: MAP } })
  const env = withEnv(fx)
  const of = bin('wb-style', ['of', 'docs/x.md', 'src/y.ts', '--json'], env, fx.repo)
  const rows = JSON.parse(of.stdout)
  assert.equal(rows[0].style, 'report')
  assert.equal(rows[1].style, null)
  assert.equal(bin('wb-style', ['text', 'apps/a/screens/b.tsx'], env, fx.repo).stdout.trim(), tko('style.haeyo.line'))
  assert.match(bin('wb-style', ['rules', 'haeyo'], env, fx.repo).stdout, /해요체/)
  assert.equal(bin('wb-style', ['rules', 'zzz'], env, fx.repo).status, 2)
  assert.equal(bin('wb-style', ['brief', 'nope'], env, fx.repo).status, 2)
  assert.equal(bin('wb-style', [], env, fx.repo).status, 2)
  fx.cleanup()
})

test('wb-style: a filled brief passes wb-check brief when every placeholder is given', () => {
  const fx = makeEnv()
  project(fx, { style: { map: MAP } })
  const vars = ['lane', 'title', 'worktree', 'branch', 'base_sha', 'read_first', 'goal', 'owned_files', 'acceptance', 'report_path', 'trailer']
  const args = ['brief', 'impl', '--owned', 'docs/a.md']
  for (const v of vars) args.push('--var', `${v}=${v === 'base_sha' ? 'abc1234' : `x-${v}`}`)
  const r = bin('wb-style', args, withEnv(fx), fx.repo)
  assert.equal(r.status, 0, r.stderr)
  const file = path.join(fx.base, 'brief.md')
  fs.writeFileSync(file, r.stdout)
  const c = bin('wb-check', ['brief', file], withEnv(fx), fx.repo)
  assert.equal(c.status, 0, c.stdout + c.stderr)
  fx.cleanup()
})

// ---- rule catalog ------------------------------------------------------

const rules = R.loadCatalog()

test('catalog: validates (text in both languages, enforcement paths exist, message codes exist)', () => {
  assert.deepEqual(R.validateCatalog(rules, { messages: messages('ko') }), [])
  assert.ok(rules.length >= 30)
})

test('catalog: every rule has why, where and recovery in ko and en', () => {
  for (const r of rules) {
    for (const l of ['ko', 'en']) {
      assert.ok(r.rule[l] && r.why[l] && r.recover[l], `${r.id} ${l}`)
      assert.ok(r.why[l].length > 15, `${r.id} why ${l}`)
    }
    assert.ok(r.enforced.length >= 1, r.id)
    assert.match(r.id, /^[a-z][a-z0-9-]+$/)
  }
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length)
})

test('catalog: planned rules name the lane that adds them; others point to existing files', () => {
  for (const r of rules.filter((x) => x.group === 'planned')) assert.ok(r.enforced.every((e) => e.kind === 'planned' && /^L\d+$/.test(e.lane)), r.id)
  for (const r of rules.filter((x) => x.group !== 'planned')) assert.ok(r.enforced.some((e) => e.kind !== 'planned'), r.id)
})

test('catalog: reasons carry no customer, host, person, machine spec or count (G24, G25)', () => {
  const bad = [/\d+\s*(GB|MB|건|개월|cores?|명)\b/i, /\b\d{1,3}(,\d{3})+\b/, /https?:\/\//, /@[\w.-]+\.\w+/, /\bhost(name)?\b.*\.\w{2,}/i]
  for (const r of rules) for (const l of ['ko', 'en']) for (const re of bad) assert.ok(!re.test(r.why[l]), `${r.id} ${l} why: ${re}`)
})

test('catalog: every blocking message code belongs to a rule', () => {
  const ko = messages('ko')
  const info = new Set(['dispatch.config_error', 'dispatch.not_first', 'safety.stamp.missing_unused'])
  const unmapped = Object.keys(ko)
    .filter((k) => /^(safety|dispatch)\..+\.why$/.test(k))
    .map((k) => k.replace(/\.why$/, ''))
    .filter((c) => !info.has(c) && !R.ruleForCode(rules, c))
  assert.deepEqual(unmapped, [])
})

test('catalog: ruleForCode prefers exact codes and understands wildcards', () => {
  assert.equal(R.ruleForCode(rules, 'safety.git.lane_commit').id, 'lane-own-branch')
  assert.equal(R.ruleForCode(rules, 'safety.git.force_push').id, 'no-force-push')
  assert.equal(R.ruleForCode(rules, 'safety.kill.pattern').id, 'no-pattern-kill')
  assert.equal(R.ruleForCode(rules, 'dispatch.brief_missing').id, 'brief-required')
  assert.equal(R.ruleForCode(rules, 'no.such.code'), null)
  const t = [{ id: 'a', enforced: [{ codes: ['x.*'] }] }, { id: 'b', enforced: [{ codes: ['x.y'] }] }]
  assert.equal(R.ruleForCode(t, 'x.y').id, 'b')
  assert.equal(R.ruleForCode(t, 'x.z').id, 'a')
})

test('catalog: validateCatalog reports empty text, missing paths and unknown codes', () => {
  const broken = [{ id: 'x', group: 'git', rule: { ko: 'a', en: '' }, why: { ko: 'a', en: 'a' }, recover: { ko: 'a', en: 'a' }, enforced: [{ kind: 'hook', path: 'nope/file.mjs', codes: ['zzz.*'] }] }]
  const p = R.validateCatalog(broken, { messages: messages('ko') }).join('\n')
  assert.match(p, /rule\.en empty/)
  assert.match(p, /missing path nope\/file\.mjs/)
  assert.match(p, /no message for zzz/)
})

test('catalog: rules/catalog.<lang>.md is up to date with catalog.json', () => {
  for (const lang of ['ko', 'en']) assert.equal(read(`rules/catalog.${lang}.md`), R.renderMarkdown(rules, lang, translator(lang)), `run: wb-rules render --write (${lang})`)
  assert.match(read('rules/catalog.ko.md'), /### lane-own-branch/)
})

test('wb-rules and wb-explain code: show the rule, why, place and recovery', () => {
  const fx = makeEnv()
  const env = withEnv(fx)
  const show = bin('wb-rules', ['show', 'no-pattern-kill'], env, fx.repo)
  assert.equal(show.status, 0)
  assert.match(show.stdout, /왜:/)
  assert.match(show.stdout, /어디서 지키나:.*kill-guard/)
  assert.match(show.stdout, /막혔을 때:/)
  const code = bin('wb-explain', ['code', 'safety.git.lane_commit', '--lang', 'en'], env, fx.repo)
  assert.equal(code.status, 0)
  assert.match(code.stdout, /lane-own-branch/)
  assert.match(code.stdout, /Fix:/)
  const js = JSON.parse(bin('wb-explain', ['code', 'safety.kill.pattern', '--json'], env, fx.repo).stdout)
  assert.equal(js.rule.id, 'no-pattern-kill')
  assert.equal(bin('wb-rules', ['show', 'nope'], env, fx.repo).status, 1)
  assert.equal(bin('wb-explain', ['code', 'nope.nope'], env, fx.repo).status, 1)
  assert.equal(bin('wb-rules', ['check'], env, fx.repo).status, 0)
  assert.match(bin('wb-rules', ['list', '--group', 'git'], env, fx.repo).stdout, /lane-own-branch/)
  assert.equal(bin('wb-rules', ['bogus'], env, fx.repo).status, 2)
  fx.cleanup()
})

// ---- explain -----------------------------------------------------------

const T0 = Date.parse('2026-10-16T01:00:00Z')
const collectIn = (fx, extra = {}) => {
  const resolved = resolveConfig({ projectDir: fx.repo, env: fx.env })
  const state = stateDir(fx.repo)
  fs.mkdirSync(state, { recursive: true })
  return { state, resolved, run: (now = T0) => X.collect({ cwd: fx.repo, root: fx.repo, resolved, state, env: fx.env, now, ...extra }) }
}

test('explain: a quiet project has no blocked or waiting item', () => {
  const fx = makeEnv()
  const { run } = collectIn(fx)
  const items = run().items.filter((i) => i.level !== 'note')
  assert.deepEqual(items, [])
  fx.cleanup()
})

test('explain: usage limit shows the model and reset time and points to model-routing', () => {
  const fx = makeEnv()
  const { run, resolved } = collectIn(fx)
  recordLimit(limitsFile(resolved, fx.env), { model: 'opus', untilEpoch: Math.floor((T0 + 3600e3) / 1000), scope: '5h', now: T0 })
  recordLimit(limitsFile(resolved, fx.env), { model: '*', untilEpoch: Math.floor((T0 + 7200e3) / 1000), scope: 'weekly', now: T0 })
  const items = run().items
  const lim = items.find((i) => i.id === 'limit')
  assert.equal(lim.level, 'wait')
  assert.equal(lim.vars.model, 'opus')
  assert.equal(lim.rule, 'model-routing')
  assert.ok(items.find((i) => i.id === 'limit_all'))
  assert.ok(run(T0 + 4 * 3600e3).items.every((i) => !i.id.startsWith('limit')), 'limits end')
  fx.cleanup()
})

test('explain: gate lock, dead lane, failed lane, review lane and full lanes', () => {
  const fx = makeEnv()
  const { run, state } = collectIn(fx)
  fs.writeFileSync(path.join(state, 'gate.lock'), '')
  W.initWave(state, { id: 'w1', title: 'w' }, T0)
  for (const [lane, status] of [['a', 'running'], ['b', 'failed'], ['c', 'review']]) {
    W.addLane(state, 'w1', { lane, task: 'impl-multi', model: 'opus' }, T0)
    W.setStatus(state, 'w1', lane, status, '', T0)
    const wt = path.join(fx.base, `wt-${lane}`)
    fs.mkdirSync(wt)
    upsertLane(state, { id: lane, branch: `wb/x/${lane}`, worktree: wt, integration: 'main' })
  }
  const items = run(T0 + 60 * 60e3).items
  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  assert.equal(byId.gate_lock.rule, 'gate-lock')
  assert.equal(byId.lane_dead.level, 'block')
  assert.equal(byId.lane_dead.vars.lane, 'a')
  assert.ok(byId.lane_dead.vars.min >= 59)
  assert.equal(byId.lane_failed.vars.lane, 'b')
  assert.equal(byId.lane_review.level, 'wait')
  assert.equal(byId.lanes_full.vars.max, 3)
  assert.equal(byId.on_protected.vars.branch, 'main')
  fx.cleanup()
})

test('explain: broken settings are a block with the file and key', () => {
  const fx = makeEnv()
  project(fx, { git: { owner_grant_ttl_min: 'x' } })
  const { run } = collectIn(fx)
  const it = run().items.find((i) => i.id === 'config_broken')
  assert.equal(it.level, 'block')
  assert.match(it.vars.file, /config\.json/)
  fx.cleanup()
})

test('explain: every item id has what, why and fix text in ko and en, and a known rule', () => {
  const src = read('lib/explain.mjs')
  const ids = new Set([...src.matchAll(/add\('(\w+)'/g)].map((m) => m[1]))
  for (const id of ['limit', 'limit_all', 'progress_stale', 'progress_missing', 'lane_dirty', 'worktree_missing', 'worktree_unregistered']) ids.add(id)
  assert.ok(ids.size >= 15)
  const ruleIds = new Set(rules.map((r) => r.id))
  for (const id of ids) {
    for (const k of ['what', 'why', 'fix']) {
      assert.ok(messages('ko')[`xp.${id}.${k}`], `ko xp.${id}.${k}`)
      assert.ok(messages('en')[`xp.${id}.${k}`], `en xp.${id}.${k}`)
    }
  }
  for (const m of src.matchAll(/'([a-z-]+)'\)\s*$/gm)) if (/^[a-z]+(-[a-z]+)+$/.test(m[1])) assert.ok(ruleIds.has(m[1]), `rule ${m[1]}`)
})

test('explain: itemLines and summary are plain text with a fix line', () => {
  const lines = X.itemLines({ id: 'limit', level: 'wait', vars: { model: 'opus', until: '10:00', scope: '5h' }, rule: 'model-routing' }, tko)
  assert.match(lines[0], /^\[기다림\] opus 모델/)
  assert.ok(lines.some((l) => l.includes('해결:')) && lines.some((l) => l.includes('wb-rules show model-routing')))
  assert.equal(X.summary([], tko), tko('xp.clear'))
  assert.match(X.summary([{ level: 'block' }, { level: 'wait' }, { level: 'wait' }], ten), /Blocked: 1, waiting: 2, notes: 0/)
})

test('wb-explain: process output in ko; links from explain.links', () => {
  const fx = makeEnv()
  project(fx, { explain: { links: [{ title: 'Guide', href: 'docs/guide.md' }, { title: 'More', href: 'docs/more.md' }] } })
  const env = withEnv(fx)
  const r = bin('wb-explain', [], env, fx.repo)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /막힌 것 0건/)
  const j = JSON.parse(bin('wb-explain', ['--json'], env, fx.repo).stdout)
  assert.ok(Array.isArray(j.items))
  const l = bin('wb-explain', ['links'], env, fx.repo).stdout
  assert.match(l, /Guide\tdocs\/guide\.md/)
  assert.match(l, /More\tdocs\/more\.md/)
  const none = makeEnv()
  assert.match(bin('wb-explain', ['links'], withEnv(none), none.repo).stdout, /explain\.links/)
  fx.cleanup()
  none.cleanup()
})

// ---- work --------------------------------------------------------------

test('work: request classification in ko and en', () => {
  const cases = [
    ['로그인 화면이 안 열려요', 'bug'],
    ['The export crashes on large files', 'bug'],
    ['설정 화면 버튼 위치를 바꾸고 싶어요', 'ui'],
    ['매뉴얼에 공유 설명을 추가해 줘', 'docs'],
    ['이 값이 어디에 저장되는지 조사해 줘', 'research'],
    ['검색에 필터 기능을 추가해 줘', 'feature'],
    ['새 제품을 처음부터 설계하고 싶어요', 'big-design'],
    ['Where is the retry logic', 'research'],
    ['', 'feature'],
  ]
  for (const [text, kind] of cases) assert.equal(K.classifyRequest(text), kind, text)
})

test('work: plan has understand first, record last, and a model for agent steps', () => {
  const fx = makeEnv()
  const resolved = resolveConfig({ projectDir: fx.repo, env: fx.env })
  const plan = K.buildPlan({ request: '로그인이 안 돼요', routing: routingOf(resolved), env: fx.env })
  assert.equal(plan.kind, 'bug')
  assert.equal(plan.steps[0].id, 'understand')
  assert.equal(plan.steps.at(-1).id, 'record')
  assert.deepEqual(plan.steps.map((s) => s.n), plan.steps.map((_, i) => i + 1))
  for (const s of plan.steps.filter((x) => x.task)) assert.ok(s.model, s.id)
  for (const s of plan.steps.filter((x) => !x.task)) assert.equal(s.model, null)
  for (const s of plan.steps) assert.ok(messages('ko')[`work.step.${s.id}`] && messages('en')[`work.step.${s.id}`], s.id)
  fx.cleanup()
})

test('work: a full usage limit shows a wait time instead of a lower model', () => {
  const fx = makeEnv()
  const resolved = resolveConfig({ projectDir: fx.repo, env: fx.env })
  const routing = routingOf(resolved)
  const all = Object.keys(routing.models || {})
  const limits = Object.fromEntries(all.map((m) => [m, '2099-01-01T00:00:00.000Z']))
  const plan = buildPlan({ request: '버그 고쳐 줘 오류', routing, limits, env: fx.env })
  const fix = plan.steps.find((s) => s.id === 'fix')
  assert.equal(fix.model, null)
  assert.ok(fix.wait)
  fx.cleanup()
})

test('work: big design reports whether the design plugin is installed', () => {
  const fx = makeEnv()
  const resolved = resolveConfig({ projectDir: fx.repo, env: fx.env })
  const routing = routingOf(resolved)
  assert.equal(K.buildPlan({ request: '새 제품 처음부터 설계', routing, env: fx.env }).harness, 'missing')
  const dir = path.join(fx.env.CLAUDE_CONFIG_DIR, 'plugins')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'king-wjang-harness@market': [{}] } }))
  assert.equal(K.buildPlan({ request: '새 제품 처음부터 설계', routing, env: fx.env }).harness, 'installed')
  assert.equal(K.buildPlan({ request: '버튼 고쳐', routing, env: fx.env }).harness, undefined)
  fx.cleanup()
})

test('work: progress stage follows the lane statuses', () => {
  const row = (status) => ({ status })
  const p = (...s) => K.progressFrom(s.map(row))
  assert.equal(p().stage, 'understand')
  assert.equal(p('pending', 'pending').stage, 'brief')
  assert.equal(p('running', 'pending').stage, 'build')
  assert.equal(p('review', 'running').stage, 'build')
  assert.equal(p('review', 'review').stage, 'review')
  assert.equal(p('done', 'review').stage, 'review')
  assert.equal(p('done', 'done').stage, 'integrate')
  assert.equal(p('failed', 'review').stage, 'build')
  assert.equal(p('blocked').stuck, 1)
  assert.equal(p('running').index, 3)
  assert.equal(p().of, 7)
})

test('work: progress line text (ko and en)', () => {
  const rows = ['running', 'running', 'review', 'blocked'].map((status) => ({ status }))
  const pr = K.progressFrom(rows)
  assert.equal(K.renderProgress(pr, tko), '[■■■□□□□] 3/7 구현 중 · 진행 2 · 검수 대기 1 · 막힘 1')
  assert.equal(K.renderProgress(pr, ten), '[■■■□□□□] 3/7 Building · 2 running · 1 in review · 1 blocked')
  assert.match(K.renderProgress(K.progressFrom([]), tko), /레인 없음/)
})

test('wb-work: plan and progress from the ledger', () => {
  const fx = makeEnv()
  const env = withEnv(fx)
  const plan = bin('wb-work', ['plan', '로그인이', '안', '돼요'], env, fx.repo)
  assert.equal(plan.status, 0, plan.stderr)
  assert.match(plan.stdout, /요청 종류: 고장·오류/)
  assert.match(plan.stdout, /\(모델 \w+\)/)
  const js = JSON.parse(bin('wb-work', ['plan', 'add a filter', '--json'], env, fx.repo).stdout)
  assert.equal(js.kind, 'feature')
  assert.equal(bin('wb-work', ['plan'], env, fx.repo).status, 2)
  assert.match(bin('wb-work', ['progress'], env, fx.repo).stdout, /1\/7 요청 확인 · 레인 없음/)
  const state = stateDir(fx.repo)
  fs.mkdirSync(state, { recursive: true })
  W.initWave(state, { id: 'w1' })
  W.addLane(state, 'w1', { lane: 'a', task: 'impl-multi', model: 'opus' })
  W.setStatus(state, 'w1', 'a', 'running', '')
  assert.match(bin('wb-work', ['progress'], env, fx.repo).stdout, /3\/7 구현 중 · 진행 1/)
  assert.equal(JSON.parse(bin('wb-work', ['progress', '--json'], env, fx.repo).stdout).counts.running, 1)
  assert.equal(boardRows(state).length, 1)
  fx.cleanup()
})

// ---- decide ------------------------------------------------------------

test('decide: render, parse and answer a record in ko and en', () => {
  for (const lang of ['ko', 'en']) {
    const opts = [{ key: 'A', text: 'one' }, { key: 'B', text: 'two' }]
    const doc = D.render({ lang, title: 'T', question: 'Q?', options: opts, recommend: 'B', date: '2026-10-17' })
    assert.deepEqual({ ...D.parse(doc) }, { status: 'pending', title: 'T', body: lang === 'ko' ? '결정 대기' : 'Pending' })
    assert.match(doc, /- A\. one\n- B\. two/)
    assert.match(doc, /B\. two/)
    const done = D.answer(doc, { choice: 'B. two', note: 'simple', date: '2026-10-18', lang })
    const p = D.parse(done)
    assert.equal(p.status, 'decided')
    assert.match(p.body, /B\. two/)
    assert.match(p.body, /2026-10-18/)
    assert.match(p.body, /simple/)
    assert.ok(!/\{\{/.test(doc))
  }
  assert.equal(D.answer('plain text', { choice: 'x', date: 'd', lang: 'ko' }), null)
  assert.equal(D.parse('plain text'), null)
})

test('decide: slug rules and path pattern', () => {
  assert.ok(D.slugOk('ui-structure') && D.slugOk('화면-구조') && D.slugOk('a_1'))
  assert.ok(!D.slugOk('') && !D.slugOk('a b') && !D.slugOk('../x') && !D.slugOk('-x'))
  assert.equal(D.decisionPath('/p', 'docs/decisions/{date}-{slug}.md', { date: '2026-10-17', slug: 'x' }), '/p/docs/decisions/2026-10-17-x.md')
})

test('wb-decide: new, list, answer; refuses duplicates, bad input and double answers; never commits', () => {
  const fx = makeEnv()
  const env = withEnv(fx)
  const head = () => git(fx.repo, 'rev-parse', 'HEAD')
  const before = head()
  const mk = (slug, ...extra) => bin('wb-decide', ['new', slug, '--title', '저장 방식', '--question', '무엇으로 저장할까요?', '--option', 'A=파일', '--option', 'B=DB', ...extra], env, fx.repo)
  const c = mk('storage', '--recommend', 'A')
  assert.equal(c.status, 0, c.stderr)
  assert.match(c.stdout, /결정 요청을 만들었어요: docs\/decisions\/\d{4}-\d\d-\d\d-storage\.md/)
  assert.match(c.stdout, /자동으로 커밋하지 않아요/)
  assert.notEqual(mk('storage').status, 0, 'duplicate')
  assert.equal(mk('bad slug').status, 2)
  assert.equal(mk('x', '--recommend', 'Z').status, 2)
  assert.equal(bin('wb-decide', ['new', 'y', '--title', 't', '--question', 'q', '--option', 'A=1'], env, fx.repo).status, 2, 'one option')
  assert.equal(bin('wb-decide', ['new', 'y', '--title', 't'], env, fx.repo).status, 2, 'no question')
  const pend = bin('wb-decide', ['list', '--pending'], env, fx.repo)
  assert.match(pend.stdout, /결정 대기\t.*storage\.md\t저장 방식/)
  assert.equal(bin('wb-decide', ['answer', 'storage'], env, fx.repo).status, 2, 'no choice')
  const a = bin('wb-decide', ['answer', 'storage', '--choice', 'A. 파일', '--note', '단순함'], env, fx.repo)
  assert.equal(a.status, 0, a.stderr)
  assert.match(bin('wb-decide', ['list', '--pending'], env, fx.repo).stdout, /결정을 기다리는 것이 없어요/)
  assert.match(bin('wb-decide', ['list'], env, fx.repo).stdout, /결정됨/)
  assert.notEqual(bin('wb-decide', ['answer', 'storage', '--choice', 'B'], env, fx.repo).status, 0, 'already decided')
  assert.notEqual(bin('wb-decide', ['answer', 'nothing', '--choice', 'B'], env, fx.repo).status, 0)
  assert.equal(JSON.parse(bin('wb-decide', ['list', '--json'], env, fx.repo).stdout)[0].status, 'decided')
  assert.equal(head(), before, 'no commit was made')
  fx.cleanup()
})

test('wb-decide: path comes from project.paths.decisions', () => {
  const fx = makeEnv()
  project(fx, { paths: { decisions: 'adr/{slug}.md' } })
  const r = bin('wb-decide', ['new', 'x', '--title', 't', '--question', 'q', '--option', 'A=1', '--option', 'B=2'], withEnv(fx), fx.repo)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(fs.existsSync(path.join(fx.repo, 'adr', 'x.md')))
  fx.cleanup()
})

// ---- skills ------------------------------------------------------------

test('skills: work, explain, writing-style, decide exist with matching front matter', () => {
  for (const name of ['work', 'explain', 'writing-style', 'decide']) {
    const body = read(`skills/${name}/SKILL.md`)
    const m = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(body)
    assert.ok(m, name)
    assert.equal(m[1], name)
    assert.ok(m[2].length > 60 && m[2].includes(`/wb:${name}`), `${name} description names its command`)
  }
})

test('skills: every wb tool a skill names exists in bin/', () => {
  for (const name of ['work', 'explain', 'writing-style', 'decide']) {
    for (const m of read(`skills/${name}/SKILL.md`).matchAll(/`(wb-[a-z-]+)[ `]/g)) assert.ok(fs.existsSync(path.join(ROOT, 'bin', m[1])), `${name}: ${m[1]}`)
  }
})
