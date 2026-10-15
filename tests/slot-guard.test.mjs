// slot-guard (PreToolUse Bash): heavy and browser commands outside wb-slot get
// a note (warn) or a block (deny); wrapped or light commands pass.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { judgeSlots, runHook } from '../hooks/scripts/slots/slot-guard.mjs'
import { patternGroups } from '../lib/heavy.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sandbox(machine = {}, project = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-guard-')))
  const home = path.join(base, 'home')
  fs.mkdirSync(path.join(home, '.wb'), { recursive: true })
  fs.writeFileSync(path.join(home, '.wb', 'machine.json'), JSON.stringify(machine))
  fs.mkdirSync(path.join(base, '.wb'))
  fs.writeFileSync(path.join(base, '.wb', 'config.json'), JSON.stringify(project))
  const env = { PATH: process.env.PATH, HOME: home, WB_HOME: path.join(home, '.wb'), WB_PROJECT_DIR: base, LANG: 'en_US.UTF-8' }
  const judge = (command) => judgeSlots({ tool_name: 'Bash', tool_input: { command }, cwd: base }, env)
  return { base, env, judge, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) }
}

const HEAVY = [
  ['pnpm -r test', ['heavy']],
  ['npm test', ['heavy']],
  ['pnpm test', ['heavy']],
  ['yarn workspaces foreach -A run test', ['heavy']],
  ['npx vitest run', ['heavy']],
  ['pytest -q', ['heavy']],
  ['go test ./...', ['heavy']],
  ['cargo test', ['heavy']],
  ['pnpm -r typecheck', ['heavy']],
  ['npx tsc -b', ['heavy']],
  ['pnpm --filter web build', ['heavy']],
  ['npm run build', ['heavy']],
  ['docker build .', ['heavy']],
  ['pnpm install', ['heavy']],
  ['npm ci', ['heavy']],
  ['yarn', ['heavy']],
  ['pip install -r requirements.txt', ['heavy']],
  ['codegraph init .', ['heavy']],
  ['npx playwright test', ['browser', 'heavy']],
  ['pnpm test:e2e', ['heavy']],
  ['google-chrome --headless=new --screenshot https://example.com', ['browser']],
  ['"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9222', ['browser']],
  ['cd web && FOO=1 pnpm -r test | tee log', ['heavy']],
  ['bash -c "pnpm install"', ['heavy']],
]

const LIGHT = [
  'npx vitest run src/a.test.ts',
  'node --test tests/a.test.mjs',
  'pytest tests/test_a.py',
  'git status',
  'ls -la',
  'pnpm add left-pad',
  'npm run lint',
  'echo "pnpm -r test"',
  'wb-slot --kind heavy -- pnpm -r test',
  'wb-slot --kind heavy,browser -- npx playwright test',
  "wb-slot --kind heavy -- sh -c 'cd web && pnpm install'",
  'wb-slot status',
]

test('heavy and browser commands outside a slot are found, with the kinds they need', () => {
  const s = sandbox()
  for (const [cmd, kinds] of HEAVY) {
    const r = s.judge(cmd)
    assert.ok(r, `expected a hit: ${cmd}`)
    assert.deepEqual(r.kinds, kinds, cmd)
  }
  s.cleanup()
})

test('light commands, single-file tests and wrapped commands pass', () => {
  const s = sandbox()
  for (const cmd of LIGHT) assert.equal(s.judge(cmd), null, cmd)
  s.cleanup()
})

test('a wrapper holding the wrong kind is still reported', () => {
  const s = sandbox()
  const r = s.judge('wb-slot --kind heavy -- npx playwright test')
  assert.deepEqual(r.hits[0].missing, ['browser'])
  s.cleanup()
})

test('warn (default): no decision, a note with the wrapped command for Claude', () => {
  const s = sandbox()
  const out = JSON.parse(runHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'pnpm -r test' }, cwd: s.base }), s.env))
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined)
  assert.match(out.hookSpecificOutput.additionalContext, /wb-slot --kind heavy -- sh -c 'pnpm -r test'/)
  s.cleanup()
})

test('deny: blocked with the three-part message, in both languages', () => {
  const s = sandbox({ slots: { guard: 'deny' } })
  for (const [lang, re] of [['en_US.UTF-8', /Blocked: .*\nHow to fix: .*wb-slot.*\nWhere to ask: /], ['ko_KR.UTF-8', /막았습니다: .*\n이렇게 고치세요: .*wb-slot.*\n물어볼 곳: /]]) {
    const out = JSON.parse(runHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm ci' }, cwd: s.base }), { ...s.env, LANG: lang }))
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(out.hookSpecificOutput.permissionDecisionReason, re)
  }
  s.cleanup()
})

test('project patterns add commands; machine pattern lists choose groups', () => {
  const s = sandbox({ slots: { heavy: { patterns: ['install'] } } }, { slots: { heavy: ['^make all$'] } })
  assert.deepEqual(s.judge('make all').kinds, ['heavy'])
  assert.equal(s.judge('pnpm -r test'), null, 'full-test group not selected on this machine')
  assert.ok(s.judge('pnpm install'))
  s.cleanup()
})

test('fails open: broken input or other tools produce no output', () => {
  assert.equal(runHook('{not json'), '')
  assert.equal(runHook(JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x' } })), '')
})

test('every pattern compiles and every default group name exists', () => {
  const groups = patternGroups()
  for (const [name, list] of Object.entries(groups)) for (const src of list) assert.doesNotThrow(() => new RegExp(src, 'i'), `${name}: ${src}`)
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'defaults', 'machine.json'), 'utf8'))
  for (const kind of ['heavy', 'browser']) for (const g of m.slots[kind].patterns) assert.ok(groups[g], g)
})

test('hook process prints the note and exits 0', () => {
  const s = sandbox()
  const out = execFileSync(path.join(ROOT, 'hooks', 'scripts', 'slots', 'slot-guard.mjs'), { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'pnpm install' }, cwd: s.base }), env: s.env, encoding: 'utf8' })
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /wb-slot/)
  s.cleanup()
})

test('hooks.json wires the slot guard; worktree hooks are opt-in (not in hooks.json); bins are executable', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks
  assert.ok(h.PreToolUse.some((e) => e.matcher === 'Bash' && e.hooks.some((x) => x.command.includes('slots/slot-guard.mjs'))))
  assert.equal(h.WorktreeCreate, undefined)
  assert.equal(h.WorktreeRemove, undefined)
  assert.ok(h.SessionStart.some((e) => e.hooks.some((x) => x.command.includes('worktree/session-sync.mjs'))))
  for (const b of ['wb-slot', 'wb-port', 'wb-worktree', 'wb-reap']) assert.ok(fs.statSync(path.join(ROOT, 'bin', b)).mode & 0o111, b)
})

test('messages used by the slot, port, worktree and reap commands exist in both locales', () => {
  const keys = new Set(['safety.slot.unwrapped.why', 'safety.slot.unwrapped.fix'])
  const files = ['bin/wb-slot', 'bin/wb-port', 'bin/wb-worktree', 'bin/wb-reap', 'bin/wb-config', 'hooks/scripts/slots/slot-guard.mjs', 'hooks/scripts/worktree/session-sync.mjs'].map((f) => path.join(ROOT, f))
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bt\('([a-z][a-z_.-]+)'/g)) keys.add(m[1])
  for (const m of fs.readFileSync(path.join(ROOT, 'lib', 'worktree.mjs'), 'utf8').matchAll(/WbError\('([a-z_.]+)'/g)) for (const p of ['why', 'fix']) keys.add(`${m[1]}.${p}`)
  for (const m of fs.readFileSync(path.join(ROOT, 'bin', 'wb-worktree'), 'utf8').matchAll(/WbError\('([a-z_.]+)'/g)) for (const p of ['why', 'fix']) keys.add(`${m[1]}.${p}`)
  for (const k of ['wthook.synced_on', 'wthook.synced_off', 'wthook.conflict', 'init.worktreeHook', 'init.worktreeHookKept']) keys.add(k)
  for (const c of ['no-lane', 'no-lease', 'unknown-name', 'problem.overlap', 'problem.too-high', 'problem.protected']) keys.add(`port.${c}`)
  for (const lang of ['ko', 'en']) {
    const msgs = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${lang}.json`), 'utf8'))
    for (const k of keys) assert.ok(msgs[k], `${lang}: ${k}`)
  }
})
