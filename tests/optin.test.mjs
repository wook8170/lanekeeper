// Opt-in and deference: workflow hooks stay silent outside a repository with
// .wb/config.json, safety hooks always run; a hook kind the user's Claude Code
// settings already register is left to that hook; onFailure "block" on the
// guards that must not fail open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, runScript, ROOT } from './l3-fixture.mjs'
import { optedIn, globalHookKinds } from '../lib/optin.mjs'

function setup() {
  const f = makeEnv()
  delete f.env.WB_ACTIVE
  return f
}
const optIn = (f) => {
  fs.mkdirSync(path.join(f.repo, '.wb'), { recursive: true })
  fs.writeFileSync(path.join(f.repo, '.wb', 'config.json'), JSON.stringify({ version: 1 }))
}
const agent = (f) => runScript('hooks/scripts/dispatch/dispatch-guard.mjs', { tool_name: 'Agent', tool_input: { prompt: 'do it', model: 'opus' }, cwd: f.repo }, f.env)

test('opt-in: without .wb/config.json the dispatch guard is silent; with it a dispatch without a brief is denied', () => {
  const f = setup()
  try {
    assert.equal(optedIn(f.repo, f.env), false)
    assert.equal(agent(f).out, null)
    optIn(f)
    assert.equal(optedIn(f.repo, f.env), true)
    assert.equal(agent(f).out.hookSpecificOutput.permissionDecision, 'deny')
    assert.equal(optedIn(f.repo, { ...f.env, WB_ACTIVE: '0' }), false, 'WB_ACTIVE=0 turns it off')
  } finally {
    f.cleanup()
  }
})

test('opt-in: a linked worktree counts when the main checkout has .wb/config.json', async () => {
  const f = setup()
  try {
    optIn(f)
    const { execFileSync } = await import('node:child_process')
    const wt = path.join(f.base, 'wt')
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'side', wt], { cwd: f.repo, env: f.env })
    assert.equal(optedIn(wt, f.env), true)
  } finally {
    f.cleanup()
  }
})

test('opt-in: the safety hook runs in every repository', () => {
  const f = setup()
  try {
    const r = runScript('hooks/scripts/safety/pretool.mjs', { tool_name: 'Bash', tool_input: { command: 'pkill -f vite' }, cwd: f.repo }, f.env)
    assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny')
  } finally {
    f.cleanup()
  }
})

test('opt-in: handoff session start and the session rules are silent outside an opted-in repository', () => {
  const f = setup()
  try {
    fs.writeFileSync(path.join(f.repo, 'progress.md'), '# progress\n\n## Now\n\n> content A\n')
    assert.equal(runScript('hooks/scripts/handoff/session-start.mjs', { source: 'startup', cwd: f.repo }, f.env).out, null)
    assert.equal(runScript('hooks/scripts/rules/session-start.mjs', { source: 'startup', cwd: f.repo }, f.env).out, null)
    optIn(f)
    assert.match(runScript('hooks/scripts/handoff/session-start.mjs', { source: 'startup', cwd: f.repo }, f.env).out.hookSpecificOutput.additionalContext, /content A/)
  } finally {
    f.cleanup()
  }
})

test('defer: a handoff hook in the Claude Code settings silences wb handoff; global_hooks=ignore keeps it', () => {
  const f = setup()
  try {
    optIn(f)
    fs.writeFileSync(path.join(f.repo, 'progress.md'), '# progress\n\n## Now\n\n> content A\n')
    fs.mkdirSync(f.env.CLAUDE_CONFIG_DIR, { recursive: true })
    fs.writeFileSync(path.join(f.env.CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/handoff-guard/session-start.sh' }] }], Stop: [{ hooks: [{ type: 'command', command: 'node ~/.claude/hooks/token-guard/check.mjs' }] }] } }))
    assert.deepEqual([...globalHookKinds(f.env)].sort(), ['handoff', 'token_guard'])
    const hs = () => runScript('hooks/scripts/handoff/session-start.mjs', { source: 'startup', cwd: f.repo }, f.env).out
    assert.equal(hs(), null)
    fs.writeFileSync(path.join(f.env.WB_HOME, 'personal.json'), JSON.stringify({ version: 1, global_hooks: 'ignore' }))
    assert.match(hs().hookSpecificOutput.additionalContext, /content A/)
  } finally {
    f.cleanup()
  }
})

test('onFailure "block" is set on the safety, dispatch and ship-gate hooks only', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks
  const all = Object.values(hooks).flatMap((groups) => groups.flatMap((g) => g.hooks))
  const blocking = all.filter((h) => h.onFailure === 'block').map((h) => h.command.split('/hooks/scripts/')[1]).sort()
  assert.deepEqual(blocking, ['dispatch/dispatch-guard.mjs', 'quality/ship-gate.mjs', 'safety/pretool.mjs'])
})
