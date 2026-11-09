// /lanekeeper:approve: the UserPromptExpansion hook that records an owner grant, and
// the full path from grant to an allowed merge.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeFixture, git } from './safety-fixture.mjs'
import { handleApprove } from '../hooks/scripts/safety/approve.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let f
before(() => {
  f = makeFixture()
})
after(() => f.cleanup())
beforeEach(() => {
  f.clearGrant()
  f.clearProjectConfig()
})

const approve = (args, { cwd = f.repo, name = 'lanekeeper:approve', now } = {}) =>
  handleApprove({ hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: name, command_args: args, command_source: 'plugin', cwd, session_id: 's1' }, f.env, now)

test('merge-main without a ref grants the single integration branch at its current commit', () => {
  const r = approve('merge-main')
  assert.match(r.hookSpecificOutput.additionalContext, /merge-main · lanekeeper\/t\/int/)
  const g = f.readGrant()
  assert.equal(g.action, 'merge-main')
  assert.equal(g.head, f.sha('lanekeeper/t/int'))
  assert.equal(g.used, false)
  const ttl = (Date.parse(g.expires) - Date.parse(g.created)) / 60000
  assert.equal(ttl, 15)
})
test('push-main defaults to the protected branch, commit-main to HEAD; an explicit ref wins', () => {
  approve('push-main')
  assert.equal(f.readGrant().head, f.sha('main'))
  approve('commit-main')
  assert.equal(f.readGrant().head, f.sha('HEAD'))
  approve('merge-main feature/x')
  assert.equal(f.readGrant().head, f.sha('feature/x'))
})
test('ttl comes from project.git.owner_grant_ttl_min', () => {
  f.projectConfig({ git: { owner_grant_ttl_min: 5 } })
  approve('merge-main')
  const g = f.readGrant()
  assert.equal((Date.parse(g.expires) - Date.parse(g.created)) / 60000, 5)
})
test('refusals: unknown action, unknown ref, ambiguous integration branch, broken settings', () => {
  assert.equal(approve('deploy').decision, 'block')
  assert.equal(approve('merge-main no-such-branch').decision, 'block')
  const lanes = path.join(f.state, 'lanes.json')
  const saved = fs.readFileSync(lanes, 'utf8')
  fs.writeFileSync(lanes, '{"lanes":[]}')
  try {
    const r = approve('merge-main')
    assert.equal(r.decision, 'block')
    assert.match(r.reason, /merge-main <branch>/)
  } finally {
    fs.writeFileSync(lanes, saved)
  }
  f.projectConfig({ git: { owner_grant_ttl_min: 'soon' } })
  assert.equal(approve('merge-main').decision, 'block')
  assert.equal(fs.existsSync(path.join(f.state, 'owner-grant.json')), false)
})
test('other commands are ignored', () => {
  assert.equal(approve('merge-main', { name: 'other:approve' }), null)
  assert.equal(approve('merge-main', { name: 'approve' }), null)
  assert.equal(fs.existsSync(path.join(f.state, 'owner-grant.json')), false)
})
test('status and revoke', () => {
  assert.match(approve('status').hookSpecificOutput.additionalContext, /no owner grant/)
  approve('merge-main')
  assert.match(approve('status').hookSpecificOutput.additionalContext, /active/)
  approve('revoke')
  assert.equal(fs.existsSync(path.join(f.state, 'owner-grant.json')), false)
})
test('end to end: approve → merge allowed once → second merge refused → expired grant refused', () => {
  approve('merge-main')
  assert.equal(f.judge('git merge --no-ff lanekeeper/t/int', { cwd: f.repo }).decision, 'allow')
  assert.match(approve('status').hookSpecificOutput.additionalContext, /used/)
  assert.deepEqual(f.judge('git merge lanekeeper/t/int', { cwd: f.repo }).codes, ['grant.used'])
  approve('merge-main', { now: Date.now() - 16 * 60000 })
  assert.deepEqual(f.judge('git merge lanekeeper/t/int', { cwd: f.repo }).codes, ['grant.expired'])
})
test('end to end: with a gate command the grant also needs a stamp for the same commit', () => {
  f.projectConfig({ gate: { command: 'npm test' } })
  const r = approve('merge-main')
  assert.match(r.hookSpecificOutput.additionalContext, /gate pass stamp/)
  assert.deepEqual(f.judge('git merge lanekeeper/t/int', { cwd: f.repo }).codes, ['stamp.missing'])
  f.stamp(f.sha('lanekeeper/t/int'))
  assert.equal(f.judge('git merge lanekeeper/t/int', { cwd: f.repo }).decision, 'allow')
})
test('hook process: writes the grant and prints additionalContext JSON', () => {
  const script = path.join(ROOT, 'hooks', 'scripts', 'safety', 'approve.mjs')
  const r = spawnSync(script, [], {
    input: JSON.stringify({ hook_event_name: 'UserPromptExpansion', command_name: 'lanekeeper:approve', command_args: 'push-main', cwd: f.repo }),
    env: f.env,
    encoding: 'utf8',
  })
  assert.equal(r.status, 0)
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.hookEventName, 'UserPromptExpansion')
  assert.equal(f.readGrant().action, 'push-main')
})
test('plugin wiring: hooks.json registers both hooks; the skill cannot be invoked by the model', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks
  const pre = h.PreToolUse.find((e) => e.hooks.some((x) => x.command.includes('safety/pretool.mjs')))
  for (const tool of ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Skill']) assert.ok(new RegExp(`^(${pre.matcher})$`).test(tool), tool)
  const exp = h.UserPromptExpansion.find((e) => e.hooks.some((x) => x.command.includes('safety/approve.mjs')))
  assert.equal(exp.matcher, 'lanekeeper:approve')
  assert.ok(!(h.UserPromptSubmit || []).some((e) => e.hooks.some((x) => x.command.includes('approve'))), 'grants must not come from UserPromptSubmit')
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'approve', 'SKILL.md'), 'utf8')
  assert.match(skill, /^disable-model-invocation: true$/m)
  for (const s of ['pretool.mjs', 'approve.mjs']) assert.ok(fs.statSync(path.join(ROOT, 'hooks', 'scripts', 'safety', s)).mode & 0o111, s)
})

test('--to sets the destination; without it the checked-out protected branch is used', () => {
  approve('merge-main')
  assert.equal(f.readGrant().dest, 'main')
  approve('merge-main lanekeeper/t/int --to release/1.0')
  assert.equal(f.readGrant().dest, 'release/1.0')
  assert.equal(f.readGrant().head, f.sha('lanekeeper/t/int'))
  approve('push-main --to=release/1.0')
  assert.equal(f.readGrant().dest, 'release/1.0')
  assert.equal(approve('merge-main --to feature/x').decision, 'block')
  assert.equal(approve('commit-main --to main').decision, 'block')
})
test('commit-main holds what is staged, and merge and push do not', () => {
  approve('commit-main')
  assert.match(f.readGrant().index, /^[0-9a-f]{40}$/)
  assert.match(approve('commit-main').hookSpecificOutput.additionalContext, /what is staged now/)
  approve('push-main')
  assert.equal(f.readGrant().index, undefined)
})

test('push-main holds the remote; merge and commit take none', () => {
  approve('push-main')
  assert.deepEqual([f.readGrant().remote, f.readGrant().remoteUrl], ['origin', 'origin'])
  assert.equal(approve('merge-main --remote origin').decision, 'block')
  assert.equal(approve('commit-main --remote origin').decision, 'block')
  assert.equal(approve('push-main --remote nope').decision, 'block')
})
