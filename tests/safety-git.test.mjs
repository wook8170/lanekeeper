// git-guard: every cell of the actor x branch x action table (design 3.3),
// owner grants and gate stamps.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeFixture, git } from './safety-fixture.mjs'

let f
before(() => {
  f = makeFixture()
})
after(() => f.cleanup())
beforeEach(() => {
  f.clearGrant()
  f.clearProjectConfig()
  fs.rmSync(path.join(f.state, 'lanekeeper-gate-pass.json'), { force: true })
  fs.rmSync(path.join(f.state, 'gate.lock'), { force: true })
})

const expect = (r, decision, code) => {
  assert.equal(r.decision, decision, JSON.stringify(r.codes))
  if (code) assert.ok(r.codes.includes(code), `expected ${code}, got ${JSON.stringify(r.codes)}`)
}
const lane = (cmd, cwd) => f.judge(cmd, { cwd: cwd || f.wt.l1, agent: 'agent-l1' })
const main = (cmd, cwd) => f.judge(cmd, { cwd: cwd || f.repo })

// ── lane · own branch ────────────────────────────────────────────────
test('lane own branch: commit allowed', () => expect(lane('git commit -m x'), 'allow'))
test('lane own branch: cherry-pick / revert count as commits and are allowed', () => {
  expect(lane('git cherry-pick abc'), 'allow')
  expect(lane('git revert --no-edit HEAD'), 'allow')
})
test('lane own branch: merging or rebasing the integration branch is allowed', () => {
  expect(lane('git merge lanekeeper/t/int'), 'allow')
  expect(lane('git rebase lanekeeper/t/int'), 'allow')
  expect(lane('git rebase origin/lanekeeper/t/int'), 'allow')
  expect(lane('git pull origin lanekeeper/t/int'), 'allow')
  expect(lane('git rebase --continue'), 'allow')
})
test('lane own branch: merging anything else is blocked', () => {
  expect(lane('git merge feature/x'), 'deny', 'git.lane_merge')
  expect(lane('git rebase main'), 'deny', 'git.lane_merge')
  expect(lane('git pull'), 'deny', 'git.lane_merge') // no upstream → not the integration branch
})
test('lane own branch: push of any kind is blocked', () => {
  expect(lane('git push'), 'deny', 'git.lane_push')
  expect(lane('git push origin lanekeeper/t/l1'), 'deny', 'git.lane_push')
  expect(lane('git push --force-with-lease origin lanekeeper/t/l1'), 'deny', 'git.lane_push')
})
test('lane own branch: gh pr merge is blocked', () => expect(lane('gh pr merge 12 --squash'), 'deny', 'gh.lane_merge'))
test('lane own branch: switching branch is blocked, restoring files is not', () => {
  expect(lane('git checkout main'), 'deny', 'git.lane_switch')
  expect(lane('git switch feature/x'), 'deny', 'git.lane_switch')
  expect(lane('git checkout -b other'), 'deny', 'git.lane_switch')
  expect(lane('git checkout -- a.txt'), 'allow')
  expect(lane('git checkout a.txt'), 'allow')
})
test('lane own branch: unnamed stash asks, named stash passes', () => {
  expect(lane('git stash'), 'ask', 'git.stash')
  expect(lane('git stash pop'), 'ask', 'git.stash')
  expect(lane('git stash push -u -m "l1-wip"'), 'allow')
  expect(lane('git stash list'), 'allow')
})

// ── lane · anything else ─────────────────────────────────────────────
test('lane elsewhere: commit in the main checkout, integration or another lane is blocked', () => {
  expect(lane('git commit -m x', f.repo), 'deny', 'git.lane_commit')
  expect(lane('git commit -m x', f.wt.int), 'deny', 'git.lane_commit')
  expect(lane('git commit -m x', f.wt.l2), 'deny', 'git.lane_commit')
  expect(lane('git commit -m x', f.wt.feat), 'deny', 'git.lane_commit')
})
test('lane elsewhere: merge / rebase blocked even from the integration branch', () => {
  expect(lane('git merge lanekeeper/t/int', f.wt.l2), 'deny', 'git.lane_merge')
  expect(lane('git merge lanekeeper/t/l1', f.wt.int), 'deny', 'git.lane_merge')
})
test('lane elsewhere: push, gh merge, switch blocked; stash asks', () => {
  expect(lane('git push origin main', f.repo), 'deny', 'git.lane_push')
  expect(lane('gh pr merge 1', f.repo), 'deny', 'gh.lane_merge')
  expect(lane('git switch lanekeeper/t/l1', f.wt.l2), 'deny', 'git.lane_switch')
  expect(lane('git stash', f.repo), 'ask', 'git.stash')
})
test('lane without agent_id: identified by the lane ledger worktree path', () => {
  expect(main('git commit -m x', f.wt.l2), 'allow') // l2 is its own worktree in the ledger
  expect(main('git push', f.wt.l2), 'deny', 'git.lane_push')
})
test('lane with an unregistered agent id still counts as a lane', () => {
  expect(f.judge('git push origin feature/x', { cwd: f.wt.feat, agent: 'someone' }), 'deny')
  expect(f.judge('git commit -m x', { cwd: f.repo, agent: 'someone' }), 'deny')
})

// ── main · integration and feature branches ──────────────────────────
test('main on integration/feature: commit allowed', () => {
  expect(main('git commit -m x', f.wt.int), 'allow')
  expect(main('git commit -m x', f.wt.feat), 'allow')
})
test('main on integration: merge allowed without a gate lock, blocked with one', () => {
  expect(main('git merge lanekeeper/t/l1', f.wt.int), 'allow')
  fs.writeFileSync(path.join(f.state, 'gate.lock'), '')
  expect(main('git merge lanekeeper/t/l1', f.wt.int), 'deny', 'git.gate_locked')
})
test('main on integration/feature: push follows project.git.feature_push', () => {
  expect(main('git push origin lanekeeper/t/int', f.wt.int), 'ask', 'git.push_feature')
  // settings come from the session's project (.lanekeeper/config.json is committed, so every worktree has it)
  f.projectConfig({ git: { feature_push: 'allow' } })
  expect(main(`git -C ${f.wt.feat} push origin feature/x`), 'allow')
  f.projectConfig({ git: { feature_push: 'deny' } })
  expect(main(`git -C ${f.wt.feat} push origin feature/x`), 'deny', 'git.push_feature_denied')
})
test('main on any branch: force push is blocked', () => {
  for (const c of ['git push -f origin feature/x', 'git push --force origin feature/x', 'git push --force-with-lease', 'git push origin +feature/x', 'git push -uf origin feature/x', 'git push --force-if-includes']) {
    expect(main(c, f.wt.feat), 'deny', 'git.force_push')
  }
  expect(main('git push -f origin main'), 'deny', 'git.force_push')
})
test('main: --all / --mirror push and deleting a protected branch are blocked', () => {
  expect(main('git push --all origin', f.wt.feat), 'deny', 'git.push_all')
  expect(main('git push --mirror origin', f.wt.feat), 'deny', 'git.push_all')
  expect(main('git push origin :main', f.wt.feat), 'deny', 'git.branch_protected')
  expect(main('git push origin --delete release/1.0', f.wt.feat), 'deny', 'git.branch_protected')
})
test('main: gh pr merge into a non-protected base is allowed, into a protected base needs a PR grant', () => {
  const head = f.sha('lanekeeper/t/int')
  const pr = (base) => ({ pr: () => ({ base, headOid: head, number: 3, url: 'https://github.com/o/r/pull/3' }) })
  const line = `gh pr merge 3 --repo github.com/o/r --match-head-commit ${head} --squash`
  git(f.repo, 'remote', 'add', 'origin', 'https://github.com/o/r.git')
  try {
    expect(f.judge(line, { cwd: f.wt.feat, overrides: pr('feature/y') }), 'allow')
    expect(f.judge('gh pr merge 3', { cwd: f.wt.feat, overrides: pr('feature/y') }), 'allow')
    expect(f.judge('gh pr merge 3; true', { cwd: f.wt.feat, overrides: pr('feature/y') }), 'deny', 'gh.form')
    expect(f.judge(line, { cwd: f.repo, overrides: pr('main') }), 'deny', 'gh.need_grant')
    f.grant('merge-main', head)
    expect(f.judge(line, { cwd: f.repo, overrides: pr('main') }), 'deny', 'gh.need_grant')
    assert.equal(f.readGrant().used, false)
    expect(f.judge('gh pr merge 3', { cwd: f.repo, overrides: { pr: () => null } }), 'deny', 'gh.unresolved')
  } finally {
    git(f.repo, 'remote', 'remove', 'origin')
  }
})
test('main on integration/feature: switching branch is allowed', () => {
  expect(main('git checkout feature/x', f.wt.int), 'allow')
  expect(main('git switch -c new-topic', f.wt.feat), 'allow')
})
test('main: unnamed stash, reset --hard, clean -f ask; branch -D asks; protected branch edits blocked', () => {
  expect(main('git stash', f.wt.feat), 'ask', 'git.stash')
  expect(main('git reset --hard HEAD~1', f.wt.feat), 'ask', 'git.reset_hard')
  expect(main('git clean -fdx', f.wt.feat), 'ask', 'git.clean')
  expect(main('git branch -D feature/y', f.wt.feat), 'ask', 'git.branch_delete')
  expect(main('git branch -D main', f.wt.feat), 'deny', 'git.branch_protected')
  expect(main('git branch -f release/1.0 HEAD', f.wt.feat), 'deny', 'git.branch_protected')
  expect(main('git checkout -B main', f.wt.feat), 'deny', 'git.branch_protected')
  expect(main('git update-ref refs/heads/main HEAD', f.wt.feat), 'deny', 'git.branch_protected')
})

// ── main · protected branch ──────────────────────────────────────────
test('main on protected: commit blocked without a grant, allowed once with commit-main', () => {
  expect(main('git commit -m x'), 'deny', 'grant.missing')
  f.grant('commit-main', f.sha('HEAD'))
  expect(main('git commit -m x'), 'allow')
  assert.equal(f.readGrant().used, true)
  expect(main('git commit -m x'), 'deny', 'grant.used')
})
test('main on protected: merge blocked without a grant, allowed with merge-main on the source commit', () => {
  expect(main('git merge lanekeeper/t/int'), 'deny', 'grant.missing')
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  expect(main('git merge --no-ff lanekeeper/t/int'), 'allow')
})
test('main on protected: a gate stamp for the same commit is required when a gate command is set', () => {
  f.projectConfig({ gate: { command: 'npm test' } })
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int'), 'deny', 'stamp.missing')
  assert.equal(f.readGrant().used, false, 'a blocked call does not spend the grant')
  f.stamp('0000000000000000000000000000000000000000')
  expect(main('git merge lanekeeper/t/int'), 'deny', 'stamp.head')
  f.stamp(f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int'), 'allow')
})
test('main on protected: rebase / pull from another branch needs a grant; syncing with its own upstream does not', () => {
  expect(main('git rebase lanekeeper/t/int'), 'deny', 'grant.missing')
  expect(main('git pull origin lanekeeper/t/int'), 'deny', 'grant.missing')
  expect(main('git pull'), 'allow')
  expect(main('git pull --ff-only'), 'allow')
  expect(main('git merge --ff-only origin/main'), 'allow')
  expect(main('git merge lanekeeper/t/int feature/x'), 'deny', 'git.main_merge')
})
test('main on protected: push needs push-main for the pushed commit (and stamp when gated)', () => {
  expect(main('git push origin main'), 'deny', 'grant.missing')
  expect(main('git push'), 'deny', 'grant.missing')
  f.grant('push-main', f.sha('main'))
  expect(main('git push origin main'), 'allow')
  expect(main('git push origin main'), 'deny', 'grant.used')
  // pushing another branch onto a protected one: the grant is for the source commit
  f.grant('push-main', f.sha('main'))
  git(f.wt.int, 'commit', '-q', '--allow-empty', '-m', 'int moves')
  expect(main('git push origin lanekeeper/t/int:main', f.wt.int), 'deny', 'grant.head')
  f.grant('push-main', f.sha('lanekeeper/t/int'))
  expect(main('git push origin lanekeeper/t/int:main', f.wt.int), 'allow')
})
test('main on protected: force push is blocked even with a grant', () => {
  f.grant('push-main', f.sha('main'))
  expect(main('git push --force origin main'), 'deny', 'git.force_push')
  assert.equal(f.readGrant().used, false)
})
test('main on protected: switching is allowed, stash asks', () => {
  expect(main('git checkout feature/x'), 'allow')
  expect(main('git stash'), 'ask', 'git.stash')
})

// ── grant lifecycle ──────────────────────────────────────────────────
test('grant: expired, wrong action, moved HEAD are each refused', () => {
  f.grant('merge-main', f.sha('lanekeeper/t/int'), { minutes: -1 })
  expect(main('git merge lanekeeper/t/int'), 'deny', 'grant.expired')
  f.grant('push-main', f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int'), 'deny', 'grant.action')
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  git(f.wt.int, 'commit', '-q', '--allow-empty', '-m', 'moved after grant')
  expect(main('git merge lanekeeper/t/int'), 'deny', 'grant.head')
})
test('grant: not spent when another part of the same command is blocked', () => {
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int && git push -f origin main'), 'deny', 'git.force_push')
  assert.equal(f.readGrant().used, false)
  expect(main('git merge lanekeeper/t/int'), 'allow')
  assert.equal(f.readGrant().used, true)
})
test('grant: one grant covers one action — merge then push needs two', () => {
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  expect(main('git merge lanekeeper/t/int && git push origin main'), 'deny', 'grant.once')
})
test('grant: an owner grant does not help a lane', () => {
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  expect(lane('git merge lanekeeper/t/int', f.repo), 'deny', 'git.lane_merge')
  expect(lane('git push origin main', f.repo), 'deny', 'git.lane_push')
})

// ── branch switches inside one command line (C2 · C3) ─────────────────
test('chain: checkout/switch to a protected branch, then merge or commit, is judged on the protected branch', () => {
  // main session on the feature worktree; the next command would run on main
  expect(main('git checkout main && git merge feature/x', f.wt.feat), 'deny', 'grant.missing')
  expect(main('git switch main; git commit --allow-empty -m x', f.wt.feat), 'deny', 'grant.commit_alone')
  expect(main('git switch release/1.0 && git commit -m x', f.wt.feat), 'deny', 'grant.commit_alone')
})
test('chain: switching away from a protected branch lets later commands run on the new branch', () => {
  expect(main('git switch -c topic/new && git commit -m x', f.repo), 'allow')
})
test('chain: a switch to an unknown target (git switch -) makes later guarded git commands unresolved', () => {
  expect(main('git switch - && git commit -m x', f.wt.feat), 'deny', 'git.unresolved')
})
test('chain: restoring a file with checkout does not move the branch', () => {
  expect(main('git checkout -- a.txt && git commit -m x', f.wt.feat), 'allow')
})

// ── one grant, one change, one destination ───────────────────────────
test('grant: chained changes under one grant are refused, whichever way they are joined', () => {
  for (const line of ['git commit -m a && git commit -m b', 'git commit -m a; git commit -m b', 'git commit -m a || git commit -m b', 'git commit -m a\ngit commit -m b', '(git commit -m a); git commit -m b']) {
    f.grant('commit-main', f.sha('HEAD'))
    expect(main(line), 'deny', 'grant.once')
    assert.equal(f.readGrant().used, false)
  }
  f.grant('push-main', f.sha('main'))
  expect(main('git push origin main && git push origin main:release/1.0'), 'deny', 'grant.once')
  expect(main('git push origin main main:release/1.0'), 'deny', 'grant.once')
  assert.equal(f.readGrant().used, false)
})
test('grant: a push or merge to another protected branch than the grant is refused', () => {
  f.grant('push-main', f.sha('main'))
  expect(main('git push origin main:release/1.0'), 'deny', 'grant.dest')
  assert.equal(f.readGrant().used, false)
  expect(main('git push origin main'), 'allow')
  f.grant('merge-main', f.sha('lanekeeper/t/int'), { dest: 'release/1.0' })
  expect(main('git merge lanekeeper/t/int'), 'deny', 'grant.dest')
  f.grant('merge-main', f.sha('lanekeeper/t/int'))
  expect(main('git switch release/1.0 && git merge lanekeeper/t/int'), 'deny', 'grant.dest')
})
test('commit form: a plain commit passes, the forms that do not use the staged content are refused', () => {
  f.grant('commit-main', f.sha('HEAD'))
  expect(main('git commit -am x'), 'deny', 'grant.commit_rebuild')
  expect(main('git commit a.txt -m x'), 'deny', 'grant.commit_paths')
  expect(main('git commit --amend -m x'), 'deny', 'grant.commit_amend')
  expect(main('git cherry-pick abc'), 'deny', 'grant.commit_other')
  assert.equal(f.readGrant().used, false)
  expect(main('git commit -m x'), 'allow')
})

// ── round 3: destinations, remotes and the shape of a grant ─────────
test('push: a destination the command line does not show counts as --all', () => {
  for (const c of ["git push origin 'refs/heads/*:refs/heads/*'", 'git push origin :', 'git -c push.default=matching push origin', 'git -c remote.origin.push=+refs/heads/main:refs/heads/main push origin']) expect(main(c, f.wt.feat), 'deny', 'git.push_all')
})
test('push: a grant holds the remote address', () => {
  f.grant('push-main', f.sha('main'))
  expect(main('git push upstream main'), 'deny', 'grant.remote')
  assert.equal(f.readGrant().used, false)
  expect(main('git push origin main'), 'allow')
})
test('grant: a function called twice and a push with the tags count as two', () => {
  f.grant('push-main', f.sha('main'))
  expect(main('f(){ git push origin main; }; f; f'), 'deny', 'grant.once')
  expect(main('git push origin --tags main'), 'deny', 'grant.once')
  assert.equal(f.readGrant().used, false)
})
test('grant: a file in a shape this code never writes is refused', () => {
  f.grant('push-main', f.sha('main'))
  const file = path.join(f.state, 'owner-grant.json')
  fs.writeFileSync(file, JSON.stringify({ ...f.readGrant(), version: 2 }))
  expect(main('git push origin main'), 'deny', 'grant.format')
})
test('gh api: a merge is found with the method written together', () => {
  expect(main('gh api -XPUT repos/o/r/pulls/1/merge'), 'deny', 'gh.unresolved')
  expect(main('gh api --method=PUT repos/o/r/pulls/1/merge'), 'deny', 'gh.unresolved')
})

test('push: heads/ in a destination is the protected branch', () => {
  for (const c of ['git push origin HEAD:heads/main', 'git push origin main:heads/main', 'git push origin HEAD:heads/release/1.0']) expect(main(c), 'deny', 'grant.missing')
  expect(main('git push origin feature/x:heads/main', f.wt.feat), 'deny', 'grant.missing')
})
test('push: a dry run and a remote-tracking destination use no grant', () => {
  f.grant('push-main', f.sha('main'))
  assert.notEqual(main('git push origin main --dry').decision, 'deny')
  assert.notEqual(main('git push origin HEAD:refs/remotes/origin/main').decision, 'deny')
  assert.equal(f.readGrant().used, false)
})

test('push: remote.<name>.push decides a refspec without :, so it is refused', () => {
  git(f.wt.feat, 'config', 'remote.origin.push', 'refs/heads/feature/x:refs/heads/main')
  try {
    expect(main('git push origin feature/x', f.wt.feat), 'deny', 'git.push_all')
    expect(main('git push -u origin feature/x', f.wt.feat), 'deny', 'git.push_all')
    assert.notEqual(main('git push origin feature/x:feature/x', f.wt.feat).decision, 'deny')
  } finally {
    git(f.wt.feat, 'config', '--unset', 'remote.origin.push')
  }
  expect(main('git -c remote.origin.push=x push origin feature/x', f.wt.feat), 'deny', 'git.push_all')
})
test('push: --no-dry-run and the value of -o are not a dry run', () => {
  expect(main('git push --dry-run --no-dry-run origin main'), 'deny', 'grant.missing')
  expect(main('git push -o -n origin main'), 'deny', 'grant.missing')
})
test('push: a program that answers the push is refused for a protected branch', () => {
  f.grant('push-main', f.sha('main'))
  expect(main('GIT_SSH_COMMAND=/tmp/x git push origin main'), 'deny', 'grant.config')
  expect(main('git push --receive-pack=/tmp/x origin main'), 'deny', 'grant.config')
  assert.equal(f.readGrant().used, false)
})
