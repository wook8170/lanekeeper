import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { initProject, doctor } from '../lib/init.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'bin', 'wb-config')

function emptyRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-init-'))
  const repo = path.join(dir, 'sample')
  fs.mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])
  const env = { HOME: dir, WB_ACTIVE: '1', WB_HOME: path.join(dir, 'home', '.wb'), PATH: process.env.PATH, LANG: 'en_US.UTF-8' }
  return { dir, repo, env }
}

test('init: three answers create project and personal settings in an empty sample', () => {
  const { repo, env } = emptyRepo()
  const actions = initProject(repo, { kind: 'web-ui', language: 'ko', gate: 'npm test' }, env)
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.wb', 'config.json'), 'utf8'))
  assert.equal(cfg.project_kind, 'web-ui')
  assert.equal(cfg.gate.command, 'npm test')
  assert.deepEqual(cfg.quality.ship.requires, ['ux-adversarial'], 'a web-ui project requires the adversarial UX check before shipping')
  const personal = JSON.parse(fs.readFileSync(path.join(env.WB_HOME, 'personal.json'), 'utf8'))
  assert.equal(personal.language, 'ko')
  const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')
  assert.ok(exclude.split('\n').includes('.wb/briefs/'))
  assert.ok(fs.statSync(path.join(repo, '.git', 'wb')).isDirectory())
  assert.deepEqual(actions.map((a) => a.type), ['wrote', 'wrote', 'exclude', 'exclude', 'exclude'])
})

test('init: second run keeps existing files and does not duplicate the exclude line', () => {
  const { repo, env } = emptyRepo()
  initProject(repo, { kind: 'library', language: 'en' }, env)
  const again = initProject(repo, { kind: 'service', language: 'ko' }, env)
  assert.deepEqual(again.map((a) => a.type), ['kept', 'kept'])
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.wb', 'config.json'), 'utf8'))
  assert.equal(cfg.project_kind, 'library')
  assert.equal(cfg.quality, undefined, 'only web-ui gets the ship requirement')
  const lines = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n')
  assert.equal(lines.filter((l) => l === '.wb/briefs/').length, 1)
})

test('init: warns when a broad .gitignore pattern hides docs/test-results/', () => {
  const { repo, env } = emptyRepo()
  fs.writeFileSync(path.join(repo, '.gitignore'), 'test-results/\n')
  const actions = initProject(repo, { kind: 'other', language: 'en' }, env)
  const g = actions.find((a) => a.type === 'gitignore')
  assert.ok(g)
  assert.equal(g.pattern, 'test-results/')
  // an exception line removes the warning
  fs.writeFileSync(path.join(repo, '.gitignore'), 'test-results/\n!docs/test-results/\n')
  assert.equal(initProject(repo, { kind: 'other', language: 'en' }, env).find((a) => a.type === 'gitignore'), undefined)
})

test('init: rejects unknown answers', () => {
  const { repo, env } = emptyRepo()
  assert.throws(() => initProject(repo, { kind: 'mobile', language: 'en' }, env), /project kind/)
  assert.throws(() => initProject(repo, { kind: 'other', language: 'fr' }, env), /language/)
})

test('init: outside git it writes settings and reports notGit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-nogit-'))
  const env = { HOME: dir, WB_ACTIVE: '1', WB_HOME: path.join(dir, '.wb'), PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: path.dirname(dir) }
  const actions = initProject(dir, { kind: 'other', language: 'en' }, env)
  assert.ok(actions.some((a) => a.type === 'notGit'))
  assert.ok(fs.existsSync(path.join(dir, '.wb', 'config.json')))
})

test('doctor: reports missing project settings, then ok after init', () => {
  const { repo, env } = emptyRepo()
  let d = doctor(repo, env)
  assert.equal(d.checks.find((c) => c.id === 'projectConfig').status, 'warn')
  assert.equal(d.checks.find((c) => c.id === 'config').status, 'ok')
  initProject(repo, { kind: 'other', language: 'en' }, env)
  d = doctor(repo, env)
  assert.equal(d.checks.find((c) => c.id === 'projectConfig').status, 'ok')
  assert.ok(d.keys.some((k) => k.key === 'machine.lanes.max' && k.from === 'default'))
})

test('cli: init, explain and validate work end to end', () => {
  const { repo, env } = emptyRepo()
  const run = (...a) => execFileSync(CLI, [...a, '--project', repo], { env, encoding: 'utf8' })
  const out = run('init', '--kind', 'service', '--lang', 'en', '--gate', 'make check')
  assert.match(out, /Wrote: .*config\.json/)
  fs.mkdirSync(env.WB_HOME, { recursive: true })
  fs.writeFileSync(path.join(env.WB_HOME, 'machine.json'), JSON.stringify({ lanes: { max: 9 } }))
  const e = JSON.parse(run('explain', 'machine.lanes.max', '--json'))
  assert.equal(e.value, 9)
  assert.equal(e.from, 'machine')
  assert.match(run('explain', 'machine.lanes.max'), /applied layer: machine/)
  assert.equal(run('get', 'project.gate.command').trim(), 'make check')
  assert.match(run('validate'), /Settings are valid/)
  fs.writeFileSync(path.join(env.WB_HOME, 'machine.json'), JSON.stringify({ lanes: { max: 0 } }))
  assert.throws(() => run('validate'), (err) => err.status === 1 && /machine\.lanes\.max/.test(err.stdout))
})

test('cli: messages follow the chosen language', () => {
  const { repo, env } = emptyRepo()
  fs.mkdirSync(env.WB_HOME, { recursive: true })
  fs.writeFileSync(path.join(env.WB_HOME, 'personal.json'), JSON.stringify({ language: 'ko' }))
  const out = execFileSync(CLI, ['validate', '--project', repo], { env, encoding: 'utf8' })
  assert.match(out, /설정에 오류가 없습니다/)
})
