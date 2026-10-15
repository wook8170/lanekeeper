// Attempts to slip a guarded git command past the hook: command chaining,
// subshells, wrappers, aliases, -C paths, env prefixes, quoting.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeFixture, git } from './safety-fixture.mjs'

let f
before(() => {
  f = makeFixture()
})
after(() => f.cleanup())
beforeEach(() => f.clearGrant())

const blocked = (cmd, opts = {}) => {
  const r = f.judge(cmd, { cwd: f.wt.feat, ...opts })
  assert.equal(r.decision, 'deny', `${cmd} -> ${r.decision} ${JSON.stringify(r.codes)}`)
  return r
}

test('chaining: ; && || | & and newlines', () => {
  for (const c of [
    'true; git push origin main',
    'git status && git push origin main',
    'false || git push origin main',
    'echo hi | git push origin main',
    'sleep 1 & git push origin main',
    'echo a\ngit push origin main',
  ]) blocked(c)
})
test('subshells, groups, command and process substitution', () => {
  for (const c of [
    '(git push origin main)',
    '{ git push origin main; }',
    'echo $(git push origin main)',
    'echo `git push origin main`',
    'x="$(git push origin main)"',
    'cat <(git push origin main)',
  ]) blocked(c)
})
test('nested shells, eval and heredocs', () => {
  for (const c of [
    "bash -c 'git push origin main'",
    'sh -c "git push origin main"',
    `zsh -lc 'cd ${f.repo}; git commit -m x'`,
    "eval 'git push origin main'",
    'bash <<EOF\ngit push origin main\nEOF',
    "bash -c \"bash -c 'git push origin main'\"",
  ]) blocked(c)
})
test('wrappers and env prefixes', () => {
  for (const c of [
    'env git push origin main',
    'FOO=1 git push origin main',
    'env -i PATH=/usr/bin git push origin main',
    'sudo -u me git push origin main',
    'command git push origin main',
    'exec git push origin main',
    'nohup git push origin main',
    'timeout 30 git push origin main',
    'nice -n 5 git push origin main',
    'time git push origin main',
    'echo main | xargs git push origin',
  ]) blocked(c)
})
test('quoting and paths of the git binary', () => {
  for (const c of ['"git" push origin main', "g'i't push origin main", '\\git push origin main', '/usr/bin/git push origin main', 'g""it push origin main']) blocked(c)
})
test('shell aliases defined in the same command line', () => {
  blocked("alias g=git; g push origin main")
  blocked("alias gp='git push origin'; gp main")
})
test('git aliases: repository config, inline -c, defined earlier in the line, shell aliases', () => {
  git(f.repo, 'config', 'alias.ship', 'push origin main')
  git(f.repo, 'config', 'alias.sh-ship', '!git push origin main')
  try {
    blocked('git ship')
    blocked('git sh-ship')
    blocked('git -c alias.zz=push zz origin main')
    blocked('git config alias.p push && git p origin main')
    f.grant('commit-main', f.sha('main'))
    const r = f.judge('git -c alias.ci=commit ci -m x', { cwd: f.repo })
    assert.equal(r.decision, 'allow') // resolved to commit on main, grant present
  } finally {
    git(f.repo, 'config', '--unset', 'alias.ship')
    git(f.repo, 'config', '--unset', 'alias.sh-ship')
  }
})
test('-C, cd, pushd and GIT_DIR point the command at the protected checkout', () => {
  blocked(`git -C ${f.repo} commit -m x`)
  blocked(`git -C ../repo commit -m x`)
  blocked(`cd ${f.repo} && git commit -m x`)
  blocked(`cd .. && cd repo && git commit -m x`)
  blocked(`pushd ${f.repo} >/dev/null; git commit -m x`)
  blocked(`GIT_DIR=${f.repo}/.git git commit -m x`)
  blocked(`git --git-dir=${f.repo}/.git --work-tree=${f.repo} commit -m x`)
})
test('a cd inside a subshell does not leak to the next command', () => {
  const r = f.judge(`(cd ${f.repo} && git status) && git commit -m x`, { cwd: f.wt.feat })
  assert.equal(r.decision, 'allow')
})
test('unresolvable targets are blocked, not guessed', () => {
  blocked('$GIT push origin main')
  blocked('$(which git) push origin main')
  blocked('git -C "$WT" commit -m x')
  blocked('cd "$WT" && git commit -m x')
  // a variable in a harmless place is fine
  assert.equal(f.judge('git log -n "$N"', { cwd: f.wt.feat }).decision, 'allow')
})
test('lane: the same tricks do not get a lane past its branch', () => {
  const opts = { cwd: f.wt.l1, agent: 'agent-l1' }
  blocked(`cd ${f.wt.int} && git commit -m x`, opts)
  blocked(`git -C ${f.repo} merge wb/t/l1`, opts)
  blocked("bash -c 'git push'", opts)
  blocked('alias g=git; g switch main', opts)
})
test('harmless git commands pass', () => {
  for (const c of ['git status', 'git log --oneline -5', 'git diff HEAD~1', 'git fetch origin', 'git worktree list', 'git branch', 'git stash list', 'echo "git push origin main"', "grep -r 'git push' docs"]) {
    assert.equal(f.judge(c, { cwd: f.repo }).decision, 'allow', c)
  }
})
