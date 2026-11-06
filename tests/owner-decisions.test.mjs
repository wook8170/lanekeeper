// Owner decisions typed as /lanekeeper:approve: accepting a weakened result, bypassPermissions
// for the automatic resume, clearing an old gate lock. Each must be reachable by a person
// typing the command, and unreachable for an agent in every permission mode.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeFixture } from './safety-fixture.mjs'
import { handleApprove, parseAccept } from '../hooks/scripts/safety/approve.mjs'
import { runHook } from '../hooks/scripts/safety/pretool.mjs'
import { checkStamp } from '../hooks/scripts/safety/grant.mjs'
import { resolveConfig } from '../lib/config.mjs'
import { resumeMode } from '../lib/retry.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']
const HOUR = 3600000
let f, personal, accepted, lock

before(() => {
  f = makeFixture()
  personal = path.join(f.env.LANEKEEPER_HOME, 'personal.json')
  accepted = path.join(f.repo, 'docs/test-results/accepted.json')
  lock = path.join(f.state, 'gate.lock')
})
after(() => f.cleanup())
beforeEach(() => {
  f.clearGrant()
  f.clearProjectConfig()
  for (const p of [personal, accepted, lock]) fs.rmSync(p, { force: true })
})

const approve = (args, cwd = f.repo) => handleApprove({ hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'lanekeeper:approve', command_args: args, cwd, session_id: 's1' }, f.env)
const bin = (name, args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', name), ...args], { cwd: f.repo, env: f.env, encoding: 'utf8' })
const shell = (cmd) => spawnSync('sh', ['-c', cmd], { cwd: f.repo, env: { ...f.env, PATH: `${path.join(ROOT, 'bin')}${path.delimiter}${f.env.PATH}` }, encoding: 'utf8' })
const record = () => assert.equal(bin('lanekeeper-quality', ['record', 'unit', '--verdict', 'passed', '--total', '1', '--passed', '1', '--no-xlsx']).status, 0)
const readAccepted = () => JSON.parse(fs.readFileSync(accepted, 'utf8')).accepted
const oldLock = () => {
  fs.writeFileSync(lock, '{}')
  const t = new Date(Date.now() - 24 * HOUR)
  fs.utimesSync(lock, t, t)
}
// The real hook entry, as Claude Code calls it: returns the decision it prints.
function hook(tool, input, mode, extra = {}) {
  const out = runHook(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: f.repo, permission_mode: mode, tool_name: tool, tool_input: input, ...extra }), f.env)
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'allow'
}

// ---- accept-quality ---------------------------------------------------------
test('parseAccept: the reason runs to the end and may be quoted', () => {
  assert.deepEqual(parseAccept(' unit --reason two tests moved to e2e'), { kind: 'unit', reason: 'two tests moved to e2e' })
  assert.deepEqual(parseAccept('unit --reason "two tests moved"'), { kind: 'unit', reason: 'two tests moved' })
  assert.deepEqual(parseAccept("unit --reason='x y'"), { kind: 'unit', reason: 'x y' })
  for (const bad of ['', 'unit', 'unit --reason', 'unit --reason ""', '--reason x']) assert.equal(parseAccept(bad), null, bad)
})
test('accept-quality: typed by a person, it records the newest result of the kind', () => {
  record()
  const r = approve('accept-quality unit --reason "two tests moved"')
  assert.match(r.hookSpecificOutput.additionalContext, /accepted unit/)
  const [a] = readAccepted()
  assert.deepEqual([a.kind, a.commit.slice(0, 9), a.reason], ['unit', f.sha('HEAD').slice(0, 9), 'two tests moved'])
})
test('accept-quality: refused without a reason or a result, and nothing is written', () => {
  record()
  assert.equal(approve('accept-quality unit').decision, 'block')
  assert.match(approve('accept-quality unit').reason, /--reason/)
  assert.equal(approve('accept-quality e2e --reason x').decision, 'block')
  assert.equal(fs.existsSync(accepted), false)
})
test('accept-quality, retry-bypass and clear-gate-lock leave an active merge grant as it is', () => {
  record()
  approve('merge-main')
  const before = f.readGrant()
  approve('accept-quality unit --reason x')
  approve('retry-bypass')
  approve('clear-gate-lock')
  assert.deepEqual(f.readGrant(), before)
})

// ---- retry-bypass -----------------------------------------------------------
test('retry-bypass: typed by a person, the resume runs in bypassPermissions', () => {
  const r = approve('retry-bypass')
  assert.match(r.hookSpecificOutput.additionalContext, /without asking/)
  assert.deepEqual(resumeMode(resolveConfig({ projectDir: f.repo, env: f.env })), { mode: 'bypassPermissions', downgraded: false })
  assert.equal(bin('lanekeeper-retry', ['mode', 'default']).status, 0)
  assert.deepEqual(resumeMode(resolveConfig({ projectDir: f.repo, env: f.env })), { mode: 'default', downgraded: false })
})
test('retry-bypass: a repository cannot supply the acknowledgement through its project settings', () => {
  const file = path.join(f.repo, '.lanekeeper', 'config.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ version: 1, personal: { auto_retry: { permission_mode: 'bypassPermissions', bypass_ack: true } } }))
  assert.deepEqual(resumeMode(resolveConfig({ projectDir: f.repo, env: f.env })), { mode: 'default', downgraded: true })
})
test('retry-bypass: broken settings block it', () => {
  f.projectConfig({ git: { owner_grant_ttl_min: 'soon' } })
  assert.equal(approve('retry-bypass').decision, 'block')
  assert.equal(fs.existsSync(personal), false)
})

// ---- clear-gate-lock --------------------------------------------------------
test('clear-gate-lock: removes an old lock, refuses a recent one, reports a missing one', () => {
  assert.match(approve('clear-gate-lock').hookSpecificOutput.additionalContext, /no gate\.lock/)
  fs.writeFileSync(lock, '{}')
  assert.equal(approve('clear-gate-lock').decision, 'block')
  assert.equal(fs.existsSync(lock), true)
  oldLock()
  assert.match(approve('clear-gate-lock').hookSpecificOutput.additionalContext, /old gate\.lock/)
  assert.equal(fs.existsSync(lock), false)
})
test('usage names the owner decisions', () => {
  assert.match(approve('deploy').reason, /accept-quality.*retry-bypass.*clear-gate-lock/)
})

// ---- the commands an agent can reach ----------------------------------------
test('the commands refuse: flags an agent can add do not turn the decision on', () => {
  for (const args of [['mode', 'bypassPermissions'], ['mode', 'bypassPermissions', '--i-understand']]) {
    const r = bin('lanekeeper-retry', args)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /\/lanekeeper:approve retry-bypass/)
    assert.equal(fs.existsSync(personal), false)
  }
  oldLock()
  const reap = bin('lanekeeper-reap', ['--gate-lock'])
  assert.equal(reap.status, 4)
  assert.match(reap.stderr, /\/lanekeeper:approve clear-gate-lock/)
  assert.equal(fs.existsSync(lock), true)
  record()
  const acc = bin('lanekeeper-quality', ['accept', 'unit', '--reason', 'x'])
  assert.equal(acc.status, 4)
  assert.match(acc.stderr, /\/lanekeeper:approve accept-quality/)
  assert.equal(fs.existsSync(accepted), false)
})
test('lanekeeper-reap without the flag still reports the old lock and points at the slash command', () => {
  oldLock()
  const r = bin('lanekeeper-reap', [])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /\/lanekeeper:approve clear-gate-lock/)
  assert.equal(fs.existsSync(lock), true)
})
test('chained commands get no further than alone', () => {
  oldLock()
  assert.equal(shell('true && lanekeeper-reap --gate-lock').status, 4)
  assert.equal(fs.existsSync(lock), true)
  shell('lanekeeper-retry mode plan; lanekeeper-retry mode bypassPermissions --i-understand')
  assert.deepEqual(resumeMode(resolveConfig({ projectDir: f.repo, env: f.env })), { mode: 'plan', downgraded: false })
})

// ---- every permission mode, main session and subagent ------------------------
test('every mode: the model is denied the skill, whatever the arguments', () => {
  for (const mode of MODES) {
    for (const skill of ['lanekeeper:approve', '/lanekeeper:approve', 'approve']) {
      for (const args of ['accept-quality unit --reason x', 'retry-bypass', 'clear-gate-lock']) {
        assert.equal(hook('Skill', { skill, args }, mode), 'deny', `${mode} ${skill} ${args}`)
        assert.equal(hook('Skill', { skill, args }, mode, { agent_id: 'a1', agent_type: 'general-purpose' }), 'deny')
      }
    }
  }
})
test('every mode: a headless claude cannot be started to type the command', () => {
  const calls = ['claude -p "/lanekeeper:approve retry-bypass"', 'true && claude -p "/lanekeeper:approve merge-main"', 'echo "/lanekeeper:approve clear-gate-lock" | claude -p', 'sh -c \'/usr/local/bin/claude -p "/lanekeeper:approve revoke"\'']
  for (const mode of MODES) for (const command of calls) assert.equal(hook('Bash', { command }, mode), 'deny', `${mode} ${command}`)
  assert.equal(hook('Bash', { command: 'rg lanekeeper:approve skills' }, 'default'), 'allow')
  assert.equal(hook('Bash', { command: 'claude plugin list' }, 'default'), 'allow')
})
test('every mode: writing the acknowledgement or the acceptance is denied, never left to a dialog', () => {
  const calls = [
    ['Write', { file_path: personal, content: '{"auto_retry":{"bypass_ack":true}}' }],
    ['Edit', { file_path: personal, old_string: 'false', new_string: '"bypass_ack": true' }],
    ['Write', { file_path: accepted, content: '{}' }],
    ['Edit', { file_path: accepted, old_string: 'a', new_string: 'b' }],
    ['Bash', { command: `echo '{}' > ${personal}` }],
    ['Bash', { command: `true && cp /tmp/x ${personal}` }],
    ['Bash', { command: 'cp /tmp/x ~/.lanekeeper/personal.json; true' }],
    ['Bash', { command: `cd ${path.dirname(personal)} && tee personal.json < /tmp/x` }],
    ['Bash', { command: `python3 -c "open('.lanekeeper/personal.json','w')"` }],
    ['Bash', { command: 'echo {} > docs/test-results/accepted.json' }],
    ['Bash', { command: 'true && cp /tmp/x docs/test-results/accepted.json' }],
    ['Bash', { command: 'cd docs/test-results && tee accepted.json < /tmp/x' }],
    ['Bash', { command: `node -e "fs.writeFileSync('docs/test-results/accepted.json','{}')"` }],
    ['Bash', { command: `rm ${lock}` }],
    ['Bash', { command: 'true && rm .git/lanekeeper/gate.lock' }],
  ]
  for (const mode of MODES) {
    for (const [tool, input] of calls) {
      assert.equal(hook(tool, input, mode), 'deny', `${mode} ${tool} ${JSON.stringify(input)}`)
      assert.equal(hook(tool, input, mode, { agent_id: 'a1', agent_type: 'general-purpose' }), 'deny')
    }
  }
})
test('reading stays allowed, other personal settings still ask, results_root is followed', () => {
  assert.equal(hook('Bash', { command: `cat ${personal}` }, 'default'), 'allow')
  assert.equal(hook('Bash', { command: 'cat docs/test-results/accepted.json' }, 'default'), 'allow')
  assert.equal(hook('Bash', { command: 'git status docs/test-results/accepted.json' }, 'default'), 'allow')
  assert.equal(hook('Write', { file_path: personal, content: '{"terse":true}' }, 'default'), 'ask')
  f.projectConfig({ quality: { results_root: 'qa/results' } })
  assert.equal(hook('Write', { file_path: path.join(f.repo, 'qa/results/accepted.json'), content: '{}' }, 'default'), 'deny')
  assert.equal(hook('Bash', { command: 'echo {} > qa/results/accepted.json' }, 'default'), 'deny')
  assert.equal(hook('Write', { file_path: accepted, content: '{}' }, 'default'), 'allow')
})

// ---- gate stamp written before 0.2.0 ------------------------------------------
test('a wb-gate-pass stamp still counts for its commit, and only under the default name', () => {
  const dir = fs.mkdtempSync(path.join(f.base, 'stamp-'))
  fs.writeFileSync(path.join(dir, 'wb-gate-pass.json'), JSON.stringify({ head: 'aaa' }))
  assert.equal(checkStamp(dir, 'lanekeeper-gate-pass', 'aaa').ok, true)
  assert.equal(checkStamp(dir, undefined, 'aaa').ok, true)
  assert.equal(checkStamp(dir, 'lanekeeper-gate-pass', 'bbb').why, 'head')
  assert.equal(checkStamp(dir, 'custom', 'aaa').why, 'missing')
  fs.writeFileSync(path.join(dir, 'lanekeeper-gate-pass.json'), JSON.stringify({ head: 'bbb' }))
  assert.equal(checkStamp(dir, 'lanekeeper-gate-pass', 'bbb').ok, true)
  assert.equal(checkStamp(dir, 'lanekeeper-gate-pass', 'aaa').why, 'head', 'the new stamp wins')
})
test('end to end: an approved merge goes through on a stamp written under the old name', () => {
  f.projectConfig({ gate: { command: 'npm test' } })
  approve('merge-main')
  assert.deepEqual(f.judge('git merge lanekeeper/t/int', { cwd: f.repo }).codes, ['stamp.missing'])
  const old = path.join(f.state, 'wb-gate-pass.json')
  fs.writeFileSync(old, JSON.stringify({ head: f.sha('lanekeeper/t/int') }))
  try {
    assert.equal(f.judge('git merge lanekeeper/t/int', { cwd: f.repo }).decision, 'allow')
  } finally {
    fs.rmSync(old, { force: true })
  }
})
