// A grant for one pull request: merge-pr. It is bound to the repository, the PR, the head commit and
// the base branch, and lives under LANEKEEPER_HOME, so the folder the session is in does not matter.
// A fake `gh` stands in for GitHub. What Claude Code does with `ask` is covered in owner-dialog.test.mjs.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeFixture, git } from './safety-fixture.mjs'
import { handleApprove } from '../hooks/scripts/safety/approve.mjs'
import { evaluate } from '../hooks/scripts/safety/pretool.mjs'
import { realPr } from '../hooks/scripts/safety/context.mjs'
import { promptHint } from '../hooks/scripts/safety/prompt-hint.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HEAD = 'a'.repeat(40)
const URL_162 = 'https://github.com/acme/widgets/pull/162'
const KEY = 'github.com/acme/widgets#162'
const PR = { baseRefName: 'main', headRefOid: HEAD, number: 162, url: URL_162, title: 'fix the grid' }
const REPO = '--repo acme/widgets'
const GRANT_LINE = `lanekeeper-grant merge-pr 162 ${REPO}`
const MERGE = `gh pr merge 162 --repo github.com/acme/widgets --match-head-commit ${HEAD} --squash`

let f, other, plain, fake, calls, answer, env, ownerGrant, ownerTicket, sessionGrant

// What gh would answer now, with the names realPr gives the fields.
const looked = (over = {}) => {
  const j = { ...PR, ...over }
  return { pr: () => ({ base: j.baseRefName, headOid: j.headRefOid, number: j.number, url: j.url, title: j.title }) }
}
const hook = (command, { cwd = f.repo, mode = 'default', overrides = looked(), ...rest } = {}) => {
  const r = evaluate({ hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command }, permission_mode: mode, session_id: 's1', ...rest }, env, overrides)
  return { ...r, codes: r.reasons.map((x) => x.code) }
}
const slash = (args, cwd = f.repo) => handleApprove({ command_name: 'lanekeeper:approve', command_args: args, cwd, session_id: 's1' }, env)
const setAnswer = (over = {}) => fs.writeFileSync(answer, JSON.stringify({ ...PR, ...over }))
const readGrant = () => JSON.parse(fs.readFileSync(ownerGrant, 'utf8'))
const runShown = (command, cwd = f.repo) => spawnSync('sh', ['-c', command], { cwd, env, encoding: 'utf8' })

before(() => {
  f = makeFixture()
  // The session's folder is a copy of the PR's repository, unless a test says otherwise.
  git(f.repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  other = makeFixture()
  plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lanekeeper-plain-')))
  fake = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lanekeeper-fake-gh-')))
  calls = path.join(fake, 'calls.log')
  answer = path.join(fake, 'answer.json')
  fs.writeFileSync(path.join(fake, 'gh'), `#!/bin/sh\necho "[$GH_REPO] $*" >> '${calls}'\ncat '${answer}'\n`, { mode: 0o755 })
  // The lookup runs with the environment of this process, so the real gh must not be found.
  process.env.PATH = `${fake}:${process.env.PATH}`
  env = { ...f.env, PATH: process.env.PATH, CLAUDE_CODE_ENTRYPOINT: 'cli' }
  ownerGrant = path.join(f.lanekeeperHome, 'owner', 'owner-grant.json')
  ownerTicket = path.join(f.lanekeeperHome, 'owner', 'owner-ticket.json')
  sessionGrant = path.join(f.state, 'owner-grant.json')
})
after(() => {
  process.env.PATH = process.env.PATH.split(':').slice(1).join(':')
  f.cleanup()
  other.cleanup()
  fs.rmSync(plain, { recursive: true, force: true })
  fs.rmSync(fake, { recursive: true, force: true })
})
beforeEach(() => {
  f.clearGrant()
  f.clearProjectConfig()
  fs.rmSync(path.join(f.lanekeeperHome, 'owner'), { recursive: true, force: true })
  fs.rmSync(path.join(f.home, '.claude/settings.json'), { force: true })
  fs.rmSync(calls, { force: true })
  setAnswer()
})

// ---- the slash command ------------------------------------------------------------------------

test('merge-pr by slash: a person names the PR and the grant holds repository, PR, head and base', () => {
  const r = slash(`merge-pr 162 ${REPO}`)
  assert.equal(r.decision, undefined, JSON.stringify(r))
  const g = readGrant()
  assert.equal(g.action, 'merge-pr')
  assert.equal(g.ref, KEY)
  assert.equal(g.head, HEAD)
  assert.equal(g.dest, 'main')
  assert.equal(g.via, 'slash')
  assert.equal(g.used, false)
  assert.ok(!fs.existsSync(sessionGrant), 'the folder of the session holds nothing')
  assert.ok(r.hookSpecificOutput.additionalContext.includes(MERGE), 'the agent is told the line to run')
  assert.match(fs.readFileSync(calls, 'utf8'), /pr view 162 --repo acme\/widgets --json /)
})

test('merge-pr by slash works where merge-main cannot: an integration branch with another name, and a folder outside any repository', () => {
  git(f.repo, 'branch', 'acme/next/int')
  assert.equal(slash(`merge-pr 162 ${REPO}`).decision, undefined)
  fs.rmSync(ownerGrant)
  assert.equal(slash(`merge-pr 162 ${REPO}`, plain).decision, undefined)
  assert.equal(readGrant().ref, KEY)
})

test('merge-pr by slash: refused for a base that is not protected, an unknown PR, and options of other actions', () => {
  setAnswer({ baseRefName: 'feature/y' })
  assert.equal(slash(`merge-pr 162 ${REPO}`).decision, 'block')
  setAnswer()
  assert.equal(slash(`merge-pr 162 ${REPO} --to main`).decision, 'block')
  assert.equal(slash(`merge-pr 162 ${REPO} --remote origin`).decision, 'block')
  assert.equal(slash(`merge-pr --web ${REPO}`).decision, 'block', 'an option is not a PR')
  fs.writeFileSync(answer, 'not json')
  assert.equal(slash(`merge-pr 162 ${REPO}`).decision, 'block')
  assert.ok(!fs.existsSync(ownerGrant))
})

test('slash status and revoke cover the grant for a PR', () => {
  slash(`merge-pr 162 ${REPO}`)
  assert.match(slash('status').hookSpecificOutput.additionalContext, /widgets#162/)
  slash('revoke')
  assert.ok(!fs.existsSync(ownerGrant))
  assert.match(slash('status', plain).hookSpecificOutput.additionalContext, /[Nn]o /)
})

test('need_ref names the way that works for a pull request', () => {
  git(f.repo, 'branch', '-m', 'lanekeeper/t/int', 'moved/t/int')
  try {
    assert.match(slash('merge-main').reason, /merge-pr/)
  } finally {
    git(f.repo, 'branch', '-m', 'moved/t/int', 'lanekeeper/t/int')
  }
})

// ---- the merge --------------------------------------------------------------------------------

test('the grant lets one merge through from any folder, once', () => {
  slash(`merge-pr 162 ${REPO}`)
  const r = hook(MERGE, { cwd: other.repo })
  assert.equal(r.decision, 'allow', r.codes.join())
  const g = readGrant()
  assert.equal(g.used, true)
  assert.match(g.used_by, /gh pr merge 162/)
  assert.deepEqual(hook(MERGE, { cwd: other.repo }).codes, ['gh.need_grant'], 'used up')
})

test('the same grant works in another repository and outside any repository', () => {
  slash(`merge-pr 162 ${REPO}`)
  assert.equal(hook(`${MERGE} -d`, { cwd: other.repo }).decision, 'allow')
  fs.rmSync(ownerGrant)
  slash(`merge-pr 162 ${REPO}`)
  assert.equal(hook(MERGE, { cwd: plain }).decision, 'allow')
})

test('the grant is bound: another repository, PR, head or base is refused and leaves it unused', () => {
  slash(`merge-pr 162 ${REPO}`)
  const cases = {
    'another repository': { url: 'https://github.com/acme/other/pull/162' },
    'another server': { url: 'https://ghe.example.com/acme/widgets/pull/162' },
    'another PR': { number: 163, url: 'https://github.com/acme/widgets/pull/163' },
    'a moved head': { headRefOid: 'b'.repeat(40) },
    'a retargeted base': { baseRefName: 'release/1.0' },
  }
  for (const [name, over] of Object.entries(cases)) {
    assert.deepEqual(hook(MERGE, { overrides: looked(over) }).codes, ['gh.need_grant'], name)
    assert.equal(readGrant().used, false, name)
  }
})

test('the grant ends with its time, and its file cannot carry another action or a time ahead', () => {
  slash(`merge-pr 162 ${REPO}`)
  const g = readGrant()
  const put = (over) => fs.writeFileSync(ownerGrant, JSON.stringify({ ...g, ...over }))
  put({ expires: new Date(Date.now() - 1000).toISOString() })
  assert.deepEqual(hook(MERGE).codes, ['gh.need_grant'])
  put({ action: 'merge-main' })
  assert.deepEqual(hook(MERGE).codes, ['gh.need_grant'])
  put({ created: new Date(Date.now() + 3600000).toISOString() })
  assert.deepEqual(hook(MERGE).codes, ['gh.need_grant'])
  put({ remoteUrl: 'x' })
  assert.deepEqual(hook(MERGE).codes, ['gh.need_grant'])
})

test('a merge the grant does not cover says how to get one, with the PR it found', () => {
  const r = hook('gh pr merge', { cwd: other.repo })
  assert.deepEqual(r.codes, ['gh.need_grant'])
  assert.equal(r.reasons[0].vars.number, 162)
  assert.equal(r.reasons[0].vars.repo, 'github.com/acme/widgets')
  const locale = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/en.json'), 'utf8'))
  assert.match(locale['safety.gh.need_grant.fix'], /lanekeeper-grant merge-pr \{number\} --repo \{repo\}/)
})

test('a merge into a branch that is not protected needs no grant', () => {
  assert.equal(hook(MERGE, { overrides: looked({ baseRefName: 'feature/y' }) }).decision, 'allow')
})

test('two merges on one line are refused, the same PR twice as well', () => {
  slash(`merge-pr 162 ${REPO}`)
  assert.equal(hook(`${MERGE} && ${MERGE}`).decision, 'deny')
  assert.equal(readGrant().used, false)
})

test('a subagent is refused whatever the grant says, and gh api stays refused', () => {
  slash(`merge-pr 162 ${REPO}`)
  assert.deepEqual(hook(MERGE, { agent_id: 'a1', agent_type: 'general-purpose' }).codes, ['gh.lane_merge'])
  assert.equal(readGrant().used, false)
  for (const line of ['gh api -X PUT repos/acme/widgets/pulls/162/merge', `gh api graphql -f query='mutation { mergePullRequest }'`]) assert.deepEqual(hook(line).codes, ['gh.unresolved'], line)
  assert.equal(readGrant().used, false)
})

// ---- what is judged is what gh merges -----------------------------------------------------------

test('the lookup asks gh about the PR the merge names, not the first word without a dash', () => {
  const asked = (line) => {
    fs.rmSync(calls, { force: true })
    hook(line, { overrides: {} })
    return fs.readFileSync(calls, 'utf8').trim()
  }
  assert.match(asked('gh pr merge 162 --repo o/other'), /pr view 162 --repo o\/other --json/)
  assert.match(asked('gh pr merge --repo=o/other 162'), /pr view 162 --repo o\/other --json/)
  assert.match(asked('gh pr merge -R o/other 162'), /pr view 162 --repo o\/other --json/)
  assert.match(asked('gh pr merge -Ro/other 162'), /pr view 162 --repo o\/other --json/)
  assert.match(asked('gh pr --repo o/other merge 162'), /pr view 162 --repo o\/other --json/)
  assert.match(asked('gh pr -R o/other merge 162'), /pr view 162 --repo o\/other --json/)
  assert.match(asked('gh pr merge --subject 5 162'), /pr view 162 --json/)
  assert.match(asked('gh pr merge -t 5 162'), /pr view 162 --json/)
  assert.match(asked('gh pr merge -st 5 162'), /pr view 162 --json/)
  assert.match(asked('gh pr merge --body=5 162'), /pr view 162 --json/)
  assert.match(asked('gh pr merge -- 162'), /pr view 162 --json/)
  assert.match(asked('gh pr merge'), /pr view --json/)
  assert.match(asked('GH_REPO=o/other gh pr merge 162'), /^\[o\/other\] pr view 162 --json/)
  assert.match(asked('env GH_REPO=o/other gh pr merge 162'), /^\[o\/other\] pr view 162 --json/)
})

test('what cannot be read is refused: an unknown option or a second PR', () => {
  for (const line of ['gh pr merge 162 --no-such-option', 'gh pr merge 162 -z', 'gh pr merge 162 163', 'gh pr --no-such-option merge 162']) assert.deepEqual(hook(line).codes, ['gh.unresolved'], line)
})

test('other gh commands are left alone', () => {
  for (const line of ['gh pr view 162 --json url', 'gh pr list', 'gh pr comment 162 --body merge', 'gh pr create --title merge', 'gh repo view']) assert.equal(hook(line).decision, 'allow', line)
})

test('a merge-main grant does not reach a PR at all, in this folder or another repository', () => {
  f.grant('merge-main', HEAD)
  assert.deepEqual(hook('gh pr merge 162 --repo o/other', { overrides: looked({ url: 'https://github.com/o/other/pull/162' }) }).codes, ['gh.need_grant'])
  assert.deepEqual(hook('GH_REPO=o/other gh pr merge 162', { overrides: looked({ url: 'https://github.com/o/other/pull/162' }) }).codes, ['gh.need_grant'])
  assert.deepEqual(hook(MERGE).codes, ['gh.need_grant'])
  assert.equal(f.readGrant().used, false)
})

test('exporting GH_REPO or GH_HOST asks, because the merge after it would go elsewhere', () => {
  for (const line of ['export GH_REPO=o/other', 'export GH_HOST=ghe.example.com']) assert.deepEqual(hook(line).codes, ['paths.git_env'], line)
})

test('realPr gives the fields the grant is bound to', () => {
  const pr = realPr({ cwd: f.repo, env: { PATH: env.PATH } }, { selector: '162', repo: 'o/r' })
  assert.deepEqual(pr, { base: 'main', headOid: HEAD, number: 162, url: URL_162, title: 'fix the grid' })
  assert.match(fs.readFileSync(calls, 'utf8'), /baseRefName,headRefOid,number,url,title/)
})

// ---- the dialog ---------------------------------------------------------------------------------

test('the dialog: allowed, the grant appears and the merge passes; the grant does not exist before that', () => {
  const r = hook(GRANT_LINE, { cwd: plain })
  assert.equal(r.decision, 'ask', r.codes.join())
  assert.deepEqual(r.codes, ['owner.grant_pr'])
  assert.equal(r.reasons[0].vars.repo, 'github.com/acme/widgets')
  assert.equal(r.reasons[0].vars.number, 162)
  assert.equal(r.reasons[0].vars.dest, 'main')
  assert.equal(r.reasons[0].vars.commit, HEAD.slice(0, 9))
  assert.equal(r.reasons[0].vars.title, 'fix the grid')
  assert.ok(!fs.existsSync(ownerGrant), 'declining leaves no grant')
  assert.ok(fs.existsSync(ownerTicket))
  assert.match(r.updatedInput.command, /lanekeeper-grant' merge-pr 162 --repo 'github\.com\/acme\/widgets' --dialog-ticket [0-9a-f]{32}$/)

  const run = runShown(r.updatedInput.command, plain)
  assert.equal(run.status, 0, run.stderr)
  assert.ok(run.stdout.includes(MERGE), 'the agent is told the line to run')
  const g = readGrant()
  assert.equal(g.via, 'dialog')
  assert.equal(g.session, 's1')
  assert.equal(g.ref, KEY)
  assert.equal(hook(MERGE, { cwd: other.repo }).decision, 'allow')
  const log = fs.readFileSync(path.join(f.lanekeeperHome, 'owner', 'owner-decisions.jsonl'), 'utf8')
  assert.match(log, /"action":"merge-pr","via":"dialog"/)
})

test('the dialog: no grant from the command alone, a used ticket or a changed PR', () => {
  const direct = runShown(`'${path.join(ROOT, 'bin/lanekeeper-grant')}' merge-pr 162 ${REPO}`)
  assert.equal(direct.status, 4)
  const forged = runShown(`'${path.join(ROOT, 'bin/lanekeeper-grant')}' merge-pr 162 ${REPO} --dialog-ticket 00`)
  assert.equal(forged.status, 4)
  assert.ok(!fs.existsSync(ownerGrant))

  const first = hook(GRANT_LINE).updatedInput.command
  assert.equal(runShown(first).status, 0)
  fs.rmSync(ownerGrant)
  assert.equal(runShown(first).status, 4, 'a ticket works once')
  assert.ok(!fs.existsSync(ownerGrant))

  for (const over of [{ headRefOid: 'b'.repeat(40) }, { baseRefName: 'release/1.0' }]) {
    const shown = hook(GRANT_LINE).updatedInput.command
    setAnswer(over)
    assert.equal(runShown(shown).status, 4, JSON.stringify(over))
    assert.ok(!fs.existsSync(ownerGrant), JSON.stringify(over))
    setAnswer()
  }
})

test('the dialog is raised only where a person answers it', () => {
  const sub = { agent_id: 'a1', agent_type: 'general-purpose' }
  assert.deepEqual(hook(GRANT_LINE, sub).codes, ['owner.subagent'])
  for (const mode of ['auto', 'plan', 'dontAsk', 'bypassPermissions']) assert.deepEqual(hook(GRANT_LINE, { mode }).codes, ['owner.mode_grant'], mode)
  assert.equal(hook(GRANT_LINE, { mode: 'acceptEdits' }).decision, 'ask')
  const saved = env.CLAUDE_CODE_ENTRYPOINT
  env.CLAUDE_CODE_ENTRYPOINT = 'sdk-cli'
  assert.deepEqual(hook(GRANT_LINE).codes, ['owner.headless'])
  env.CLAUDE_CODE_ENTRYPOINT = saved
  for (const line of [`${GRANT_LINE} && ls`, `cd /tmp && ${GRANT_LINE}`, `X=1 ${GRANT_LINE}`, `${GRANT_LINE} --to main`, `${GRANT_LINE} --remote origin`, 'lanekeeper-grant merge-main x --repo o/r', 'lanekeeper-grant push-main x --repo o/r', 'lanekeeper-grant commit-main --repo o/r', `/x/bin/${GRANT_LINE}`]) {
    assert.ok(hook(line).codes.includes('owner.variant'), `${line}: ${hook(line).codes}`)
  }
  assert.ok(!fs.existsSync(ownerGrant))
})

test('the dialog: a base that is not protected and an unknown PR raise nothing', () => {
  assert.deepEqual(hook(GRANT_LINE, { overrides: looked({ baseRefName: 'feature/y' }) }).codes, ['owner.pr_not_protected'])
  assert.deepEqual(hook(GRANT_LINE, { overrides: { pr: () => null } }).codes, ['owner.pr_unresolved'])
  assert.ok(!fs.existsSync(ownerTicket))
})

test('the dialog: an allow rule for the grant command refuses it, and one for gh pr does not reach it', () => {
  fs.mkdirSync(path.join(f.home, '.claude'), { recursive: true })
  const rule = (r) => fs.writeFileSync(path.join(f.home, '.claude/settings.json'), JSON.stringify({ permissions: { allow: [r] } }))
  rule('Bash(lanekeeper-grant merge-pr *)')
  assert.deepEqual(hook(GRANT_LINE).codes, ['owner.allow_rule'])
  rule('Bash(gh pr *)')
  assert.equal(hook(GRANT_LINE).decision, 'ask')
  assert.deepEqual(hook(MERGE).codes, ['gh.need_grant'], 'the rule does not let the merge through')
})

// ---- the files --------------------------------------------------------------------------------

test('the files of this grant cannot be written by the agent', () => {
  slash(`merge-pr 162 ${REPO}`)
  const dir = path.dirname(ownerGrant)
  for (const file of [ownerGrant, ownerTicket, path.join(dir, 'owner-decisions.jsonl')]) {
    const r = evaluate({ hook_event_name: 'PreToolUse', cwd: f.repo, tool_name: 'Write', tool_input: { file_path: file, content: '{}' } }, env, {})
    assert.deepEqual(r.reasons.map((x) => x.code), ['paths.state'], file)
  }
  for (const line of [`echo '{}' > ${ownerGrant}`, `cp /tmp/x ${ownerGrant}`, `mv /tmp/x ${dir}/`, `cp /tmp/x ${dir}/y`, `rm ${ownerGrant}`, 'cp /tmp/x ~/.lanekeeper/owner/y', 'cd ~/.lanekeeper/owner && cp /tmp/x y', 'mv /tmp/fake ~/.lanekeeper', 'cp -r /tmp/fake/* ~/.lanekeeper/', 'mv ~/.lanekeeper /tmp/old', 'ln -s /tmp/fake ~/.lanekeeper/owner', `python3 -c "open('${ownerGrant}','w')"`]) {
    assert.ok(hook(line).codes.includes('paths.state'), `${line}: ${hook(line).codes}`)
  }
  assert.equal(hook(`cat ${ownerGrant}`).decision, 'allow')
})

test('a nested claude cannot reach merge-pr', () => {
  assert.ok(hook(`claude -p "${GRANT_LINE}"`).codes.includes('approve.model'))
})

// ---- a slash that was left out --------------------------------------------------------------------

test('a typed approve without the slash gets a notice and no grant', () => {
  for (const prompt of ['lanekeeper:approve merge-pr 162', 'lanekeeper:approve merge-main', ' approve merge-main', 'approve merge-pr 162 --repo o/r', 'approve push-main', 'approve commit-main']) {
    const out = promptHint({ prompt, cwd: f.repo }, env)
    assert.match(out?.hookSpecificOutput?.additionalContext ?? '', /lanekeeper-grant/, prompt)
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  }
  assert.ok(!fs.existsSync(ownerGrant))
  assert.ok(!fs.existsSync(sessionGrant))
})

test('other messages get nothing, and the typed slash command is left to its own hook', () => {
  for (const prompt of ['/lanekeeper:approve merge-main', 'please approve merge-main later', 'approve this PR', 'approve', 'merge-main', '']) assert.equal(promptHint({ prompt, cwd: f.repo }, env), null, prompt)
})

test('the notice hook is registered', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8')).hooks
  assert.ok(hooks.UserPromptSubmit.some((h) => h.hooks.some((x) => x.command.endsWith('safety/prompt-hint.mjs'))))
})
