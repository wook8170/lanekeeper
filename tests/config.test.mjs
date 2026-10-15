import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig, explain, mergeSources, getPath, ruleFor } from '../lib/config.mjs'

function sandbox({ personal, routing, machine, project } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cfg-'))
  const home = path.join(dir, 'home')
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(path.join(repo, '.wb'), { recursive: true })
  const w = (f, d) => d !== undefined && fs.writeFileSync(f, typeof d === 'string' ? d : JSON.stringify(d))
  w(path.join(home, 'personal.json'), personal)
  w(path.join(home, 'routing.json'), routing)
  w(path.join(home, 'machine.json'), machine)
  w(path.join(repo, '.wb', 'config.json'), project)
  const env = { HOME: dir, WB_HOME: home, PATH: process.env.PATH }
  return { dir, home, repo, env, resolve: () => resolveConfig({ projectDir: repo, env }) }
}

test('defaults alone are valid and resolve to the documented values', () => {
  const r = sandbox().resolve()
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
  assert.equal(r.config.machine.lanes.max, 3)
  assert.equal(r.config.machine.slots.heavy.count, 2)
  assert.equal(r.config.machine.slots.browser.count, 2)
  assert.equal(r.config.machine.load.max, 'auto')
  assert.deepEqual(r.config.routing.denied, [])
  assert.equal(r.config.personal.report.chat_detail, 'summary')
  assert.equal(r.config.personal.auto_retry.permission_mode, 'default')
  assert.equal(r.origins.get('machine.lanes.max'), 'default')
})

test('override: personal > machine > project > default for ordinary values', () => {
  const s = sandbox({
    project: { version: 1, personal: { language: 'en', report: { viewer: 'remote' } }, project_kind: 'web-ui' },
    personal: { version: 1, language: 'ko' },
  })
  const r = s.resolve()
  assert.deepEqual(r.errors, [])
  assert.equal(r.config.personal.language, 'ko')
  assert.equal(r.origins.get('personal.language'), 'personal')
  // only the project sets viewer, so the project wins over the default
  assert.equal(r.config.personal.report.viewer, 'remote')
  assert.equal(r.origins.get('personal.report.viewer'), 'project')
  // sibling keys untouched by higher layers keep the default
  assert.equal(r.config.personal.report.chat_detail, 'summary')
  assert.equal(r.origins.get('personal.report.chat_detail'), 'default')
  assert.equal(r.config.project.project_kind, 'web-ui')
})

test('override: machine layer beats project for machine keys', () => {
  const r = sandbox({
    project: { machine: { slots: { stale_after_min: 30 } } },
    machine: { slots: { stale_after_min: 60 } },
  }).resolve()
  assert.equal(r.config.machine.slots.stale_after_min, 60)
  assert.equal(r.origins.get('machine.slots.stale_after_min'), 'machine')
})

test('override: partial task override keeps the other task fields', () => {
  const r = sandbox({ routing: { tasks: { review: { chain: ['opus'] } } } }).resolve()
  assert.deepEqual(r.config.routing.tasks.review.chain, ['opus'])
  assert.equal(r.config.routing.tasks.review.floor, 'opus')
  assert.equal(r.origins.get('routing.tasks.review.chain'), 'personal')
  assert.equal(r.origins.get('routing.tasks.review.floor'), 'default')
})

test('union: denied models from every layer are kept, a project cannot remove them', () => {
  const r = sandbox({
    routing: { denied: ['fable'] },
    project: { routing: { denied: [] } },
  }).resolve()
  assert.deepEqual(r.config.routing.denied, ['fable'])
  const r2 = sandbox({ routing: { denied: ['fable'] }, project: { routing: { denied: ['haiku'] } } }).resolve()
  assert.deepEqual(r2.config.routing.denied, ['haiku', 'fable'])
  assert.equal(r2.origins.get('routing.denied'), 'default+project+personal')
})

test('union: protected branches, protected paths and protected ports', () => {
  const r = sandbox({
    project: { git: { protected_branches: ['develop', 'main'] }, protected_paths: ['secrets/**'] },
    machine: { ports: { protected: [{ name: 'api', port: 8080 }] } },
  }).resolve()
  assert.deepEqual(r.config.project.git.protected_branches, ['main', 'master', 'release/*', 'develop'])
  assert.deepEqual(r.config.project.protected_paths, ['secrets/**'])
  assert.deepEqual(r.config.machine.ports.protected, [{ name: 'api', port: 8080 }])
  // non-union siblings in the same object still merge normally
  assert.equal(r.config.project.git.gate_stamp, 'wb-gate-pass')
})

test('min: caps take the smallest non-default value', () => {
  const r = sandbox({ machine: { lanes: { max: 9 } }, project: { machine: { lanes: { max: 4 } } } }).resolve()
  assert.equal(r.config.machine.lanes.max, 4)
  assert.equal(r.origins.get('machine.lanes.max'), 'project')
})

test('min: a personal machine file may raise the cap above the plugin default', () => {
  const r = sandbox({ machine: { lanes: { max: 9 }, slots: { heavy: { count: 3 } } } }).resolve()
  assert.equal(r.config.machine.lanes.max, 9)
  assert.equal(r.origins.get('machine.lanes.max'), 'machine')
  assert.equal(r.config.machine.slots.heavy.count, 3)
  assert.equal(r.config.machine.slots.browser.count, 2)
  assert.equal(r.origins.get('machine.slots.browser.count'), 'default')
})

test('min: load.max numeric beats auto; auto resolves to cores x 2', () => {
  const r = sandbox({ machine: { load: { max: 'auto' } }, project: { machine: { load: { max: 12 } } } }).resolve()
  assert.equal(r.config.machine.load.max, 12)
  assert.equal(r.effective.load_max, 12)
  const r2 = sandbox().resolve()
  assert.equal(r2.effective.load_max, os.cpus().length * 2)
})

test('userConfig env sits above project and machine, below the personal file', () => {
  const s = sandbox({ project: { personal: { language: 'en' } } })
  s.env.CLAUDE_PLUGIN_OPTION_LANGUAGE = 'ko'
  s.env.CLAUDE_PLUGIN_OPTION_CHAT_DETAIL = 'detailed'
  let r = s.resolve()
  assert.equal(r.config.personal.language, 'ko')
  assert.equal(r.origins.get('personal.language'), 'userConfig')
  assert.equal(r.config.personal.report.chat_detail, 'detailed')
  fs.writeFileSync(path.join(s.home, 'personal.json'), JSON.stringify({ language: 'en' }))
  r = s.resolve()
  assert.equal(r.config.personal.language, 'en')
  assert.equal(r.origins.get('personal.language'), 'personal')
})

test('language auto follows the locale', () => {
  const s = sandbox()
  s.env.LANG = 'ko_KR.UTF-8'
  assert.equal(s.resolve().effective.language, 'ko')
  s.env.LANG = 'en_US.UTF-8'
  assert.equal(s.resolve().effective.language, 'en')
})

test('schema: type, enum and range errors name the file and key', () => {
  const r = sandbox({
    machine: { lanes: { max: 'many' }, slots: { heavy: { count: 0 } } },
    personal: { report: { chat_detail: 'verbose' } },
  }).resolve()
  const paths = r.errors.map((e) => e.path).sort()
  assert.deepEqual(paths, ['machine.lanes.max', 'machine.slots.heavy.count', 'personal.report.chat_detail'])
  for (const e of r.errors) assert.ok(e.file.endsWith('.json'), e.file)
})

test('schema: invalid JSON is reported, not thrown', () => {
  const r = sandbox({ project: '{ not json' }).resolve()
  assert.equal(r.errors.length, 1)
  assert.equal(r.errors[0].code, 'json')
  assert.match(r.errors[0].file, /\.wb\/config\.json$/)
})

test('schema: unknown keys are warnings, version must be 1', () => {
  const r = sandbox({ personal: { version: 2, colour: 'blue' } }).resolve()
  assert.deepEqual(r.errors.map((e) => e.path), ['personal.version'])
  assert.deepEqual(r.warnings.map((w) => w.path), ['personal.colour'])
})

test('routing cross-check: chain and floor must name known models', () => {
  const r = sandbox({ routing: { tasks: { design: { chain: ['gpt'], floor: 'tiny' } }, denied: ['ghost'] } }).resolve()
  assert.deepEqual(r.errors.map((e) => e.path).sort(), ['routing.tasks.design.chain', 'routing.tasks.design.floor'])
  assert.deepEqual(r.warnings.map((w) => w.path), ['routing.denied'])
})

test('explain shows rule, winning layer and every layer that sets the key', () => {
  const r = sandbox({ machine: { lanes: { max: 9 } }, project: { machine: { lanes: { max: 4 } } } }).resolve()
  const e = explain(r, 'machine.lanes.max')
  assert.equal(e.value, 4)
  assert.equal(e.rule, 'min')
  assert.equal(e.from, 'project')
  assert.deepEqual(e.setBy.map((s) => [s.layer, s.value]), [['default', 3], ['project', 4], ['machine', 9]])
  const o = explain(r, 'routing.tasks.design')
  assert.equal(o.rule, 'override')
  assert.equal(o.children['routing.tasks.design.chain'], 'default')
  assert.equal(ruleFor('routing.denied'), 'union')
})

test('mergeSources is pure with respect to its inputs', () => {
  const data = { lanes: { max: 5 } }
  const sources = [{ layer: 'machine', file: 'x', ns: 'machine', data }]
  const { config } = mergeSources(sources)
  config.machine.lanes.max = 1
  assert.equal(data.lanes.max, 5)
  assert.equal(getPath({ a: { b: 1 } }, 'a.c'), undefined)
})
