// Release gates (project.release): git-guard on protected landings and release tag pushes,
// `lanekeeper-test-report gates-pass` / `security-pass`, the ship gate hook, the example configs, and
// the older single setting (release.security_check) read as the gate `security`.
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
  for (const n of fs.readdirSync(f.state)) if (/^lanekeeper-(gate|security|release-.*)-pass\.json$/.test(n)) fs.rmSync(path.join(f.state, n), { force: true })
})

const expect = (r, decision, code) => {
  assert.equal(r.decision, decision, JSON.stringify(r.codes))
  if (code) assert.ok(r.codes.includes(code), `expected ${code}, got ${JSON.stringify(r.codes)}`)
}
const main = (cmd, cwd) => f.judge(cmd, { cwd: cwd || f.repo })
const secStamp = (head, command = 'pnpm security:release-check') =>
  fs.writeFileSync(path.join(f.state, 'lanekeeper-security-pass.json'), JSON.stringify({ head, at: new Date().toISOString(), command }))
const gateStamp = (name, head, command) =>
  fs.writeFileSync(path.join(f.state, `lanekeeper-release-${name}-pass.json`), JSON.stringify({ head, at: new Date().toISOString(), command, gate: name }))
// Older single setting: read as the required gate `security`.
const SEC = { release: { security_check: 'pnpm security:release-check' } }
const GATES = {
  release: {
    gates: [
      { name: 'security', command: 'pnpm security:release-check', required: true },
      { name: 'semgrep', command: 'semgrep scan --error', required: true },
      { name: 'licenses', command: 'license-check', required: false },
    ],
  },
}
const codes = (r) => r.codes.filter((c) => c.startsWith('release.'))

test('protected merge: with a security check set, the security stamp on that commit is required', () => {
  f.projectConfig(SEC)
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int'), 'deny', 'release.missing')
  assert.equal(f.readGrant().used, false, 'a blocked call does not spend the grant')
  secStamp('0000000000000000000000000000000000000000')
  expect(main('git merge lanekeeper/t/int'), 'deny', 'release.head')
  secStamp(f.sha('lanekeeper/t/int'), 'other command')
  expect(main('git merge lanekeeper/t/int'), 'deny', 'release.command')
  secStamp(f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int'), 'allow')
})

test('protected push: the pushed commit needs the security stamp too', () => {
  f.projectConfig(SEC)
  f.grant('push-main', f.sha('main'))
  expect(main('git push origin main'), 'deny', 'release.missing')
  secStamp(f.sha('main'))
  expect(main('git push origin main'), 'allow')
})

test('required but no command: protected landing is refused with the key to fill in', () => {
  f.projectConfig({ release: { security_required: true } })
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  const r = main('git merge lanekeeper/t/int')
  expect(r, 'deny', 'release.unset')
})

test('not configured and not required: landings behave as before', () => {
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int'), 'allow')
})

test('release tag push: needs the stamp on the tagged commit; other tags and --tags', () => {
  f.projectConfig(SEC)
  git(f.repo, 'tag', 'v9.9.9')
  git(f.repo, 'tag', 'scratch-1')
  expect(main('git push origin v9.9.9'), 'deny', 'release.missing')
  expect(main('git push origin refs/tags/v9.9.9'), 'deny', 'release.missing')
  expect(main('git push origin tag v9.9.9'), 'deny', 'release.missing')
  expect(main('git push --tags origin'), 'deny', 'release.tags_all')
  const other = main('git push origin tag scratch-1')
  assert.ok(!other.codes.some((c) => c.startsWith('release.')), 'a tag outside tag_patterns is not a release')
  secStamp(f.sha('v9.9.9'))
  const ok = main('git push origin tag v9.9.9')
  assert.ok(!ok.codes.some((c) => c.startsWith('release.')), JSON.stringify(ok.codes))
  f.clearProjectConfig()
  const off = main('git push origin tag v9.9.9')
  assert.ok(!off.codes.some((c) => c.startsWith('release.')), 'no release config: tags go on as before')
  git(f.repo, 'tag', '-d', 'v9.9.9')
  git(f.repo, 'tag', '-d', 'scratch-1')
})

test('the message names the gate, its command and the exact command that passes it', () => {
  f.projectConfig(SEC)
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  const r = main('git merge lanekeeper/t/int')
  const why = r.reasons.find((x) => x.code === 'release.missing')
  assert.equal(why.vars.gate, 'security')
  assert.equal(why.vars.command, 'pnpm security:release-check')
  assert.equal(why.vars.run, 'lanekeeper-test-report gates-pass --name security')
})

// ---- gate list ---------------------------------------------------------------------------------

test('gate list: only the required gates that have not passed block, each named with its command', () => {
  f.projectConfig(GATES)
  const sha = f.sha('lanekeeper/t/int')
  f.grant('merge-main', sha)
  let r = main('git merge lanekeeper/t/int')
  expect(r, 'deny')
  assert.deepEqual(codes(r), ['release.missing', 'release.missing'])
  assert.deepEqual(r.reasons.filter((x) => x.code.startsWith('release.')).map((x) => x.vars.gate), ['security', 'semgrep'], 'the optional gate is not asked here')
  secStamp(sha)
  r = main('git merge lanekeeper/t/int')
  const left = r.reasons.filter((x) => x.code.startsWith('release.'))
  assert.deepEqual(left.map((x) => x.vars.gate), ['semgrep'], 'a gate that passed on this commit is not named again')
  assert.equal(left[0].vars.run, 'lanekeeper-test-report gates-pass --name semgrep')
  gateStamp('semgrep', sha, 'semgrep scan --error')
  expect(main('git merge lanekeeper/t/int'), 'allow')
})

test('gate list: a stamp for another commit or another command does not count', () => {
  f.projectConfig(GATES)
  const sha = f.sha('lanekeeper/t/int')
  f.grant('merge-main', sha)
  secStamp(sha)
  gateStamp('semgrep', '0000000000000000000000000000000000000000', 'semgrep scan --error')
  let r = main('git merge lanekeeper/t/int')
  assert.deepEqual(codes(r), ['release.head'])
  gateStamp('semgrep', sha, 'semgrep scan')
  r = main('git merge lanekeeper/t/int')
  assert.deepEqual(codes(r), ['release.command'])
})

test('gate list: a required gate with no command blocks; only optional gates do not', () => {
  f.projectConfig({ release: { gates: [{ name: 'sonarqube', command: '' }] } })
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  assert.deepEqual(codes(main('git merge lanekeeper/t/int')), ['release.unset'], 'required defaults to true')
  f.projectConfig({ release: { gates: [{ name: 'sonarqube', command: 'sonar-check', required: false }] } })
  expect(main('git merge lanekeeper/t/int'), 'allow')
  git(f.repo, 'tag', 'v8.8.8')
  assert.deepEqual(codes(main('git push origin tag v8.8.8')), [], 'no required gate: release tags go on as before')
  assert.deepEqual(codes(main('git push --tags origin')), [])
  git(f.repo, 'tag', '-d', 'v8.8.8')
})

test('gate list: a release tag needs every required gate on the tagged commit', () => {
  f.projectConfig(GATES)
  git(f.repo, 'tag', 'v7.7.7')
  assert.deepEqual(codes(main('git push origin tag v7.7.7')), ['release.missing', 'release.missing'])
  assert.deepEqual(codes(main('git push --tags origin')), ['release.tags_all'])
  secStamp(f.sha('v7.7.7'))
  gateStamp('semgrep', f.sha('v7.7.7'), 'semgrep scan --error')
  assert.deepEqual(codes(main('git push origin tag v7.7.7')), [])
  git(f.repo, 'tag', '-d', 'v7.7.7')
})

test('older single setting next to a gate list: a `security` entry in gates wins', () => {
  f.projectConfig({ release: { security_check: 'old-check', gates: [{ name: 'security', command: 'new-check' }] } })
  const sha = f.sha('lanekeeper/t/int')
  f.grant('merge-main', sha)
  secStamp(sha, 'old-check')
  assert.deepEqual(codes(main('git merge lanekeeper/t/int')), ['release.command'])
  secStamp(sha, 'new-check')
  expect(main('git merge lanekeeper/t/int'), 'allow')
})

test('older single setting and older stamp file: still read as the gate `security`', () => {
  f.projectConfig({ release: { security_check: 'pnpm security:release-check', security_stamp: 'my-sec' } })
  const sha = f.sha('lanekeeper/t/int')
  f.grant('merge-main', sha)
  // a stamp written before gates existed: no `gate` field
  fs.writeFileSync(path.join(f.state, 'my-sec.json'), JSON.stringify({ head: sha, at: new Date().toISOString(), command: 'pnpm security:release-check' }))
  expect(main('git merge lanekeeper/t/int'), 'allow')
  fs.rmSync(path.join(f.state, 'my-sec.json'))
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
  assert.equal(r.status, 2, 'no gate set')
  assert.match(r.stderr, /No release gate is set/)
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
  r = bin('lanekeeper-test-report', ['gates-pass'], e.env, e.repo)
  assert.match(r.stdout, /already passed/, 'gates-pass reads the stamp security-pass wrote')
  fs.rmSync(stampPath(e))
  projectCfg(e, { release: { security_check: 'exit 3' } })
  r = bin('lanekeeper-test-report', ['security-pass'], e.env, e.repo)
  assert.equal(r.status, 3)
  assert.match(r.stderr, /failed \(exit code 3\)/)
  assert.equal(fs.existsSync(stampPath(e)), false)
  e.cleanup()
})

test('gates-pass: runs each gate not passed yet, one stamp per gate, --name picks one, --force runs again', () => {
  const e = makeEnv()
  const gate = (name) => path.join(e.repo, '.git', 'lanekeeper', `lanekeeper-release-${name}-pass.json`)
  const count = (f) => (fs.existsSync(path.join(e.repo, f)) ? fs.readFileSync(path.join(e.repo, f), 'utf8').trim().split('\n').length : 0)
  // the logs are outside the tree so the run leaves it clean
  fs.mkdirSync(path.join(e.repo, '.git', 'logs-out'), { recursive: true })
  const gates = [
    { name: 'security', command: 'echo s >> .git/logs-out/s.log', required: true },
    { name: 'semgrep', command: 'echo g >> .git/logs-out/g.log', required: true },
    { name: 'sonarqube', command: 'exit 4', required: false },
  ]
  projectCfg(e, { release: { gates } })
  let r = bin('lanekeeper-test-report', ['gates-pass', '--name', 'nope'], e.env, e.repo)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /no release gate named `nope`/)
  r = bin('lanekeeper-test-report', ['gates-pass'], e.env, e.repo)
  assert.equal(r.status, 4, 'the failing gate sets the exit code; the others still ran')
  assert.match(r.stderr, /`sonarqube` failed \(exit code 4\)/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(e.repo, '.git', 'lanekeeper', 'lanekeeper-security-pass.json'), 'utf8')).gate, 'security')
  assert.equal(JSON.parse(fs.readFileSync(gate('semgrep'), 'utf8')).command, 'echo g >> .git/logs-out/g.log')
  assert.equal(fs.existsSync(gate('sonarqube')), false)
  r = bin('lanekeeper-test-report', ['gates-pass', '--name', 'semgrep'], e.env, e.repo)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /`semgrep` already passed/)
  assert.equal(count('.git/logs-out/g.log'), 1, 'not run again on the same commit')
  r = bin('lanekeeper-test-report', ['gates-pass', '--name', 'semgrep', '--force'], e.env, e.repo)
  assert.equal(r.status, 0)
  assert.equal(count('.git/logs-out/g.log'), 2)
  assert.equal(count('.git/logs-out/s.log'), 1, '--name runs only that gate')
  e.cleanup()
})

// ---- ship gate hook ------------------------------------------------------------------------

test('ship gate: blocks ship verification without the security stamp, warns when not configured', () => {
  const e = makeEnv()
  const hook = () => runScript('hooks/scripts/quality/ship-gate.mjs', { tool_name: 'Agent', tool_input: { subagent_type: 'readiness-auditor' }, cwd: e.repo }, e.env)
  let r = hook()
  assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined)
  assert.match(r.out.hookSpecificOutput.additionalContext, /Release gates not configured/)
  projectCfg(e, { release: { security_check: 'true' } })
  r = hook()
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /lanekeeper-test-report gates-pass --name security/)
  assert.equal(bin('lanekeeper-test-report', ['security-pass'], e.env, e.repo).status, 0)
  r = hook()
  assert.equal(r.out, null, 'passed on this commit: nothing to say')
  projectCfg(e, { release: { security_required: true } })
  r = hook()
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /release\.gates/)
  e.cleanup()
})

test('ship gate: names only the gates that block, and warns about optional ones', () => {
  const e = makeEnv()
  const hook = () => runScript('hooks/scripts/quality/ship-gate.mjs', { tool_name: 'Agent', tool_input: { subagent_type: 'readiness-auditor' }, cwd: e.repo }, e.env)
  projectCfg(e, { release: { gates: [{ name: 'security', command: 'true' }, { name: 'semgrep', command: 'true' }, { name: 'sonarqube', command: 'false', required: false }] } })
  assert.equal(bin('lanekeeper-test-report', ['gates-pass', '--name', 'security'], e.env, e.repo).status, 0)
  let r = hook()
  const why = r.out.hookSpecificOutput.permissionDecisionReason
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(why, /gates-pass --name semgrep/)
  assert.doesNotMatch(why, /`security`/, 'a gate that passed is not named')
  assert.match(why, /Optional release gates not passed.*`sonarqube`/)
  assert.equal(bin('lanekeeper-test-report', ['gates-pass', '--name', 'semgrep'], e.env, e.repo).status, 0)
  r = hook()
  assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined, 'only an optional gate is left: a warning')
  assert.match(r.out.hookSpecificOutput.additionalContext, /gates-pass --name sonarqube/)
  e.cleanup()
})

test('examples: the P3vot config and the static analysis gates are valid', () => {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', f), 'utf8'))
  const ex = read('p3vot-config.json')
  assert.deepEqual(check(SCHEMAS.project, ex).errors, [])
  assert.deepEqual(ex.release.gates, [{ name: 'security', command: 'pnpm security:release-check', required: true }])
  const sa = read('static-analysis-gates.json')
  assert.deepEqual(check(SCHEMAS.project, sa).errors, [])
  const names = sa.release.gates.map((g) => g.name)
  assert.ok(names.includes('sonarqube') && names.includes('semgrep'), JSON.stringify(names))
  assert.match(sa.release.gates.find((g) => g.name === 'sonarqube').command, /api\/qualitygates\/project_status/)
  assert.match(sa.release.gates.find((g) => g.name === 'semgrep').command, /semgrep scan .*--error/)
})
