// Lane commit policy (project.lanes.commit): "allowed" keeps lane commits as
// before; "on-instruction" asks unless the lane's brief allows commits, and the
// checkpoint WIP commit follows the same value.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeFixture, git } from './safety-fixture.mjs'
import { briefAllowsCommit, laneCommitPolicy } from '../lib/brief.mjs'
import { checkpointDir } from '../lib/checkpoint.mjs'
import { resolveConfig } from '../lib/config.mjs'

function setup(policy, briefText) {
  const f = makeFixture()
  if (policy) {
    // .lanekeeper/config.json is committed, so every worktree carries it
    f.projectConfig({ version: 1, lanes: { commit: policy } })
    fs.mkdirSync(path.join(f.wt.l1, '.lanekeeper'), { recursive: true })
    fs.copyFileSync(path.join(f.repo, '.lanekeeper', 'config.json'), path.join(f.wt.l1, '.lanekeeper', 'config.json'))
  }
  if (briefText !== undefined) {
    const brief = path.join(f.base, 'l1.md')
    fs.writeFileSync(brief, briefText)
    fs.writeFileSync(path.join(f.state, 'waves.json'), JSON.stringify({ version: 1, waves: [{ id: 'w1', lanes: [{ lane: 'l1', brief }] }] }))
  }
  return f
}
const commit = (f) => f.judge('git commit -m x', { cwd: f.wt.l1, agent: 'agent-l1' })

test('briefAllowsCommit: the marker attribute or a plain "commit allowed" line', () => {
  assert.equal(briefAllowsCommit('<!-- lanekeeper-brief v1 type=impl-multi lane=l1 commit=allowed -->'), true)
  assert.equal(briefAllowsCommit('<!-- lanekeeper-brief v1 type=impl-multi lane=l1 commit=no -->\n커밋 허용'), false, 'the marker wins')
  assert.equal(briefAllowsCommit('# 커밋 규칙\n- 커밋 허용 · main 병합 금지'), true)
  assert.equal(briefAllowsCommit('## Commit rules\n- Commit allowed.'), true)
  assert.equal(briefAllowsCommit('## 커밋 규칙\n- 커밋하지 않는다.'), false)
  assert.equal(briefAllowsCommit('## Commit rules\n- Commit only to your own lane branch.'), false)
  assert.equal(briefAllowsCommit(''), false)
})

test('policy allowed (default): a lane commits on its own branch without a brief', () => {
  const f = setup(null)
  try {
    assert.equal(commit(f).decision, 'allow')
    assert.equal(laneCommitPolicy(resolveConfig({ projectDir: f.repo, env: f.env }).config, f.state, 'l1').policy, 'allowed')
  } finally {
    f.cleanup()
  }
})

test('policy on-instruction: no permission in the brief asks; permission allows; no brief asks', () => {
  let f = setup('on-instruction', '<!-- lanekeeper-brief v1 type=impl-multi lane=l1 -->\n## 커밋 규칙\n- 자기 레인 브랜치에만 커밋한다.')
  try {
    const r = commit(f)
    assert.equal(r.decision, 'ask')
    assert.deepEqual(r.codes, ['git.lane_commit_instruction'])
    assert.equal(f.judge('git cherry-pick abc', { cwd: f.wt.l1, agent: 'agent-l1' }).decision, 'ask')
  } finally {
    f.cleanup()
  }
  f = setup('on-instruction', '<!-- lanekeeper-brief v1 type=impl-multi lane=l1 commit=allowed -->\nwork')
  try {
    assert.equal(commit(f).decision, 'allow')
  } finally {
    f.cleanup()
  }
  f = setup('on-instruction')
  try {
    assert.equal(commit(f).decision, 'ask')
    // a commit on another branch stays denied as before
    assert.equal(f.judge('git commit -m x', { cwd: f.wt.int, agent: 'agent-l1' }).decision, 'deny')
  } finally {
    f.cleanup()
  }
})

test('policy value is checked by the schema', () => {
  const f = setup('sometimes')
  try {
    const r = resolveConfig({ projectDir: f.repo, env: f.env })
    assert.ok(r.errors.some((e) => e.path === 'project.lanes.commit'), JSON.stringify(r.errors))
  } finally {
    f.cleanup()
  }
})

test('checkpoint follows the policy: skipped without permission, committed with it', () => {
  let f = setup('on-instruction', '<!-- lanekeeper-brief v1 type=impl-multi lane=l1 -->\nwork')
  try {
    fs.writeFileSync(path.join(f.wt.l1, 'a.txt'), 'changed\n')
    const resolved = resolveConfig({ projectDir: f.wt.l1, env: f.env })
    const before = git(f.wt.l1, 'rev-parse', 'HEAD')
    assert.equal(checkpointDir(f.wt.l1, resolved, 'Stop', new Date(), { env: f.env, notifyFn: () => {} }).skipped, 'commit-policy')
    assert.equal(git(f.wt.l1, 'rev-parse', 'HEAD'), before)
  } finally {
    f.cleanup()
  }
  f = setup('on-instruction', '<!-- lanekeeper-brief v1 type=impl-multi lane=l1 commit=allowed -->\nwork')
  try {
    fs.writeFileSync(path.join(f.wt.l1, 'a.txt'), 'changed\n')
    const resolved = resolveConfig({ projectDir: f.wt.l1, env: f.env })
    const r = checkpointDir(f.wt.l1, resolved, 'Stop', new Date(), { env: f.env, notifyFn: () => {} })
    assert.equal(r.committed, true, JSON.stringify(r))
  } finally {
    f.cleanup()
  }
})
