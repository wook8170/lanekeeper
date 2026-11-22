// Readable code (project.code_standards.readability): settings and the switch to turn it
// off, the seven rules in impl, fix and return briefs, the review-lane items, and the
// warn hook notes (history markers, header comment, long signatures) with their misses.
// Read tests/code-standards.test.mjs first: this file uses the same fixture.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, makeEnv, bin } from './l3-fixture.mjs'
import { resolveConfig } from '../lib/config.mjs'
import { checkBrief } from '../lib/brief.mjs'
import { writeReturnBrief } from '../lib/review.mjs'
import * as RD from '../lib/readability.mjs'
import { handle } from '../hooks/scripts/codestd/warn.mjs'

function repo(codeStandards) {
  const fx = makeEnv()
  fs.mkdirSync(path.join(fx.repo, '.lanekeeper'))
  const cfg = { version: 1, ...(codeStandards ? { code_standards: codeStandards } : {}) }
  fs.writeFileSync(path.join(fx.repo, '.lanekeeper', 'config.json'), JSON.stringify(cfg))
  return fx
}

const OFF = { readability: { enabled: false } }
const fillRest = (text) => text.replace(/\{\{\s*base_sha\s*\}\}/g, '1a2b3c4d').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, 'x-$1')

// ---- settings ---------------------------------------------------------------------

test('settings: readability defaults come from the rules, project values win, bad types are errors', () => {
  const fx = repo({ readability: { doc: 'docs/readable.md#rules', max_params: 5 } })
  try {
    const r = resolveConfig({ projectDir: fx.repo, env: fx.env })
    assert.deepEqual(r.errors, [])
    assert.deepEqual(RD.readability(r.config), { enabled: true, doc: 'docs/readable.md#rules', max_params: 5, max_props: 12, review_tasks: 3, fresh_eyes_review: true })
    const got = bin('lanekeeper-config', ['get', 'project.code_standards.readability.review_tasks'], fx.env, fx.repo)
    assert.equal(got.stdout.trim(), '3')
  } finally {
    fx.cleanup()
  }
  assert.deepEqual(RD.readability({}), { ...RD.DEFAULTS })
  const bad = repo({ readability: { enabled: 'no', max_params: 0, max_props: 101, review_tasks: 11 } })
  try {
    const r = resolveConfig({ projectDir: bad.repo, env: bad.env })
    const paths = r.errors.map((e) => e.path).sort()
    assert.deepEqual(paths, ['project.code_standards.readability.enabled', 'project.code_standards.readability.max_params', 'project.code_standards.readability.max_props', 'project.code_standards.readability.review_tasks'])
  } finally {
    bad.cleanup()
  }
  assert.equal(RD.readability({ project: { code_standards: OFF } }).enabled, false)
  assert.equal(RD.readability({ project: { code_standards: { readability: { fresh_eyes_review: false } } } }).fresh_eyes_review, false)
})

// ---- briefs -----------------------------------------------------------------------

const RULE_WORDS = {
  ko: ['판정과 실행을 나눈다', '문장 순서대로', '`ctx`', '같은 규칙은', '이름은 하는 일을', '이력은 git', '머리 주석 3줄', 'README', '과제 1 ~ 3개', '파일 3개, 300줄', 'props 는 12개 이하'],
  en: ['Keep decisions apart', 'statement order', '`ctx`', 'one rule in one place', 'Names say what', 'History', 'three-line header', 'README', '1 to 3 tasks', '3 files and 300 lines', 'at 12 or fewer'],
}

test('brief: impl and fix carry the seven readable code rules by default, in ko and en', () => {
  const fx = repo(null)
  try {
    for (const lang of ['ko', 'en']) {
      for (const type of ['impl', 'fix']) {
        const r = bin('lanekeeper-style', ['brief', type, '--lang', lang], fx.env, fx.repo)
        assert.equal(r.status, 0, r.stderr)
        assert.ok(!r.stdout.includes('{{readability}}'), `${lang}/${type} placeholder filled`)
        for (const word of RULE_WORDS[lang]) assert.ok(r.stdout.includes(word), `${lang}/${type}: ${word}`)
        assert.match(r.stdout, lang === 'ko' ? /- 읽기 쉬운 코드: / : /- Readable code: /)
        assert.equal(r.stdout.match(/^ {2}- /gm).length, 7, `${lang}/${type}: seven rules`)
        assert.equal(checkBrief(fillRest(r.stdout)).ok, true, `${lang}/${type} still a complete brief`)
      }
    }
  } finally {
    fx.cleanup()
  }
})

test('brief: max_params, review_tasks and doc show up; enabled false drops the line; --var wins', () => {
  const fx = repo({ readability: { doc: 'docs/readable.md#rules', max_params: 5, max_props: 9, review_tasks: 2 } })
  try {
    const r = bin('lanekeeper-style', ['brief', 'impl', '--lang', 'en'], fx.env, fx.repo)
    assert.ok(r.stdout.includes('follow the rules in `docs/readable.md#rules`'))
    assert.ok(r.stdout.includes('at 5 or fewer'))
    assert.ok(r.stdout.includes('screen component at 9 or fewer'))
    assert.ok(r.stdout.includes('1 to 2 tasks'))
    const own = bin('lanekeeper-style', ['brief', 'fix', '--lang', 'en', '--var', 'readability=See docs/x.md'], fx.env, fx.repo)
    assert.ok(own.stdout.includes('- See docs/x.md\n'))
  } finally {
    fx.cleanup()
  }
  const off = repo(OFF)
  try {
    const r = bin('lanekeeper-style', ['brief', 'impl', '--lang', 'en'], off.env, off.repo)
    assert.ok(!r.stdout.includes('Readable code') && !r.stdout.includes('readability'))
    assert.ok(!r.stdout.includes('\n- \n'), 'no empty bullet left behind')
    assert.equal(checkBrief(fillRest(r.stdout)).ok, true)
  } finally {
    off.cleanup()
  }
})

test('return brief: carries the rules unless readability is off', () => {
  const fx = repo(null)
  try {
    const on = fs.readFileSync(writeReturnBrief({ root: fx.repo, config: {}, lang: 'ko', lane: 'l3', title: 't', findings: ['a'], base: '1a2b3c4d' }), 'utf8')
    assert.ok(on.includes('- 읽기 쉬운 코드: ') && on.includes('판정과 실행을 나눈다'))
    assert.ok(!on.includes('{{readability}}'))
    const off = fs.readFileSync(writeReturnBrief({ root: fx.repo, config: { project: { code_standards: OFF } }, lang: 'en', lane: 'l3', title: 't', findings: ['a'], base: '1a2b3c4d' }), 'utf8')
    assert.ok(!off.includes('Readable code') && !off.includes('{{readability}}'))
  } finally {
    fx.cleanup()
  }
})

// ---- review items -----------------------------------------------------------------

test('review-lane: the readable code items, the fresh-eyes check and the separate-context review are listed', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/review-lane/SKILL.md'), 'utf8')
  const section = skill.slice(skill.indexOf('## Readable code'))
  assert.ok(section.length > 20, 'section exists')
  for (const word of ['review_tasks', '3 files', '300 lines', 'two places', 'statement order', '`ctx`', '`deps`', 'max_params', 'max_props', 'fresh_eyes_review', 'lanekeeper:design-adversary', 'enabled']) {
    assert.ok(section.includes(word), word)
  }
  const std = fs.readFileSync(path.join(ROOT, 'skills/code-standards/SKILL.md'), 'utf8')
  assert.match(std, /## Readable code/)
})

// ---- warn hook --------------------------------------------------------------------

const ON = { doc: 'CONTRIBUTING.md#code-standards', warn_hook: true }

function hookRepo(cs = ON) {
  const fx = repo(cs)
  const call = (tool, file, ti) => handle({ tool_name: tool, cwd: fx.repo, tool_input: { file_path: path.join(fx.repo, file), ...ti } }, fx.env)
  return { ...fx, call }
}
const text = (r) => r?.hookSpecificOutput?.additionalContext || ''
const HEADER = '// Loads the price table.\n// Called by the cart screen.\n// Read prices.ts first.\n'
const body = (code) => `${HEADER}export const a = 1\n${code}\nexport const b = 2\nexport const c = 3\n`

test('warn hook: history markers in comments are noted, never blocked', () => {
  const h = hookRepo()
  try {
    for (const marker of ['// 1.8.7 — moved here', '// B5: lock first', '/* F-22 AC1 */', '// Design SoT: _design/Studio.html L454-485', '// see design.md#L120', '// fixed in (#816)', '// v2.0.0 - new layout']) {
      const r = h.call('Write', 'src/a.ts', { content: body(marker) })
      assert.match(text(r), /history marker/, marker)
      assert.equal(r.hookSpecificOutput.permissionDecision, undefined)
    }
  } finally {
    h.cleanup()
  }
})

test('warn hook: plain comments, strings and code with look-alike text are not noted', () => {
  const h = hookRepo()
  try {
    for (const code of [
      '// requires node 18.0.0 or later',
      '// Measured on Claude Code 2.1.319: the dialog opens',
      '// text is UTF-8 and dates are ISO-8601; hashes use SHA-256',
      '// the range A1:B2 is the header',
      "const url = 'see 1.8.7 — B5: F-22 L2390'",
      'const version = "1.8.7"',
      '// Lock the shelf before the drop (design 09-07 §4)',
    ]) {
      assert.equal(h.call('Write', 'src/b.ts', { content: body(code) }), null, code)
    }
  } finally {
    h.cleanup()
  }
})

test('warn hook: only new history markers count', () => {
  const h = hookRepo()
  try {
    const old = '// 1.8.7 — old note\nconst a = 1\n'
    assert.equal(h.call('Edit', 'src/c.ts', { old_string: old, new_string: `${old}const b = 2\n` }), null)
    assert.match(text(h.call('Edit', 'src/c.ts', { old_string: 'const a = 1', new_string: '// B5: new note\nconst a = 1' })), /history marker/)
  } finally {
    h.cleanup()
  }
})

test('warn hook: a new file without a header comment is noted; short files, old files and .d.ts are not', () => {
  const h = hookRepo()
  const code = 'export const a = 1\nexport const b = 2\nexport const c = 3\nexport const d = 4\nexport const e = 5\n'
  try {
    assert.match(text(h.call('Write', 'src/new.ts', { content: code })), /no header comment/)
    assert.equal(h.call('Write', 'src/head.ts', { content: HEADER + code }), null)
    assert.equal(h.call('Write', 'src/bin.mjs', { content: `#!/usr/bin/env node\n${HEADER}${code}` }), null)
    assert.equal(h.call('Write', 'src/short.ts', { content: 'export const a = 1\n' }), null)
    assert.equal(h.call('Write', 'src/types.d.ts', { content: code }), null)
    const vue = `<template>\n  <div />\n</template>\n<script setup lang="ts">\n${HEADER}const a = 1\n</script>\n`
    assert.equal(h.call('Write', 'src/View.vue', { content: vue }), null)
    assert.match(text(h.call('Write', 'src/Bare.vue', { content: vue.replace(HEADER, '') })), /no header comment/)
    fs.mkdirSync(path.join(h.repo, 'src'), { recursive: true })
    fs.writeFileSync(path.join(h.repo, 'src', 'old.ts'), code)
    assert.equal(h.call('Write', 'src/old.ts', { content: `${code}export const f = 6\n` }), null, 'an existing file is not new')
  } finally {
    h.cleanup()
  }
})

test('warn hook: more than max_params parameters or input fields is noted', () => {
  const h = hookRepo()
  try {
    for (const code of [
      'export function plan(a, b, c, d, e, f, g, h) { return a }',
      'export const plan = (a, b, c, d, e, f, g, h) => a',
      'export const plan = async (a: number, b: Map<string, number>, c, d, e, f, g, h): Promise<void> => {}',
      'class K {\n  plan(a, b, c, d, e, f, g, h) { return a }\n}',
      'export function plan({ a, b, c, d, e, f, g, h }) { return a }',
    ]) {
      const r = text(h.call('Write', 'src/p.ts', { content: body(code) }))
      assert.match(r, /more than 7 parameters/, code)
      assert.match(r, /plan: 8/, code)
    }
  } finally {
    h.cleanup()
  }
})

test('warn hook: seven parameters, calls, conditions, typed objects and callback types are not noted', () => {
  const h = hookRepo()
  try {
    for (const code of [
      'export function plan(a, b, c, d, e, f, g) { return a }',
      'run(a, b, c, d, e, f, g, h, i)',
      'if (check(a, b, c, d, e, f, g, h)) { go() }',
      'export function plan(opts: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }) { return opts }',
      'export function plan(cb: (a, b, c, d, e, f, g, h) => void) { return cb }',
      "const s = 'function x(a, b, c, d, e, f, g, h) {}'",
      'type Plan = (a, b, c, d, e, f, g, h) => void',
    ]) {
      assert.equal(h.call('Write', 'src/q.ts', { content: body(code) }), null, code)
    }
  } finally {
    h.cleanup()
  }
})

test('warn hook: max_params from settings, readability off, warn_hook off, test files skipped', () => {
  const five = hookRepo({ ...ON, readability: { max_params: 5 } })
  try {
    assert.match(text(five.call('Write', 'src/p.ts', { content: body('export function plan(a, b, c, d, e, f) {}') })), /more than 5 parameters/)
  } finally {
    five.cleanup()
  }
  const bad = { content: '// 1.8.7 — note\nexport function plan(a, b, c, d, e, f, g, h) {}\nexport const a = 1\nexport const b = 2\nexport const c = 3\n' }
  for (const cs of [{ ...ON, ...OFF }, { warn_hook: false }, null]) {
    const off = hookRepo(cs)
    try {
      assert.equal(off.call('Write', 'src/a.ts', bad), null, JSON.stringify(cs))
    } finally {
      off.cleanup()
    }
  }
  const h = hookRepo()
  try {
    assert.equal(h.call('Write', 'src/a.test.ts', bad), null)
    const both = text(h.call('Write', 'src/a.ts', { content: `${bad.content}console.log(1)\n` }))
    assert.match(both, /`console`/)
    assert.match(both, /history marker/)
    assert.match(both, /plan: 8/)
  } finally {
    h.cleanup()
  }
})

const names = (n) => Array.from({ length: n }, (_, i) => `p${i}`)
const destructured = (n) => `{ ${names(n).join(', ')} }`
const typeLiteral = (n) => names(n).map((k) => `${k}: string`).join('\n  ')

test('warn hook: a React component is held to max_props (12), a plain function to max_params (7)', () => {
  const h = hookRepo()
  try {
    for (const code of [
      `export function Panel(${destructured(13)}) {\n  return <div />\n}`,
      `export const Panel = (${destructured(13)}: Props) => (\n  <div />\n)`,
      `export const Panel = memo((${destructured(13)}) => <div />)`,
    ]) {
      const r = text(h.call('Write', 'src/Panel.tsx', { content: body(code) }))
      assert.match(r, /more than 12 props/, code)
      assert.match(r, /Panel: 13|\(arrow\): 13/, code)
    }
    for (const code of [
      `export function Panel(${destructured(12)}) {\n  return <div />\n}`,
      `export const Panel = (${destructured(10)}) => <section />`,
    ]) {
      assert.equal(h.call('Write', 'src/Panel.tsx', { content: body(code) }), null, code)
    }
    const plain = text(h.call('Write', 'src/plan.ts', { content: body(`export function Plan(${destructured(8)}) {\n  return 1\n}`) }))
    assert.match(plain, /more than 7 parameters/, 'a capitalised function that returns no JSX is a plain function')
    const lower = text(h.call('Write', 'src/view.tsx', { content: body(`export function renderRow(${destructured(8)}) {\n  return <tr />\n}`) }))
    assert.match(lower, /more than 7 parameters/, 'a lower-case name is not a component')
  } finally {
    h.cleanup()
  }
})

test('warn hook: Vue defineProps over max_props is noted in every form; 12 props and max_props from settings', () => {
  const h = hookRepo()
  const vue = (script) => `<template>\n  <div />\n</template>\n<script setup lang="ts">\n${HEADER}${script}\n</script>\n`
  try {
    for (const script of [
      `const props = defineProps<{\n  ${typeLiteral(13)}\n}>()`,
      `interface Props {\n  ${typeLiteral(13)}\n}\nconst props = withDefaults(defineProps<Props>(), {})`,
      `const props = defineProps({ ${names(13).map((k) => `${k}: { type: String, default: '' }`).join(', ')} })`,
      `const props = defineProps([${names(13).map((k) => `'${k}'`).join(', ')}])`,
    ]) {
      assert.match(text(h.call('Write', 'src/View.vue', { content: vue(script) })), /more than 12 props/, script)
    }
    assert.equal(h.call('Write', 'src/View.vue', { content: vue(`const props = defineProps<{\n  ${typeLiteral(12)}\n}>()`) }), null)
  } finally {
    h.cleanup()
  }
  const eight = hookRepo({ ...ON, readability: { max_props: 8 } })
  try {
    assert.match(text(eight.call('Write', 'src/Panel.tsx', { content: body(`export function Panel(${destructured(9)}) {\n  return <div />\n}`) })), /more than 8 props/)
  } finally {
    eight.cleanup()
  }
})

test('topLevelParts: commas inside brackets, generics and arrow types do not split', () => {
  assert.deepEqual(RD.topLevelParts('a, [b, c], { d, e }, f: Map<K, V>, g: (x, y) => z'), ['a', '[b, c]', '{ d, e }', 'f: Map<K, V>', 'g: (x, y) => z'])
  assert.deepEqual(RD.topLevelParts('a, b,'), ['a', 'b'])
})
