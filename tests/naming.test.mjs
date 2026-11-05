// Names after the rename wb -> lanekeeper (0.2.0): new folders first, the old
// folders only when the new ones are missing, a one-time notice, and
// LANEKEEPER_* winning over WB_*.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { applyLegacyEnv, homeInfo, projectInfo, projectConfigFile, projectRel, homeRel, stateInfo, legacyInUse, legacyNotice } from '../lib/naming.mjs'
import { resolveConfig, stateDir } from '../lib/config.mjs'
import { optedIn } from '../lib/optin.mjs'
import { legacyText, handle as rulesStart } from '../hooks/scripts/rules/session-start.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lanekeeper-naming-'))
const writeJson = (file, data) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, JSON.stringify(data)))

test('env: WB_* fills a missing LANEKEEPER_*, and LANEKEEPER_* wins when both are set', () => {
  const env = { WB_HOME: '/old', WB_PYTHON: 'py-old', LANEKEEPER_PYTHON: 'py-new', OTHER: 'x' }
  const copied = applyLegacyEnv(env)
  assert.deepEqual(copied, ['LANEKEEPER_HOME'])
  assert.equal(env.LANEKEEPER_HOME, '/old')
  assert.equal(env.LANEKEEPER_PYTHON, 'py-new')
  assert.equal(env.WB_PYTHON, 'py-old')
  assert.deepEqual(applyLegacyEnv(env), [])
})

test('home: ~/.lanekeeper by default, ~/.wb only while ~/.lanekeeper is missing, LANEKEEPER_HOME first', () => {
  const home = tmp()
  const env = { HOME: home }
  assert.deepEqual(homeInfo(env), { dir: path.join(home, '.lanekeeper'), legacy: false })
  fs.mkdirSync(path.join(home, '.wb'))
  assert.deepEqual(homeInfo(env), { dir: path.join(home, '.wb'), legacy: true, preferred: path.join(home, '.lanekeeper') })
  fs.mkdirSync(path.join(home, '.lanekeeper'))
  assert.equal(homeInfo(env).dir, path.join(home, '.lanekeeper'))
  assert.equal(homeInfo(env).legacy, false)
  assert.equal(homeInfo({ ...env, LANEKEEPER_HOME: '/elsewhere' }).dir, '/elsewhere')
})

test('home: settings in ~/.wb are read, and ~/.lanekeeper paths in settings point there', () => {
  const home = tmp()
  writeJson(path.join(home, '.wb', 'personal.json'), { version: 1, language: 'ko' })
  const env = { HOME: home, PATH: process.env.PATH }
  assert.equal(resolveConfig({ env }).config.personal.language, 'ko')
  assert.equal(homeRel('~/.lanekeeper/run/slots', env), path.join(home, '.wb', 'run', 'slots'))
  assert.equal(homeRel('~/other/x', env), '~/other/x')
})

test('project: .lanekeeper/config.json first, .wb/config.json while the new file is missing', () => {
  const root = tmp()
  assert.equal(projectInfo(root).legacy, false)
  assert.equal(optedIn(root, {}), false)
  writeJson(path.join(root, '.wb', 'config.json'), { version: 1, project_kind: 'library' })
  assert.equal(projectInfo(root).legacy, true)
  assert.equal(projectConfigFile(root), path.join(root, '.wb', 'config.json'))
  assert.equal(projectRel(root, '.lanekeeper/briefs/l1.md'), '.wb/briefs/l1.md')
  assert.equal(projectRel(root, 'docs/x.md'), 'docs/x.md')
  assert.equal(optedIn(root, {}), true)
  const env = { HOME: tmp(), PATH: process.env.PATH }
  assert.equal(resolveConfig({ projectDir: root, env }).config.project.project_kind, 'library')
  writeJson(path.join(root, '.lanekeeper', 'config.json'), { version: 1, project_kind: 'service' })
  assert.equal(projectInfo(root).legacy, false)
  assert.equal(projectRel(root, '.lanekeeper/briefs/l1.md'), '.lanekeeper/briefs/l1.md')
  assert.equal(resolveConfig({ projectDir: root, env }).config.project.project_kind, 'service')
})

test('state: <git-common-dir>/lanekeeper, or <git-common-dir>/wb while only that exists', () => {
  const repo = tmp()
  execFileSync('git', ['init', '-q', repo])
  const common = path.join(repo, '.git')
  assert.equal(stateDir(repo), path.join(common, 'lanekeeper'))
  fs.mkdirSync(path.join(common, 'wb'))
  assert.equal(stateDir(repo), path.join(common, 'wb'))
  assert.equal(stateInfo(common).legacy, true)
  fs.mkdirSync(path.join(common, 'lanekeeper'))
  assert.equal(stateDir(repo), path.join(common, 'lanekeeper'))
})

test('notice: lists every old name in use, once per set of names, and moves nothing', () => {
  const home = tmp()
  const root = tmp()
  fs.mkdirSync(path.join(home, '.wb'))
  writeJson(path.join(root, '.wb', 'config.json'), { version: 1 })
  const env = { HOME: home }
  const items = legacyInUse({ env, root, copiedEnv: ['LANEKEEPER_PYTHON'] })
  assert.deepEqual(items.map((i) => i.kind), ['home', 'project', 'env'])
  assert.equal(items[2].old, 'WB_PYTHON')
  const marker = path.join(tmp(), 'legacy-notice.json')
  assert.equal(legacyNotice(items, marker).length, 3)
  assert.deepEqual(legacyNotice(items, marker), [])
  assert.equal(legacyNotice(items.slice(0, 1), marker).length, 1, 'a different set is shown again')
  assert.deepEqual(legacyNotice([], marker), [])
  assert.ok(fs.existsSync(path.join(home, '.wb')) && !fs.existsSync(path.join(home, '.lanekeeper')))
  assert.ok(fs.existsSync(path.join(root, '.wb', 'config.json')) && !fs.existsSync(path.join(root, '.lanekeeper')))
})

test('notice: the session start hook shows it once, in the user language', () => {
  const home = tmp()
  const repo = tmp()
  execFileSync('git', ['init', '-q', repo])
  writeJson(path.join(home, '.wb', 'personal.json'), { version: 1, language: 'en' })
  writeJson(path.join(repo, '.wb', 'config.json'), { version: 1 })
  const env = { HOME: home, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: path.join(tmp(), 'data') }
  const first = rulesStart({ cwd: repo, source: 'startup' }, env)
  assert.match(first.systemMessage, /called wb before 0\.2\.0/)
  assert.match(first.systemMessage, /\.wb\/config\.json|\/\.wb \(new name/)
  assert.match(first.hookSpecificOutput.additionalContext, /mv ~\/\.wb ~\/\.lanekeeper/)
  const second = rulesStart({ cwd: repo, source: 'startup' }, env)
  assert.equal(second?.systemMessage, undefined)
  assert.equal(legacyText(repo, 'ko', { ...env, CLAUDE_PLUGIN_DATA: path.join(tmp(), 'data') }, []).includes('옮긴 파일은 없습니다'), true)
})

test('env: a bin tool started with only WB_HOME reads the settings there', () => {
  const home = path.join(tmp(), 'custom-home')
  writeJson(path.join(home, 'personal.json'), { version: 1, language: 'ko' })
  const env = { PATH: process.env.PATH, HOME: tmp(), WB_HOME: home }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'lanekeeper-config'), 'get', 'personal.language', '--json'], { env, encoding: 'utf8', cwd: tmp() })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /ko/)
  const both = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'lanekeeper-config'), 'get', 'personal.language', '--json'], { env: { ...env, LANEKEEPER_HOME: path.join(tmp(), 'empty') }, encoding: 'utf8', cwd: tmp() })
  assert.doesNotMatch(both.stdout, /"ko"/)
})

test('markers: briefs and decision files written before 0.2.0 (wb-brief, wb-decision) are still read', async () => {
  const { MARKER_RE: BRIEF } = await import('../lib/brief.mjs')
  const { MARKER_RE: DECISION } = await import('../lib/decide.mjs')
  assert.match('<!-- wb-brief v1 type=review lane=r1 -->', BRIEF)
  assert.match('<!-- lanekeeper-brief v1 type=review lane=r1 -->', BRIEF)
  assert.match('<!-- wb-decision v1 status=pending -->', DECISION)
  assert.match('<!-- lanekeeper-decision v1 status=decided -->', DECISION)
})
