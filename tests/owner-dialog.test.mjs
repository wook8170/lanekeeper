// The confirmation dialog for accept-quality and clear-gate-lock. The hook answers `ask` only when a
// person is sure to see the dialog, and the commands refuse without the ticket that dialog carries.
// What Claude Code does with `ask` cannot be measured here: it was checked in real sessions (see
// the comment at the top of hooks/scripts/safety/owner-dialog.mjs). These tests fix the rules on top.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeFixture, git } from './safety-fixture.mjs'
import { handleApprove } from '../hooks/scripts/safety/approve.mjs'
import { parseOwnerCall } from '../hooks/scripts/safety/owner-dialog.mjs'
import { runHook } from '../hooks/scripts/safety/pretool.mjs'
import { TICKET_TTL_MS, consumeTicket, issueTicket } from '../lib/owner-decisions.mjs'
import { doctor } from '../lib/init.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']
const ASKING = ['default', 'acceptEdits', 'auto']
const SUB = { agent_id: 'a1', agent_type: 'general-purpose' }
const REAP = 'lanekeeper-reap --gate-lock'
const ACCEPT = 'lanekeeper-quality accept unit --reason "two tests moved"'
let f, env, accepted, lock, ticket, log, personal

before(() => {
  f = makeFixture()
  env = { ...f.env, CLAUDE_CODE_ENTRYPOINT: 'cli' }
  accepted = path.join(f.repo, 'docs/test-results/accepted.json')
  lock = path.join(f.state, 'gate.lock')
  ticket = path.join(f.state, 'owner-ticket.json')
  log = path.join(f.state, 'owner-decisions.jsonl')
  personal = path.join(f.env.LANEKEEPER_HOME, 'personal.json')
  record()
})
after(() => f.cleanup())
beforeEach(() => {
  f.clearGrant()
  f.clearProjectConfig()
  for (const p of [accepted, lock, ticket, log, personal, path.join(f.home, '.claude/settings.json'), path.join(f.repo, '.claude/settings.json'), path.join(f.repo, '.claude/settings.local.json')]) fs.rmSync(p, { force: true })
  oldLock()
})

function record(total = 3) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/lanekeeper-quality'), 'record', 'unit', '--verdict', 'passed', '--total', String(total), '--passed', String(total), '--no-xlsx'], { cwd: f.repo, env: f.env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
}
function oldLock(body = '{"pid":4242,"at":"2026-01-01T00:00:00Z","command":"npm test"}') {
  fs.writeFileSync(lock, body)
  const t = new Date(Date.now() - 24 * 3600000)
  fs.utimesSync(lock, t, t)
}
function hook(command, mode = 'default', extra = {}, e = env, tool = 'Bash', input = { command }) {
  const out = runHook(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: f.repo, permission_mode: mode, tool_name: tool, tool_input: input, ...extra }), e)
  return out ? JSON.parse(out).hookSpecificOutput : { permissionDecision: 'allow' }
}
const run = (command, cwd = f.repo) => spawnSync('sh', ['-c', command], { cwd, env: { ...f.env, PATH: `${path.join(ROOT, 'bin')}${path.delimiter}${f.env.PATH}` }, encoding: 'utf8' })
const acceptedList = () => (fs.existsSync(accepted) ? JSON.parse(fs.readFileSync(accepted, 'utf8')).accepted : [])
const logged = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const nonceOf = (out) => /--dialog-ticket (\S+)$/.exec(out.updatedInput.command)[1]
const swap = (cmd, nonce) => cmd.replace(/--dialog-ticket \S+$/, `--dialog-ticket ${nonce}`)

// ---- the rules on modes and sessions --------------------------------------------------------
test('6 modes x main session: only default, acceptEdits and auto raise the dialog', () => {
  for (const mode of MODES) {
    for (const cmd of [REAP, ACCEPT]) {
      const out = hook(cmd, mode)
      if (ASKING.includes(mode)) {
        assert.equal(out.permissionDecision, 'ask', `${mode} ${cmd}`)
        assert.match(out.updatedInput.command, /--dialog-ticket [0-9a-f]{32}$/)
      } else {
        assert.equal(out.permissionDecision, 'deny', `${mode} ${cmd}`)
        assert.equal(out.updatedInput, undefined)
        assert.match(out.permissionDecisionReason, /\/lanekeeper:approve/)
      }
    }
  }
})
test('6 modes x subagent: always refused, and the message sends it to the main session', () => {
  for (const mode of MODES) {
    for (const cmd of [REAP, ACCEPT]) {
      const out = hook(cmd, mode, SUB)
      assert.equal(out.permissionDecision, 'deny', `${mode} ${cmd}`)
      assert.match(out.permissionDecisionReason, /main session/)
      assert.equal(fs.existsSync(ticket), false, 'no ticket is issued')
    }
  }
})
test('-p, the SDK and an unknown permission mode are refused without a ticket', () => {
  for (const entry of ['sdk-cli', 'sdk-ts', undefined]) {
    const { CLAUDE_CODE_ENTRYPOINT: _, ...rest } = env
    assert.equal(hook(REAP, 'default', {}, entry ? { ...rest, CLAUDE_CODE_ENTRYPOINT: entry } : rest).permissionDecision, 'deny', String(entry))
  }
  assert.equal(hook(REAP, null).permissionDecision, 'deny')
  assert.equal(hook(REAP, 'somethingNew').permissionDecision, 'deny')
  assert.equal(fs.existsSync(ticket), false)
})

// ---- only the plain line -----------------------------------------------------------------------
const VARIANTS = [
  'true && lanekeeper-reap --gate-lock',
  'lanekeeper-reap --gate-lock; true',
  'lanekeeper-reap --gate-lock | cat',
  'lanekeeper-reap --gate-lock\ntrue',
  'lanekeeper-reap --gate-lock > /tmp/x',
  'lanekeeper-reap --gate-lock # note',
  "sh -c 'lanekeeper-reap --gate-lock'",
  'echo $(lanekeeper-reap --gate-lock)',
  'env A=1 lanekeeper-reap --gate-lock',
  'A=1 lanekeeper-reap --gate-lock',
  '/somewhere/bin/lanekeeper-reap --gate-lock',
  'node bin/lanekeeper-reap --gate-lock',
  'script -q /dev/null lanekeeper-reap --gate-lock',
  'lanekeeper-reap --gate-lock --apply',
  'lanekeeper-reap --gate-lock=1',
  'lanekeeper-reap --gate-lock --dialog-ticket 0123',
  'lanekeeper-quality accept unit',
  'lanekeeper-quality accept unit --reason two words',
  'lanekeeper-quality accept unit --reason "x" --project /other',
  'lanekeeper-quality accept unit --reason "x" --dialog-ticket 0123',
  'lanekeeper-quality accept unit --reason "$(id)"',
  'lanekeeper-quality accept unit --reason "`id`"',
  'lanekeeper-quality accept unit --reason "$HOME"',
  'lanekeeper-quality accept unit --reason "x" && rm -f a.txt',
  'lanekeeper-quality accept unit other --reason "x"',
  'lanekeeper-quality accept unit --reason "line one\nline two"',
  'lanekeeper-quality accept unit --reason "hidden\u001b[2Jtext"',
  'lanekeeper-quality accept unit --reason "shown‮desrever"',
  `lanekeeper-quality accept unit --reason "${'x'.repeat(501)}"`,
]
test('chained and changed commands are refused in every mode, and no ticket is issued', () => {
  for (const command of VARIANTS) {
    for (const mode of MODES) {
      const out = hook(command, mode)
      assert.equal(out.permissionDecision, 'deny', `${mode}: ${command}`)
      assert.equal(out.updatedInput, undefined)
    }
    assert.match(hook(command, 'default').permissionDecisionReason, /\/lanekeeper:approve/, command)
  }
  assert.equal(fs.existsSync(ticket), false)
})
test('the reason may be quoted three ways, and the shown command quotes it again', () => {
  assert.deepEqual(parseOwnerCall('lanekeeper-quality accept unit --reason moved'), { action: 'accept-quality', kind: 'unit', reason: 'moved' })
  assert.deepEqual(parseOwnerCall("lanekeeper-quality accept unit --reason='it moved'"), { action: 'accept-quality', kind: 'unit', reason: 'it moved' })
  assert.deepEqual(parseOwnerCall('lanekeeper-quality accept unit --reason "it\'s moved"'), { action: 'accept-quality', kind: 'unit', reason: "it's moved" })
  const out = hook(`lanekeeper-quality accept unit --reason "it's moved"`)
  assert.equal(out.permissionDecision, 'ask')
  assert.equal(run(out.updatedInput.command).status, 0)
  assert.equal(acceptedList()[0].reason, "it's moved")
})
test('other uses of these commands are not touched', () => {
  for (const command of ['lanekeeper-reap', 'lanekeeper-reap --apply', 'lanekeeper-quality list', 'lanekeeper-quality status --json', 'rg lanekeeper-reap --gate-lock docs', 'git log --grep "lanekeeper-quality accept"', 'echo lanekeeper-quality accept unit']) {
    assert.equal(hook(command).permissionDecision, 'allow', command)
  }
  assert.equal(fs.existsSync(ticket), false)
})

// ---- what the dialog says -----------------------------------------------------------------------
test('the dialog for accept-quality names the kind, commit, result, weakening and reason', () => {
  const r = hook('lanekeeper-quality accept unit --reason "two tests moved"').permissionDecisionReason
  for (const part of ['Accept the weakened unit test result?', f.sha('HEAD').slice(0, 9), '3/3', 'two tests moved', 'Decline changes nothing']) assert.ok(r.includes(part), `${part} in ${r}`)
  assert.doesNotMatch(r, /--dialog-ticket/)
})
test('the dialog shows a real weakening of the result', () => {
  git(f.repo, 'commit', '-q', '--allow-empty', '-m', 'next')
  record(1)
  try {
    assert.match(hook(ACCEPT).permissionDecisionReason, /3.1/)
  } finally {
    git(f.repo, 'reset', '-q', '--hard', 'HEAD~1')
    fs.rmSync(path.join(f.repo, 'docs/test-results'), { recursive: true, force: true })
    record()
  }
})
test('the dialog for the gate lock names its age and owner, and strips terminal controls from them', () => {
  oldLock('{"pid":4242,"command":"npm \\u001b[2J test"}')
  const r = hook(REAP).permissionDecisionReason
  assert.match(r, /Remove the old gate lock\?/)
  assert.match(r, /4242/)
  assert.match(r, /npm\s+\[2J test/)
  assert.doesNotMatch(r, /\u001b/)
})
test('nothing to decide raises no dialog', () => {
  assert.match(hook('lanekeeper-quality accept e2e --reason x').permissionDecisionReason, /no e2e result/)
  fs.rmSync(lock)
  assert.equal(hook(REAP).permissionDecision, 'deny')
  fs.writeFileSync(lock, '{}')
  const out = hook(REAP)
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /still be running/)
  assert.equal(fs.existsSync(ticket), false)
})
test('broken settings refuse before a dialog', () => {
  f.projectConfig({ git: { owner_grant_ttl_min: 'soon' } })
  assert.equal(hook(REAP).permissionDecision, 'deny')
  assert.equal(fs.existsSync(ticket), false)
})

// ---- allowed, declined, and the record ---------------------------------------------------------
test('allowed: accept-quality runs the shown command and records the dialog route', () => {
  const out = hook(ACCEPT)
  const r = run(out.updatedInput.command)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /accepted unit/)
  const [a] = acceptedList()
  assert.deepEqual([a.kind, a.reason, a.via, a.commit], ['unit', 'two tests moved', 'dialog', f.sha('HEAD')])
  assert.deepEqual(logged().map((l) => [l.action, l.via, l.kind]), [['accept-quality', 'dialog', 'unit']])
  assert.equal(fs.existsSync(ticket), false)
})
test('allowed: clear-gate-lock removes the lock and records the dialog route', () => {
  const r = run(hook(REAP).updatedInput.command)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.existsSync(lock), false)
  assert.deepEqual(logged().map((l) => [l.action, l.via]), [['clear-gate-lock', 'dialog']])
})
test('allowed from a linked worktree: the ticket and the lock live in the shared state folder', () => {
  const out = runHook(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: f.wt.feat, permission_mode: 'default', tool_name: 'Bash', tool_input: { command: REAP } }), env)
  assert.equal(run(JSON.parse(out).hookSpecificOutput.updatedInput.command, f.wt.feat).status, 0)
  assert.equal(fs.existsSync(lock), false)
})
test('declined: the command never runs, so nothing changes and the stored ticket is useless', () => {
  const out = hook(ACCEPT)
  const nonce = nonceOf(out)
  const stored = fs.readFileSync(ticket, 'utf8')
  assert.equal(stored.includes(nonce), false, 'only the hash is stored')
  assert.equal(acceptedList().length, 0)
  assert.equal(fs.existsSync(log), false)
  const hash = JSON.parse(stored).nonceHash
  assert.equal(run(`lanekeeper-quality accept unit --reason="two tests moved" --dialog-ticket ${hash}`).status, 4, 'the stored hash is not a ticket')
  assert.equal(acceptedList().length, 0)
})
test('the slash command records its route for all three decisions', () => {
  const slash = (args) => handleApprove({ hook_event_name: 'UserPromptExpansion', command_name: 'lanekeeper:approve', command_args: args, cwd: f.repo }, f.env)
  slash('accept-quality unit --reason x')
  slash('clear-gate-lock')
  slash('retry-bypass')
  assert.equal(acceptedList()[0].via, 'slash')
  assert.deepEqual(logged().map((l) => [l.action, l.via]), [['accept-quality', 'slash'], ['clear-gate-lock', 'slash'], ['retry-bypass', 'slash']])
})
test('an active merge grant stays as it is through the dialog route', () => {
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  const before = f.readGrant()
  run(hook(REAP).updatedInput.command)
  run(hook(ACCEPT).updatedInput.command)
  assert.deepEqual(f.readGrant(), before)
})

// ---- tickets --------------------------------------------------------------------------------------
test('a ticket works once', () => {
  const cmd = hook(REAP).updatedInput.command
  assert.equal(run(cmd).status, 0)
  oldLock()
  const again = run(cmd)
  assert.equal(again.status, 4)
  assert.match(again.stderr, /no valid ticket/)
  assert.equal(fs.existsSync(lock), true)
  const acc = hook(ACCEPT).updatedInput.command
  assert.equal(run(acc).status, 0)
  assert.equal(run(acc).status, 4)
  assert.equal(acceptedList().length, 1)
})
test('a raised dialog cancels the ticket of an earlier one', () => {
  const first = hook(REAP).updatedInput.command
  const second = hook(REAP).updatedInput.command
  assert.equal(run(first).status, 4)
  assert.equal(fs.existsSync(lock), true)
  assert.equal(run(second).status, 0, 'a wrong ticket does not cancel the open dialog')
})
test('no ticket or a made-up one: refused, whatever the agent adds', () => {
  for (const cmd of [REAP, `${REAP} --dialog-ticket`, `${REAP} --dialog-ticket 0123`, ACCEPT, `${ACCEPT} --dialog-ticket 0123`]) {
    assert.equal(run(cmd).status, 4, cmd)
  }
  assert.equal(fs.existsSync(lock), true)
  assert.equal(acceptedList().length, 0)
})
test('a ticket issued for one decision does not open the other', () => {
  const out = hook(REAP)
  const r = run(`lanekeeper-quality accept unit --reason=x --dialog-ticket ${nonceOf(out)}`)
  assert.equal(r.status, 4)
  assert.match(r.stderr, /has changed/)
  assert.equal(acceptedList().length, 0)
  assert.equal(fs.existsSync(ticket), false, 'the right nonce is used up')
})
test('tampering with the approved content is refused and uses up the ticket', () => {
  const tampered = [
    (c) => c.replace("--reason='two tests moved'", "--reason='something else'"),
    (c) => c.replace('accept unit', 'accept e2e'),
  ]
  for (const change of tampered) {
    const cmd = hook(ACCEPT).updatedInput.command
    assert.notEqual(change(cmd), cmd)
    assert.equal(run(change(cmd)).status, 4, change(cmd))
    assert.equal(acceptedList().length, 0)
    assert.equal(run(cmd).status, 4, 'it cannot be used again after that')
  }
  const cmd = hook(ACCEPT).updatedInput.command
  assert.equal(run(cmd.replace("--reason='two tests moved'", "--reason='two tests moved' extra")).status, 4)
  assert.equal(acceptedList().length, 0)
})
test('a newer result after the dialog was raised is not accepted under the old answer', () => {
  const cmd = hook(ACCEPT).updatedInput.command
  fs.rmSync(path.join(f.repo, 'docs/test-results/INDEX.md'), { force: true })
  record()
  const r = run(cmd)
  assert.equal(r.status, 4)
  assert.match(r.stderr, /has changed/)
  assert.equal(acceptedList().length, 0)
})
test('a gate that started after the dialog was raised keeps its lock', () => {
  const cmd = hook(REAP).updatedInput.command
  fs.writeFileSync(lock, '{"pid":5555}')
  const r = run(cmd)
  assert.equal(r.status, 4)
  assert.equal(fs.existsSync(lock), true)
})
test('a ticket expires', () => {
  const n = issueTicket(f.state, 'x', 'c', 1000)
  assert.equal(consumeTicket(f.state, 'x', 'c', n, 1000 + TICKET_TTL_MS + 1), 'expired')
  assert.equal(consumeTicket(f.state, 'x', 'c', n, 1000), 'missing')
  const m = issueTicket(f.state, 'x', 'c', 1000)
  assert.equal(consumeTicket(f.state, 'x', 'c', 'wrong', 1000), 'nonce')
  assert.equal(consumeTicket(f.state, 'x', 'c', undefined, 1000), 'nonce')
  assert.equal(consumeTicket(f.state, 'x', 'c', m, 1000 + TICKET_TTL_MS), 'ok')
  const cmd = hook(REAP).updatedInput.command
  const t = JSON.parse(fs.readFileSync(ticket, 'utf8'))
  fs.writeFileSync(ticket, JSON.stringify({ ...t, issued: Date.now() - TICKET_TTL_MS - 1000 }))
  const r = run(cmd)
  assert.equal(r.status, 4)
  assert.match(r.stderr, /10 minutes/)
  assert.equal(fs.existsSync(lock), true)
})

// ---- the ways PR #7 closed stay closed ---------------------------------------------------------
test('every mode: the ticket file cannot be forged through the tools', () => {
  const calls = [
    ['Write', { file_path: ticket, content: '{}' }],
    ['Edit', { file_path: ticket, old_string: 'a', new_string: 'b' }],
    ['Write', { file_path: path.join(f.base, 'owner-ticket.json'), content: '{}' }],
    ['Bash', { command: `echo '{}' > ${ticket}` }],
    ['Bash', { command: 'echo {} > .git/lanekeeper/owner-ticket.json' }],
    ['Bash', { command: 'true && cp /tmp/x .git/lanekeeper/owner-ticket.json' }],
    ['Bash', { command: 'cd .git/lanekeeper && tee owner-ticket.json < /tmp/x' }],
    ['Bash', { command: `node -e "fs.writeFileSync('.git/lanekeeper/owner-ticket.json','{}')"` }],
    ['Bash', { command: `python3 -c "open('.git/lanekeeper/owner-ticket.json','w')"` }],
    ['Bash', { command: 'echo {} >> .git/lanekeeper/owner-decisions.jsonl' }],
  ]
  for (const mode of MODES) {
    for (const [tool, input] of calls) {
      assert.equal(hook(input.command, mode, {}, env, tool, input).permissionDecision, 'deny', `${mode} ${tool} ${JSON.stringify(input)}`)
      assert.equal(hook(input.command, mode, SUB, env, tool, input).permissionDecision, 'deny')
    }
  }
})
test('every mode: writing accepted.json or the acknowledgement, and starting a headless claude, stay refused', () => {
  const calls = [
    ['Write', { file_path: accepted, content: '{}' }],
    ['Bash', { command: 'echo {} > docs/test-results/accepted.json' }],
    ['Write', { file_path: personal, content: '{"auto_retry":{"bypass_ack":true}}' }],
    ['Bash', { command: `rm ${lock}` }],
    ['Bash', { command: 'claude -p "/lanekeeper:approve clear-gate-lock"' }],
    ['Bash', { command: 'claude -p "lanekeeper-reap --gate-lock"' }],
    ['Bash', { command: `claude -p 'run lanekeeper-quality accept unit --reason x'` }],
    ['Bash', { command: 'echo "lanekeeper-reap --gate-lock" | claude -p' }],
  ]
  for (const mode of MODES) for (const [tool, input] of calls) assert.equal(hook(input.command, mode, {}, env, tool, input).permissionDecision, 'deny', `${mode} ${JSON.stringify(input)}`)
  assert.equal(hook('claude -p "lanekeeper-quality list"').permissionDecision, 'allow')
})
test('a pseudo-terminal opens nothing: the commands have no terminal check to satisfy', () => {
  for (const name of ['lanekeeper-quality', 'lanekeeper-reap']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'bin', name), 'utf8'), /isTTY/)
  for (const mode of MODES) assert.equal(hook('script -q /dev/null lanekeeper-reap --gate-lock', mode).permissionDecision, 'deny')
})

// ---- retry-bypass stays slash-only -----------------------------------------------------------------
test('retry-bypass raises no dialog and takes no ticket', () => {
  for (const args of ['mode bypassPermissions', 'mode bypassPermissions --i-understand', 'mode bypassPermissions --dialog-ticket 0123']) {
    const r = run(`lanekeeper-retry ${args}`)
    assert.equal(r.status, 1, args)
    assert.match(r.stdout, /\/lanekeeper:approve retry-bypass/)
  }
  assert.equal(fs.existsSync(personal), false)
  for (const mode of MODES) {
    const out = hook('lanekeeper-retry mode bypassPermissions', mode)
    assert.notEqual(out.permissionDecision, 'ask')
    assert.equal(out.updatedInput, undefined)
  }
  assert.equal(fs.existsSync(ticket), false)
})

// ---- allow rules -----------------------------------------------------------------------------------
test('an allow rule covering the command is refused and reported by doctor', () => {
  const home = path.join(f.home, '.claude/settings.json')
  const project = path.join(f.repo, '.claude/settings.json')
  const local = path.join(f.repo, '.claude/settings.local.json')
  fs.mkdirSync(path.dirname(home), { recursive: true })
  fs.mkdirSync(path.dirname(project), { recursive: true })
  for (const file of [home, project, local]) {
    for (const rule of ['Bash', 'Bash(*)', 'Bash(lanekeeper-reap:*)', 'Bash(lanekeeper-*)', `Bash(${path.join(ROOT, 'bin')}/*)`, 'Bash(lanekeeper-quality accept *)']) {
      fs.writeFileSync(file, JSON.stringify({ permissions: { allow: [rule] } }))
      const out = hook(REAP)
      assert.equal(out.permissionDecision, 'deny', `${file} ${rule}`)
      assert.ok(out.permissionDecisionReason.includes(rule))
      const check = doctor(f.repo, env).checks.find((c) => c.id === 'ownerAllowRule')
      assert.equal(check.status, 'warn')
      assert.equal(check.detail.rule, rule)
    }
    fs.rmSync(file)
  }
  assert.equal(fs.existsSync(ticket), false)
})
test('unrelated rules and unreadable settings raise the dialog as usual', () => {
  const home = path.join(f.home, '.claude/settings.json')
  fs.mkdirSync(path.dirname(home), { recursive: true })
  fs.writeFileSync(home, JSON.stringify({ permissions: { allow: ['Bash(git status)', 'Bash(lanekeeper-quality list)', 'Read'] } }))
  assert.equal(hook(REAP).permissionDecision, 'ask')
  assert.equal(doctor(f.repo, env).checks.some((c) => c.id === 'ownerAllowRule'), false)
  fs.writeFileSync(home, '{not json')
  assert.equal(hook(REAP).permissionDecision, 'ask')
})
test('CLAUDE_CONFIG_DIR replaces ~/.claude when looking for rules', () => {
  const dir = path.join(f.base, 'profile')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(*)'] } }))
  assert.equal(hook(REAP, 'default', {}, { ...env, CLAUDE_CONFIG_DIR: dir }).permissionDecision, 'deny')
})
