// Release security gate (project.release): git-guard on protected landings and release tag pushes,
// `lanekeeper-test-report security-pass`, the ship gate hook, and the P3vot example config.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeFixture, git } from './safety-fixture.mjs'
import { makeEnv, bin, runScript, ROOT } from './l3-fixture.mjs'
import { SCHEMAS, check } from '../lib/schema.mjs'

let f
before(() => {
  f = makeFixture()
})
after(() => f.cleanup())
beforeEach(() => {
  f.clearGrant()
  f.clearProjectConfig()
  for (const n of ['lanekeeper-gate-pass.json', 'lanekeeper-security-pass.json']) fs.rmSync(path.join(f.state, n), { force: true })
})

const expect = (r, decision, code) => {
  assert.equal(r.decision, decision, JSON.stringify(r.codes))
  if (code) assert.ok(r.codes.includes(code), `expected ${code}, got ${JSON.stringify(r.codes)}`)
}
const main = (cmd, cwd) => f.judge(cmd, { cwd: cwd || f.repo })
const secStamp = (head, command = 'pnpm security:release-check') =>
  fs.writeFileSync(path.join(f.state, 'lanekeeper-security-pass.json'), JSON.stringify({ head, at: new Date().toISOString(), command }))
const SEC = { release: { security_check: 'pnpm security:release-check' } }

test('protected merge: with a security check set, the security stamp on that commit is required', () => {
  f.projectConfig(SEC)
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int'), 'deny', 'security.missing')
  assert.equal(f.readGrant().used, false, 'a blocked call does not spend the grant')
  secStamp('0000000000000000000000000000000000000000')
  expect(main('git merge lanekeeper/t/int'), 'deny', 'security.head')
  secStamp(f.sha('lanekeeper/t/int'), 'other command')
  expect(main('git merge lanekeeper/t/int'), 'deny', 'security.command')
  secStamp(f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int'), 'allow')
})

test('protected push: the pushed commit needs the security stamp too', () => {
  f.projectConfig(SEC)
  f.grant('push-main', f.sha('main'))
  expect(main('git push origin main'), 'deny', 'security.missing')
  secStamp(f.sha('main'))
  expect(main('git push origin main'), 'allow')
})

test('required but no command: protected landing is refused with the key to fill in', () => {
  f.projectConfig({ release: { security_required: true } })
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  const r = main('git merge lanekeeper/t/int')
  expect(r, 'deny', 'security.unset')
})

test('not configured and not required: landings behave as before', () => {
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int'), 'allow')
})

test('release tag push: needs the stamp on the tagged commit; other tags and --tags', () => {
  f.projectConfig(SEC)
  git(f.repo, 'tag', 'v9.9.9')
  git(f.repo, 'tag', 'scratch-1')
  expect(main('git push origin v9.9.9'), 'deny', 'security.missing')
  expect(main('git push origin refs/tags/v9.9.9'), 'deny', 'security.missing')
  expect(main('git push origin tag v9.9.9'), 'deny', 'security.missing')
  expect(main('git push --tags origin'), 'deny', 'security.tags_all')
  const other = main('git push origin tag scratch-1')
  assert.ok(!other.codes.some((c) => c.startsWith('security.')), 'a tag outside tag_patterns is not a release')
  secStamp(f.sha('v9.9.9'))
  const ok = main('git push origin tag v9.9.9')
  assert.ok(!ok.codes.some((c) => c.startsWith('security.')), JSON.stringify(ok.codes))
  f.clearProjectConfig()
  const off = main('git push origin tag v9.9.9')
  assert.ok(!off.codes.some((c) => c.startsWith('security.')), 'no release config: tags go on as before')
  git(f.repo, 'tag', '-d', 'v9.9.9')
  git(f.repo, 'tag', '-d', 'scratch-1')
})

test('the message names the command to run', () => {
  f.projectConfig(SEC)
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  const r = main('git merge lanekeeper/t/int')
  const why = r.reasons.find((x) => x.code === 'security.missing')
  assert.equal(why.vars.command, 'pnpm security:release-check')
})

// ---- lanekeeper-test-report security-pass ---------------------------------------------------

const projectCfg = (e, obj) => {
  fs.mkdirSync(path.join(e.repo, '.lanekeeper'), { recursive: true })
  fs.writeFileSync(path.join(e.repo, '.lanekeeper', 'config.json'), JSON.stringify({ version: 1, ...obj }))
}
const stampPath = (e) => path.join(e.repo, '.git', 'lanekeeper', 'lanekeeper-security-pass.json')

test('security-pass: writes the stamp on a pass, does not run again on the same commit, keeps none on a failure', () => {
  const e = makeEnv()
  let r = bin('lanekeeper-test-report', ['security-pass'], e.env, e.repo)
  assert.equal(r.status, 2, 'no check set')
  assert.match(r.stderr, /release\.security_check is empty/)
  projectCfg(e, { release: { security_check: 'echo ran >> ran.log' } })
  r = bin('lanekeeper-test-report', ['security-pass'], e.env, e.repo)
  assert.equal(r.status, 0, r.stderr)
  const s = JSON.parse(fs.readFileSync(stampPath(e), 'utf8'))
  assert.equal(s.head, git(e.repo, 'rev-parse', 'HEAD'))
  assert.equal(s.command, 'echo ran >> ran.log')
  r = bin('lanekeeper-test-report', ['security-pass'], e.env, e.repo)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /already passed/)
  assert.equal(fs.readFileSync(path.join(e.repo, 'ran.log'), 'utf8').trim().split('\n').length, 1, 'not run again')
  fs.rmSync(stampPath(e))
  projectCfg(e, { release: { security_check: 'exit 3' } })
  r = bin('lanekeeper-test-report', ['security-pass'], e.env, e.repo)
  assert.equal(r.status, 3)
  assert.match(r.stderr, /failed \(exit code 3\)/)
  assert.equal(fs.existsSync(stampPath(e)), false)
  e.cleanup()
})

// ---- ship gate hook ------------------------------------------------------------------------

test('ship gate: blocks ship verification without the security stamp, warns when not configured', () => {
  const e = makeEnv()
  const hook = () => runScript('hooks/scripts/quality/ship-gate.mjs', { tool_name: 'Agent', tool_input: { subagent_type: 'readiness-auditor' }, cwd: e.repo }, e.env)
  let r = hook()
  assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined)
  assert.match(r.out.hookSpecificOutput.additionalContext, /Release security gate not configured/)
  projectCfg(e, { release: { security_check: 'true' } })
  r = hook()
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /lanekeeper-test-report security-pass/)
  assert.equal(bin('lanekeeper-test-report', ['security-pass'], e.env, e.repo).status, 0)
  r = hook()
  assert.equal(r.out, null, 'passed on this commit: nothing to say')
  projectCfg(e, { release: { security_required: true } })
  r = hook()
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /release\.security_check/)
  e.cleanup()
})

test('example: the P3vot project config sets the security gate and is valid', () => {
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/p3vot-config.json'), 'utf8'))
  assert.deepEqual(check(SCHEMAS.project, ex).errors, [])
  assert.equal(ex.release.security_check, 'pnpm security:release-check')
  assert.equal(ex.release.security_required, true)
})
