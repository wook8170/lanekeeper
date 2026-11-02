import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { initProject, doctor } from '../lib/init.mjs'
import { resolveConfig } from '../lib/config.mjs'
import * as cg from '../lib/codegraph.mjs'

function repoFixture(projectCfg) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-l12b-')))
  const repo = path.join(dir, 'sample')
  fs.mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])
  const env = { HOME: dir, WB_ACTIVE: '1', WB_HOME: path.join(dir, 'home', '.wb'), PATH: process.env.PATH, LANG: 'en_US.UTF-8', WB_CODEGRAPH: 'off' }
  if (projectCfg) {
    fs.mkdirSync(path.join(repo, '.wb'))
    fs.writeFileSync(path.join(repo, '.wb', 'config.json'), JSON.stringify(projectCfg))
  }
  return { dir, repo, env }
}
const excludeLines = (repo) => fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n')

test('auto_index: default is true, old name is read as alias, new name wins', () => {
  const none = repoFixture({})
  assert.equal(resolveConfig({ projectDir: none.repo, env: none.env }).config.project.codegraph.auto_index, true)
  const old = repoFixture({ codegraph: { index_on_worktree: false } })
  const r = resolveConfig({ projectDir: old.repo, env: old.env })
  assert.equal(r.config.project.codegraph.auto_index, false)
  assert.equal(r.errors.length, 0)
  const both = repoFixture({ codegraph: { index_on_worktree: false, auto_index: true } })
  assert.equal(resolveConfig({ projectDir: both.repo, env: both.env }).config.project.codegraph.auto_index, true)
})

test('autoIndexEnabled / autoQueue honour both names with new-name precedence', () => {
  assert.equal(cg.autoIndexEnabled({}), true)
  assert.equal(cg.autoIndexEnabled({ project: { codegraph: { auto_index: false } } }), false)
  assert.equal(cg.autoIndexEnabled({ project: { codegraph: { index_on_worktree: false } } }), false)
  assert.equal(cg.autoIndexEnabled({ project: { codegraph: { index_on_worktree: false, auto_index: true } } }), true)
  const r = cg.autoQueue('/nowhere', { config: { project: { codegraph: { auto_index: false } } }, env: {} })
  assert.equal(r.skipped, 'disabled')
})

test('doctor: old key is flagged, new key is not', () => {
  const old = repoFixture({ codegraph: { index_on_worktree: false } })
  assert.ok(doctor(old.repo, old.env).checks.some((c) => c.id === 'codegraphOldKey'))
  const neu = repoFixture({ codegraph: { auto_index: false } })
  assert.ok(!doctor(neu.repo, neu.env).checks.some((c) => c.id === 'codegraphOldKey'))
})

test('init: adds .codegraph/ and .wb/metrics/ next to .wb/briefs/, skipping lines already present', () => {
  const { repo, env } = repoFixture()
  fs.mkdirSync(path.join(repo, '.git', 'info'), { recursive: true })
  fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), '.codegraph/\n')
  const actions = initProject(repo, { kind: 'other', language: 'en' }, env)
  const added = actions.filter((a) => a.type === 'exclude').map((a) => a.line)
  assert.deepEqual(added, ['.wb/briefs/', '.wb/metrics/'])
  const lines = excludeLines(repo)
  for (const l of ['.wb/briefs/', '.codegraph/', '.wb/metrics/']) assert.equal(lines.filter((x) => x === l).length, 1)
  assert.deepEqual(initProject(repo, { kind: 'other', language: 'en' }, env).filter((a) => a.type === 'exclude'), [])
  // init-made lines are not reported as automatic
  assert.ok(!doctor(repo, env).checks.some((c) => c.id === 'codegraphAutoExclude'))
})

test('doctor: a line added by the hook path (no init) is reported once', () => {
  const { repo, env } = repoFixture()
  assert.equal(cg.ensureExclude(repo), true)
  assert.equal(cg.ensureExclude(repo), false)
  const c = doctor(repo, env).checks.find((x) => x.id === 'codegraphAutoExclude')
  assert.ok(c)
  assert.match(c.detail.lines, /\.codegraph\//)
})
