// A guard that protects nothing by stopping is friction. Each test here fixes one place where an agent or
// a person used to be stopped, asked twice or sent to type something, next to the form that must stay
// stopped. Nothing here runs a real gh: the lookup is a function that answers as gh would.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeFixture, git } from './safety-fixture.mjs'
import { evaluate, runHook } from '../hooks/scripts/safety/pretool.mjs'
import { realGit } from '../hooks/scripts/safety/context.mjs'
import { afterFailure } from '../hooks/scripts/safety/grant-restore.mjs'
import { handleApprove } from '../hooks/scripts/safety/approve.mjs'
import { grantPath, ownerDir } from '../hooks/scripts/safety/grant.mjs'

const HEAD = 'a'.repeat(40)
const OTHER = 'c'.repeat(40)
const REPO = 'github.com/acme/widgets'
let f, env, owner

const PRS = { 162: { base: 'main', headOid: HEAD }, 5: { base: 'feature/y', headOid: OTHER } }
const lookup = (t, { selector } = {}) => {
  const n = selector ?? 162
  return PRS[n] ? { ...PRS[n], number: Number(n), url: `https://github.com/acme/widgets/pull/${n}`, title: 't' } : null
}
const payload = (command, { cwd = f.repo, ...rest } = {}) => ({ hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command }, permission_mode: 'default', session_id: 's1', ...rest })
const judge = (command, opts = {}) => {
  const r = evaluate(payload(command, opts), env, { pr: lookup })
  return { ...r, codes: r.reasons.map((x) => x.code) }
}
const line = (r) => r.reasons[0].vars.line
const prGrant = (over = {}) => {
  const now = Date.now()
  fs.mkdirSync(owner, { recursive: true })
  fs.writeFileSync(grantPath(owner), JSON.stringify({ version: 1, action: 'merge-pr', ref: `${REPO}#162`, head: HEAD, dest: 'main', created: new Date(now - 1000).toISOString(), expires: new Date(now + 600000).toISOString(), used: false, ...over }))
}
const readPrGrant = () => JSON.parse(fs.readFileSync(grantPath(owner), 'utf8'))
const failed = (command, rest = {}) => afterFailure({ tool_name: 'Bash', cwd: f.repo, tool_input: { command }, ...rest }, env)

before(() => {
  f = makeFixture()
  git(f.repo, 'remote', 'add', 'origin', `https://${REPO}.git`)
  env = { ...f.env, CLAUDE_CODE_ENTRYPOINT: 'cli' }
  owner = ownerDir(f.lanekeeperHome)
})
after(() => f.cleanup())
beforeEach(() => {
  f.clearGrant()
  f.clearProjectConfig()
  fs.rmSync(owner, { recursive: true, force: true })
  fs.rmSync(path.join(f.state, 'lanekeeper-gate-pass.json'), { force: true })
  fs.rmSync(path.join(f.state, 'owner-ticket.json'), { force: true })
})

// ---- no need_ref: the blocked command names its own grant ------------------------------------------

function onSideBranch(name, run) {
  git(f.repo, 'branch', name, 'feature/x')
  const wt = path.join(f.base, `wt-${name.replace('/', '-')}`)
  git(f.repo, 'worktree', 'add', '-q', wt, name)
  fs.writeFileSync(path.join(wt, 'side.txt'), 's\n')
  git(wt, 'add', '.')
  git(wt, 'commit', '-q', '-m', 'side')
  try {
    run(wt)
  } finally {
    git(f.repo, 'worktree', 'remove', '--force', wt)
    git(f.repo, 'branch', '-D', name)
  }
}

test('a blocked merge names the line that raises its dialog, for a branch of any name', () => {
  onSideBranch('next/int', () => {
    const r = judge('git merge next/int')
    assert.deepEqual(r.codes, ['grant.missing'])
    assert.equal(line(r), 'lanekeeper-grant merge-main next/int --to main')
    assert.equal(judge(line(r)).decision, 'ask', 'that line raises the dialog and does not end in need_ref')
  })
})

test('a blocked push names the commit, the destination and the remote', () => {
  const r = judge('git push origin main')
  assert.deepEqual(r.codes, ['grant.missing'])
  assert.equal(line(r), 'lanekeeper-grant push-main main --to main --remote origin')
  assert.equal(judge(line(r)).decision, 'ask')
})

test('a push to an address names that address, and the dialog takes it with no typing', () => {
  const r = judge('git push https://github.com/acme/widgets.git main')
  assert.equal(line(r), 'lanekeeper-grant push-main main --to main --remote https://github.com/acme/widgets.git')
  assert.equal(judge(line(r)).decision, 'ask')
})

test('a blocked commit names its line, and the message asks the owner for no typing', () => {
  const r = judge('git commit -m x')
  assert.equal(line(r), 'lanekeeper-grant commit-main')
  assert.equal(judge(line(r)).decision, 'ask')
  assert.doesNotMatch(runHook(JSON.stringify(payload('git commit -m x')), env), /lanekeeper:approve commit-main/)
})

test('a source that is not a plain word goes by its commit', () => {
  const r = judge('git merge feature/x~0')
  assert.equal(line(r), `lanekeeper-grant merge-main ${f.sha('feature/x')} --to main`)
})

test('a blocked command in another worktree says which folder the line runs in', () => {
  const r = judge(`git -C ${f.repo} commit -m x`, { cwd: f.wt.feat })
  assert.equal(r.reasons[0].vars.where, f.repo)
})

test('no ref: the branch checked out is the source, whatever its name', () => {
  onSideBranch('next/int', (wt) => {
    const r = judge('lanekeeper-grant merge-main', { cwd: wt })
    assert.equal(r.decision, 'ask')
    assert.equal(r.reasons[0].vars.ref, 'next/int')
  })
})

test('no ref on the protected branch: the integration branch of the ledger', () => {
  assert.equal(judge('lanekeeper-grant merge-main').decision, 'ask')
})

test('no ref, several waiting: the refusal lists them instead of asking the owner', () => {
  const lanes = path.join(f.state, 'lanes.json')
  const saved = fs.readFileSync(lanes, 'utf8')
  fs.writeFileSync(lanes, '{"lanes":[]}')
  try {
    onSideBranch('next/a', () => {
      onSideBranch('next/b', () => {
        const r = judge('lanekeeper-grant merge-main')
        assert.deepEqual(r.codes, ['owner.need_ref'])
        assert.match(r.reasons[0].vars.candidates, /next\/a/)
        assert.match(r.reasons[0].vars.candidates, /next\/b/)
      })
      assert.equal(judge('lanekeeper-grant merge-main').decision, 'ask', 'one branch waiting is the source')
    })
  } finally {
    fs.writeFileSync(lanes, saved)
  }
})

test('when a person has to type, the slash command carries the same target', () => {
  const r = judge('lanekeeper-grant merge-main feature/x --to main', { permission_mode: 'auto' })
  assert.deepEqual(r.codes, ['owner.mode_grant'])
  assert.equal(r.reasons[0].vars.slash, '/lanekeeper:approve merge-main feature/x --to main')
})

// ---- one dialog per decision ---------------------------------------------------------------------

test('a form no grant can pass is said before any dialog', () => {
  assert.deepEqual(judge('git commit -a -m x').codes, ['grant.commit_rebuild'])
  assert.deepEqual(judge('git commit --amend').codes, ['grant.commit_amend'])
  assert.deepEqual(judge('git commit a.txt -m x').codes, ['grant.commit_paths'])
  assert.deepEqual(judge('git -c core.hooksPath=/tmp/h commit -m x').codes, ['grant.config'])
  assert.deepEqual(judge('git -c core.sshCommand=x push origin main').codes, ['grant.config'])
})

test('a line that has to be split says so first, with no talk of a grant', () => {
  assert.deepEqual(judge('git add a.txt && git commit -m x').codes, ['grant.commit_alone'])
  assert.deepEqual(judge('git commit -m x && git push origin main').codes, ['grant.once'])
})

test('with a gate set, a missing stamp comes before the grant, and no dialog opens for it', () => {
  f.projectConfig({ gate: { command: 'true' } })
  assert.deepEqual(judge('git merge feature/x').codes, ['stamp.missing'])
  const r = judge('lanekeeper-grant merge-main feature/x --to main')
  assert.equal(r.decision, 'deny')
  assert.deepEqual(r.codes, ['stamp.missing'])
  assert.equal(r.updatedInput, undefined)
  assert.ok(!fs.existsSync(path.join(f.state, 'owner-ticket.json')), 'no ticket for a dialog that never opened')
})

test('with the stamp there, the dialog opens and the merge asks for the grant', () => {
  f.projectConfig({ gate: { command: 'true' } })
  f.stamp(f.sha('feature/x'))
  assert.deepEqual(judge('git merge feature/x').codes, ['grant.missing'])
  assert.equal(judge('lanekeeper-grant merge-main feature/x --to main').decision, 'ask')
})

// ---- gh pr merge -----------------------------------------------------------------------------------

test('a plain merge of an unprotected PR runs at once as the line with everything written out', () => {
  for (const [plain, method] of [['gh pr merge 5', '--squash'], ['gh pr merge 5 --rebase', '--rebase'], ['gh pr merge 5 -m -d', '--merge -d'], ['gh pr merge 5 --repo acme/widgets --squash --delete-branch', '--squash -d']]) {
    const r = judge(plain)
    assert.equal(r.decision, 'allow', plain)
    assert.equal(r.updatedInput.command, `gh pr merge 5 --repo ${REPO} --match-head-commit ${OTHER} ${method}`, plain)
  }
})

test('the changed line goes through the normal permission flow, and the agent is told', () => {
  const out = JSON.parse(runHook(JSON.stringify(payload('gh pr merge 5')), env, { pr: lookup }))
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, 'no decision, so rules and prompts judge the new line')
  assert.match(out.hookSpecificOutput.updatedInput.command, /^gh pr merge 5 --repo /)
  assert.match(out.hookSpecificOutput.additionalContext, /gh pr merge 5 --repo /)
})

test('after the dialog the plain line spends the grant, with no second refusal', () => {
  prGrant()
  const r = judge('gh pr merge 162 --squash')
  assert.equal(r.decision, 'allow')
  assert.equal(r.updatedInput.command, `gh pr merge 162 --repo ${REPO} --match-head-commit ${HEAD} --squash`)
  assert.equal(readPrGrant().used, true)
  assert.equal(readPrGrant().used_line, r.updatedInput.command)
})

test('the written-out line without a method gets one, so the grant is not spent on an error', () => {
  prGrant()
  assert.equal(judge(`gh pr merge 162 --repo ${REPO} --match-head-commit ${HEAD}`).updatedInput.command, `gh pr merge 162 --repo ${REPO} --match-head-commit ${HEAD} --squash`)
})

test('the written-out line with a method runs as it is', () => {
  prGrant()
  const r = judge(`gh pr merge 162 --repo ${REPO} --match-head-commit ${HEAD} --merge`)
  assert.equal(r.decision, 'allow')
  assert.equal(r.updatedInput, undefined)
  assert.equal(readPrGrant().used, true)
})

test('without a grant the plain line still needs one', () => {
  const r = judge('gh pr merge 162')
  assert.deepEqual(r.codes, ['gh.need_grant'])
  assert.equal(r.updatedInput, undefined)
})

test('anything beside the merge keeps it from being changed, and the grant stays', () => {
  prGrant()
  for (const l of ['cd "$X" && gh pr merge 162', 'GH_REPO=o/x gh pr merge 162', 'gh pr merge 162; echo x', `gh pr merge 162 --match-head-commit ${OTHER}`, 'gh pr merge 162 --admin', 'gh pr merge 162 --auto', 'gh pr merge 162 --squash --merge', 'bash -c "gh pr merge 162"', 'gh pr merge 162 | tee x', 'sleep 1\ngh pr merge 162']) {
    const r = judge(l)
    assert.equal(r.decision, 'deny', l)
    assert.equal(r.updatedInput, undefined, l)
    assert.equal(readPrGrant().used, false, l)
  }
})

test('an empty word does not hide a subcommand', () => {
  for (const l of ['gh "" pr merge', 'gh "" pr merge --squash', "gh '' pr merge -s", 'gh "" pr merge --repo other/secret', 'gh pr "" merge 5', 'gh "" repo sync --force', 'gh repo "" sync --force', 'gh "" api x', 'gh "" alias set a b']) assert.deepEqual(judge(l).codes, ['gh.unresolved'], l)
  assert.equal(judge('gh pr view 5').decision, 'allow')
  assert.equal(judge('gh --version').decision, 'allow')
})

test('a remote through ssh.github.com is the same repository, so its unprotected PR needs no grant', () => {
  const dir = path.join(f.base, 'ssh443')
  fs.mkdirSync(dir)
  git(dir, 'init', '-q')
  git(dir, 'remote', 'add', 'origin', `ssh://${['git', 'ssh.github.com'].join('@')}:443/acme/widgets.git`)
  assert.ok(realGit.remoteAddresses({ cwd: dir, globalOpts: [], env: {} }).includes(REPO))
  assert.equal(judge(`gh pr merge 5 --repo ${REPO}`, { cwd: dir }).decision, 'allow')
})

// ---- a failed command does not use up the grant ------------------------------------------------------

test('the line a grant was spent on failed: the grant is back, once, for the same target', () => {
  prGrant()
  const r = judge('gh pr merge 162')
  assert.equal(readPrGrant().used, true)
  assert.match(failed(r.updatedInput.command).hookSpecificOutput.additionalContext, /\[lanekeeper\]/)
  const g = readPrGrant()
  assert.equal(g.used, false)
  assert.equal(g.head, HEAD)
  assert.equal(g.used_line, undefined)
  assert.equal(failed(r.updatedInput.command), null, 'nothing to bring back the second time')
})

test('a failed commit keeps its grant in the repository too', () => {
  f.grant('commit-main', f.sha('main'))
  assert.equal(judge('git commit -m x').decision, 'allow')
  assert.equal(f.readGrant().used, true)
  failed('git commit -m x')
  assert.equal(f.readGrant().used, false)
})

test('another line, a chain, a subagent or an expired grant brings nothing back', () => {
  prGrant({ used: true, used_line: 'gh pr merge 1' })
  assert.equal(failed('gh pr merge 2'), null)
  assert.equal(failed('gh pr merge 1', { agent_id: 'a1' }), null)
  prGrant({ used: true, used_line: 'gh pr merge 1 && false' })
  assert.equal(failed('gh pr merge 1 && false'), null)
  prGrant({ used: true, used_line: 'git push origin main; false' })
  assert.equal(failed('git push origin main; false'), null)
  prGrant({ used: true, used_line: 'gh pr merge 1', expires: new Date(Date.now() - 1000).toISOString() })
  assert.equal(failed('gh pr merge 1'), null)
  assert.equal(readPrGrant().used, true)
})

// ---- commands that cannot reach the grant folder --------------------------------------------------

test('everyday commands on files in the home folder pass', () => {
  for (const l of ['rm -f ~/*.tmp', 'cp ~/*.txt /tmp/', 'mv a.txt ~/', 'cp -R dist ~/', 'cp -av dist ~/', 'mv build ~', 'rsync -a dist ~/', 'rsync -avz dist ~/', 'cp ~/report?.txt /tmp/']) assert.equal(judge(l).decision, 'allow', `${l}: ${judge(l).codes}`)
})

test('what can come out as the grant folder is still refused, in words that say why', () => {
  const lines = ['mv .lanekeeper ~/', 'cp -R .LANEKEEPER ~/', 'cp -R tree/. ~', 'cp -R tree/ ~/', 'cp -R $X ~/', 'cp -R tr* ~/', 'ditto tree ~', 'rsync -a tree/ ~/', 'rsync -aR x/.lanekeeper/y ~/', 'cp --parents -R x/.lanekeeper/y ~/', 'cp --parents -R x/y ~/', 'cp -RT tree ~', 'rsync -a --files-from=list tree ~/', 'rsync -aR tree ~/', 'cp -R a/.. ~/', 'rm -f ~/*', 'cp x ~/.l*', 'cp x ~/*/owner/y', 'cp -R x ~/.lanekeeper', 'mv x ~/.lanekeeper']
  for (const l of lines) {
    const r = judge(l)
    assert.equal(r.decision, 'deny', l)
    assert.ok(r.codes.some((c) => ['paths.reach', 'paths.state'].includes(c)), `${l}: ${r.codes}`)
  }
  assert.deepEqual(judge('cp -R tree/ ~/').codes, ['paths.reach'])
})

test('a copy into a folder above the home takes the source name into account', () => {
  const name = path.basename(f.home)
  assert.equal(judge(`cp -R ${name} ${path.dirname(f.home)}/`).decision, 'deny')
  assert.equal(judge(`cp -R other ${path.dirname(f.home)}/`).decision, 'allow')
})

// ---- questions with nothing to decide ---------------------------------------------------------------

test('branch -d, which git refuses for an unmerged branch, asks nothing', () => {
  assert.equal(judge('git branch -d feature/x').decision, 'allow')
  assert.equal(judge('git branch --delete -q feature/x').decision, 'allow')
  assert.deepEqual(judge('git branch -D feature/x').codes, ['git.branch_delete'])
  assert.deepEqual(judge('git branch -d -f feature/x').codes, ['git.branch_delete'])
  assert.deepEqual(judge('git branch -m feature/x feature/z').codes, ['git.branch_delete'])
  assert.deepEqual(judge('git branch -d main').codes, ['git.branch_protected'])
  assert.deepEqual(judge('git branch -d feature/x', { agent_id: 'agent-l1', cwd: f.wt.l1 }).codes, ['git.branch_delete'], 'a lane still asks')
})

test('reset --hard asks only when something could be lost', () => {
  onSideBranch('next/reset', (wt) => {
    const tip = f.sha('HEAD', wt)
    assert.equal(judge('git reset --hard', { cwd: wt }).decision, 'allow', 'a clean tree')
    assert.deepEqual(judge('git reset --hard feature/x', { cwd: wt }).codes, ['git.reset_hard'], 'a commit would leave the branch')
    assert.deepEqual(judge('git reset --hard HEAD~1', { cwd: wt }).codes, ['git.reset_hard'])
    assert.deepEqual(judge('touch b && git reset --hard', { cwd: wt }).codes, ['git.reset_hard'], 'something on the same line can change the tree')
    git(wt, 'reset', '-q', '--hard', 'HEAD~1')
    assert.equal(judge(`git reset --hard ${tip}`, { cwd: wt }).decision, 'allow', 'moving forward loses nothing')
    fs.writeFileSync(path.join(wt, 'a.txt'), 'changed\n')
    assert.deepEqual(judge(`git reset --hard ${tip}`, { cwd: wt }).codes, ['git.reset_hard'], 'an uncommitted change')
    git(wt, 'checkout', '-q', '--', 'a.txt')
    fs.writeFileSync(path.join(wt, 'new.txt'), 'n\n')
    assert.deepEqual(judge('git reset --hard', { cwd: wt }).codes, ['git.reset_hard'], 'an untracked file')
  })
  assert.deepEqual(judge('git reset --hard').codes, ['git.reset_hard'], 'a protected branch always asks')
})
