// Code standards (project.code_standards): settings and defaults, the brief line
// filled by lanekeeper-style brief and return briefs, the warn hook (warns, never
// blocks) and the gate kind `code-standards`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, makeEnv, bin, git, runScript } from './l3-fixture.mjs'
import { resolveConfig } from '../lib/config.mjs'
import { checkBrief } from '../lib/brief.mjs'
import { writeReturnBrief } from '../lib/review.mjs'
import * as Q from '../lib/quality.mjs'
import * as CS from '../lib/code-standards.mjs'
import { handle } from '../hooks/scripts/codestd/warn.mjs'

const STD = {
  doc: 'CONTRIBUTING.md#code-standards',
  helpers: ['ignoreError', 'warnError'],
  protected_paths: ['server/billing/**'],
}

function repo(codeStandards) {
  const fx = makeEnv()
  fs.mkdirSync(path.join(fx.repo, '.lanekeeper'))
  const cfg = { version: 1, ...(codeStandards ? { code_standards: codeStandards } : {}) }
  fs.writeFileSync(path.join(fx.repo, '.lanekeeper', 'config.json'), JSON.stringify(cfg))
  return fx
}

// ---- settings ---------------------------------------------------------------------

test('settings: project.code_standards defaults are empty and off', () => {
  const fx = repo(null)
  try {
    const r = resolveConfig({ projectDir: fx.repo, env: fx.env })
    assert.deepEqual(r.config.project.code_standards, { doc: '', checks: [], helpers: [], protected_paths: [], exempt_paths: [], warn_hook: false })
    assert.deepEqual(r.errors, [])
    const got = bin('lanekeeper-config', ['get', 'project.code_standards.warn_hook'], fx.env, fx.repo)
    assert.equal(got.stdout.trim(), 'false')
  } finally {
    fx.cleanup()
  }
})

test('settings: project values win, wrong types are errors, lanekeeper-config get reads them', () => {
  const fx = repo({ ...STD, checks: ['npm run lint'], warn_hook: true })
  try {
    const r = resolveConfig({ projectDir: fx.repo, env: fx.env })
    assert.equal(r.config.project.code_standards.doc, STD.doc)
    assert.deepEqual(r.config.project.code_standards.checks, ['npm run lint'])
    assert.equal(r.config.project.code_standards.warn_hook, true)
    assert.deepEqual(r.config.project.code_standards.exempt_paths, [], 'keys left out keep the default')
    const doc = bin('lanekeeper-config', ['get', 'project.code_standards.doc'], fx.env, fx.repo)
    assert.equal(doc.stdout.trim(), STD.doc)
  } finally {
    fx.cleanup()
  }
  const bad = repo({ warn_hook: 'yes', checks: 'npm test', other: 1 })
  try {
    const r = resolveConfig({ projectDir: bad.repo, env: bad.env })
    const paths = r.errors.map((e) => e.path).sort()
    assert.deepEqual(paths, ['project.code_standards.checks', 'project.code_standards.warn_hook'])
    assert.ok(r.warnings.some((w) => w.path === 'project.code_standards.other'))
  } finally {
    bad.cleanup()
  }
})

// ---- brief line -------------------------------------------------------------------

const fillRest = (text) => text.replace(/\{\{\s*base_sha\s*\}\}/g, '1a2b3c4d').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, 'x-$1')

test('brief: impl and fix get the standards line when a document is set, in ko and en', () => {
  const fx = repo(STD)
  try {
    for (const lang of ['ko', 'en']) {
      for (const type of ['impl', 'fix']) {
        const r = bin('lanekeeper-style', ['brief', type, '--lang', lang, '--owned', 'src/a.ts'], fx.env, fx.repo)
        assert.equal(r.status, 0, r.stderr)
        assert.ok(!r.stdout.includes('{{code_standards}}'), `${lang}/${type} placeholder filled`)
        const line = r.stdout.split('\n').find((l) => l.includes(STD.doc))
        assert.ok(line, `${lang}/${type} names the document`)
        assert.match(line, /^- /)
        assert.match(line, /ignoreError, warnError/)
        assert.match(line, /server\/billing\/\*\*/)
        assert.match(line, lang === 'ko' ? /어기면 미완료/ : /not done/)
        assert.equal(checkBrief(fillRest(r.stdout)).ok, true, `${lang}/${type} still a complete brief`)
      }
    }
  } finally {
    fx.cleanup()
  }
})

test('brief: without a document the line is left out, and --var code_standards wins', () => {
  const fx = repo({ helpers: ['ignoreError'] })
  try {
    const r = bin('lanekeeper-style', ['brief', 'impl', '--lang', 'en'], fx.env, fx.repo)
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!r.stdout.includes('code_standards'))
    assert.ok(!/code standards/i.test(r.stdout))
    assert.ok(!r.stdout.includes('\n- \n'), 'no empty bullet left behind')
    assert.equal(checkBrief(fillRest(r.stdout)).ok, true)
    const own = bin('lanekeeper-style', ['brief', 'fix', '--lang', 'en', '--var', 'code_standards=Follow docs/style.md'], fx.env, fx.repo)
    assert.ok(own.stdout.includes('- Follow docs/style.md\n'))
  } finally {
    fx.cleanup()
  }
})

test('brief: other templates carry no standards line', () => {
  const fx = repo(STD)
  try {
    for (const type of ['research', 'docs', 'mockup']) {
      const r = bin('lanekeeper-style', ['brief', type, '--lang', 'en'], fx.env, fx.repo)
      assert.ok(!r.stdout.includes(STD.doc), type)
    }
  } finally {
    fx.cleanup()
  }
})

test('return brief: the standards line follows project.code_standards.doc', () => {
  const fx = repo(null)
  try {
    const withDoc = writeReturnBrief({ root: fx.repo, config: { project: { code_standards: STD } }, lang: 'ko', lane: 'l3', title: 't', findings: ['a'], base: '1a2b3c4d' })
    const a = fs.readFileSync(withDoc, 'utf8')
    assert.ok(a.includes(`- 코드 작성 기준: \`${STD.doc}\``))
    assert.ok(!a.includes('{{code_standards}}'))
    const without = writeReturnBrief({ root: fx.repo, config: {}, lang: 'en', lane: 'l3', title: 't', findings: ['a'], base: '1a2b3c4d' })
    const b = fs.readFileSync(without, 'utf8')
    assert.ok(!b.includes('code_standards') && !/code standards/i.test(b))
  } finally {
    fx.cleanup()
  }
})

test('applyToBrief: replaces in place, drops the line, leaves other text alone', () => {
  const text = 'a\n- {{code_standards}}\nb\n'
  assert.equal(CS.applyToBrief(text, 'X'), 'a\n- X\nb\n')
  assert.equal(CS.applyToBrief(text, ''), 'a\nb\n')
  assert.equal(CS.applyToBrief('a\nb\n', 'X'), 'a\nb\n')
})

// ---- warn hook --------------------------------------------------------------------

const ON = { ...STD, warn_hook: true, exempt_paths: ['cli/**'] }

function hookRepo(cs = ON) {
  const fx = repo(cs)
  const call = (tool, file, ti) => handle({ tool_name: tool, cwd: fx.repo, tool_input: { file_path: path.join(fx.repo, file), ...ti } }, fx.env)
  return { ...fx, call }
}
const text = (r) => r?.hookSpecificOutput?.additionalContext || ''
const neverBlocks = (r) => assert.equal(r?.hookSpecificOutput?.permissionDecision, undefined)

test('warn hook: each pattern in new code adds a note that names the helpers and the document', () => {
  const h = hookRepo()
  try {
    const cases = [
      ['empty catch', 'try { run() } catch (e) {}', /Empty catch/],
      ['bare catch', 'try { run() } catch {}', /Empty catch/],
      ['comment only', 'try { run() } catch (e) {\n  // fine\n}', /Empty catch/],
      ['void e', 'try { run() } catch (err) { void err }', /void <error>/],
      ['catch value', 'load().catch(() => null)', /\.catch\(\(\) => value\)/],
      ['catch empty arrow', 'load().catch((e) => {})', /\.catch\(\(\) => value\)/],
      ['catch identifier', 'load().catch(() => fallback)', /\.catch\(\(\) => value\)/],
      ['console', 'console.log("x")', /`console`/],
      ['console index', 'console["warn"]("x")', /`console`/],
      ['globalThis.console', 'globalThis.console.error("x")', /`console`/],
      ['catch helper', 'load().catch(ignoreError)', /\.catch\(<helper>\)/],
    ]
    for (const [name, code, re] of cases) {
      const r = h.call('Write', 'src/new.ts', { content: `export function f() {\n  ${code}\n}\n` })
      assert.match(text(r), re, name)
      assert.match(text(r), /ignoreError, warnError/, `${name}: helpers`)
      assert.ok(text(r).includes(STD.doc), `${name}: document`)
      assert.match(text(r), /not blocked/, name)
      neverBlocks(r)
    }
  } finally {
    h.cleanup()
  }
})

test('warn hook: logged errors and helper calls with a reason pass', () => {
  const h = hookRepo()
  try {
    for (const code of [
      "try { run() } catch (e) { ignoreError('load', e, 'optional') }",
      "load().catch((e) => ignoreError('load', e, 'optional'))",
      "load().catch((e) => { warnError('load', e) })",
      'const consoleLike = 1',
    ]) {
      assert.equal(h.call('Write', 'src/ok.ts', { content: code }), null, code)
    }
  } finally {
    h.cleanup()
  }
})

test('warn hook: only new occurrences count (Edit, MultiEdit, Write over an existing file)', () => {
  const h = hookRepo()
  try {
    const old = 'try { a() } catch {}\nconsole.log(1)\n'
    assert.equal(h.call('Edit', 'src/a.ts', { old_string: old, new_string: `${old}const x = 1\n` }), null, 'existing patterns are not new')
    const r = h.call('MultiEdit', 'src/a.ts', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'x', new_string: 'console.debug(x)' }] })
    assert.match(text(r), /`console`/)
    neverBlocks(r)
    fs.mkdirSync(path.join(h.repo, 'src'), { recursive: true })
    fs.writeFileSync(path.join(h.repo, 'src', 'old.ts'), old)
    assert.equal(h.call('Write', 'src/old.ts', { content: `${old}export const y = 2\n` }), null)
    assert.match(text(h.call('Write', 'src/old.ts', { content: `${old}p.catch(() => undefined)\n` })), /value/)
  } finally {
    h.cleanup()
  }
})

test('warn hook: skips test files, exempt paths, non-code files and an unset or false warn_hook', () => {
  const h = hookRepo()
  const bad = { content: 'try { a() } catch {}\nconsole.log(1)\n' }
  try {
    for (const f of ['src/a.test.ts', 'src/a.spec.tsx', 'tests/a.mjs', 'src/__tests__/a.js', 'cli/print.ts', 'docs/a.md', 'src/a.json']) {
      assert.equal(h.call('Write', f, bad), null, f)
    }
    assert.match(text(h.call('Write', 'src/a.vue', bad)), /Empty catch/)
  } finally {
    h.cleanup()
  }
  for (const cs of [null, { ...STD }, { ...STD, warn_hook: false }]) {
    const off = hookRepo(cs)
    try {
      assert.equal(off.call('Write', 'src/a.ts', bad), null)
    } finally {
      off.cleanup()
    }
  }
})

test('warn hook: runs as a process, exits 0 and never denies; registered beside mockup-first without onFailure', () => {
  const h = hookRepo()
  try {
    const r = runScript('hooks/scripts/codestd/warn.mjs', { tool_name: 'Write', cwd: h.repo, tool_input: { file_path: path.join(h.repo, 'src/a.ts'), content: 'console.log(1)' } }, h.env)
    assert.equal(r.status, 0)
    assert.match(r.out.hookSpecificOutput.additionalContext, /console/)
    neverBlocks(r.out)
  } finally {
    h.cleanup()
  }
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse
  const group = hooks.find((g) => g.hooks.some((x) => x.command.includes('codestd/warn.mjs')))
  assert.equal(group.matcher, 'Write|Edit|MultiEdit')
  const entry = group.hooks.find((x) => x.command.includes('codestd/warn.mjs'))
  assert.equal(entry.onFailure, undefined)
  assert.ok(fs.statSync(path.join(ROOT, 'hooks/scripts/codestd/warn.mjs')).mode & 0o111, 'executable')
})

test('patterns: helper names with regex characters are ignored, not injected', () => {
  assert.equal(CS.patterns(['a(b', 'ok']).length, 5)
  assert.equal(CS.patterns([]).length, 4)
})

// ---- gate kind ----------------------------------------------------------------------

test('quality: code_standards.checks registers the gate kind code-standards with one step per command', () => {
  const S = Q.qualitySettings({ project: { code_standards: { checks: ['npm run lint', 'npm run cycles'] } } })
  const s = S.suites['code-standards']
  assert.equal(s.category, 'gate')
  assert.equal(s.parser, 'steps')
  assert.deepEqual(s.steps, [{ name: 'npm run lint', cmd: 'npm run lint' }, { name: 'npm run cycles', cmd: 'npm run cycles' }])
  assert.equal(Q.qualitySettings({ project: {} }).suites['code-standards'], undefined)
  assert.equal(Q.qualitySettings({ project: { code_standards: { checks: [] } } }).suites['code-standards'], undefined)
  const own = Q.qualitySettings({ project: { code_standards: { checks: ['x'] }, quality: { suites: { 'code-standards': { category: 'gate', command: 'mine' } } } } })
  assert.equal(own.suites['code-standards'].command, 'mine', 'a suite of the same name wins')
})

test('quality: lanekeeper-quality run code-standards runs every step and counts each as a test', () => {
  const fx = repo({ checks: ['true', 'exit 3', 'true'] })
  try {
    git(fx.repo, 'add', '.')
    git(fx.repo, 'commit', '-qm', 'settings')
    const list = bin('lanekeeper-quality', ['list'], fx.env, fx.repo)
    assert.match(list.stdout, /code-standards\s+gate/)
    const r = bin('lanekeeper-quality', ['run', 'code-standards', '--no-xlsx', '--no-slot'], fx.env, fx.repo)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    const idx = JSON.parse(fs.readFileSync(path.join(fx.repo, 'docs/test-results/index.json'), 'utf8'))
    const head = JSON.parse(fs.readFileSync(path.join(fx.repo, 'docs/test-results', idx.entries[0].json), 'utf8'))
    assert.deepEqual([head.kind, head.category, head.counts.total, head.counts.passed, head.counts.failed], ['code-standards', 'gate', 3, 2, 1])
  } finally {
    fx.cleanup()
  }
})
