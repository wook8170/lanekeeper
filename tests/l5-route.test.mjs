// L5 routing: resolution order (denied > quota > differ_from > floor > wait),
// model checks and task classification.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { classify, resolveRoute, checkModel, modelKeyFor, limitsMap, explainLines } from '../lib/route.mjs'
import { recordLimit } from '../lib/limits.mjs'
import { resolveConfig } from '../lib/config.mjs'
import { translator } from '../lib/i18n.mjs'
import { makeEnv, bin, FABLE_ROUTING } from './l3-fixture.mjs'

const DEFAULTS = JSON.parse(fs.readFileSync(new URL('../defaults/routing.json', import.meta.url), 'utf8'))
// DEFAULTS with the fable layer merged in the way a personal routing.json is
const WITH_FABLE = (() => {
  const r = structuredClone(DEFAULTS)
  Object.assign(r.models, FABLE_ROUTING.models)
  for (const [k, v] of Object.entries(FABLE_ROUTING.tasks)) Object.assign(r.tasks[k], v)
  return r
})()
const routing = (patch = {}) => ({ ...structuredClone(WITH_FABLE), ...patch })
const FUTURE = new Date(Date.now() + 2 * 3600_000).toISOString()
const LATER = new Date(Date.now() + 5 * 3600_000).toISOString()

test('defaults: only models every account has; design, review and adversarial on opus', () => {
  assert.deepEqual(Object.keys(DEFAULTS.models).sort(), ['haiku', 'opus', 'sonnet'])
  for (const t of ['design', 'review', 'security', 'adversarial']) {
    assert.deepEqual(DEFAULTS.tasks[t].chain, ['opus'], t)
    assert.equal(DEFAULTS.tasks[t].floor, 'opus', t)
  }
  assert.equal(resolveRoute(DEFAULTS, 'design').model, 'opus')
  // adversarial with an opus implementer: no other model at the floor, same model in a fresh context
  const d = resolveRoute(DEFAULTS, 'adversarial', { implementer: 'opus' })
  assert.equal(d.model, 'opus')
  assert.equal(d.sameAsImplementer, true)
})

test('fable layer: first model of each chain', () => {
  const r = routing()
  assert.equal(resolveRoute(r, 'design').model, 'fable')
  assert.equal(resolveRoute(r, 'impl-multi').model, 'opus')
  assert.equal(resolveRoute(r, 'impl-spec').model, 'sonnet')
  assert.equal(resolveRoute(r, 'research').model, 'haiku')
  assert.equal(resolveRoute(r, 'nope').error, 'unknown-task')
})

test('1 denied: removed before anything else, next model in the chain is used', () => {
  const r = routing({ denied: ['fable'] })
  const d = resolveRoute(r, 'design')
  assert.equal(d.model, 'opus')
  assert.deepEqual(d.steps[0].removed, [{ model: 'fable' }])
  // denied beats a model that the chain lists first, for every task
  for (const t of ['design', 'review', 'adversarial']) assert.notEqual(resolveRoute(r, t).model, 'fable')
  const v = checkModel(r, d, 'fable')
  assert.equal(v[0].level, 'deny')
  assert.equal(v[0].code, 'model_denied')
  assert.equal(v[0].vars.next, 'opus')
})

test('1 denied: personal denied list survives a project that clears it (union)', () => {
  const fx = makeEnv()
  try {
    fs.writeFileSync(path.join(fx.env.LANEKEEPER_HOME, 'routing.json'), JSON.stringify({ version: 1, ...FABLE_ROUTING, denied: ['fable'] }))
    fs.mkdirSync(path.join(fx.repo, '.lanekeeper'))
    fs.writeFileSync(path.join(fx.repo, '.lanekeeper', 'config.json'), JSON.stringify({ version: 1, routing: { denied: [] } }))
    const resolved = resolveConfig({ projectDir: fx.repo, env: fx.env })
    assert.deepEqual(resolved.config.routing.denied, ['fable'])
    assert.equal(resolveRoute(resolved.config.routing, 'review').model, 'opus')
  } finally {
    fx.cleanup()
  }
})

test('2 limits: an exhausted model is skipped; an expired record is ignored', () => {
  const r = routing()
  const d = resolveRoute(r, 'impl-multi', { limits: { opus: FUTURE } })
  assert.equal(d.model, 'sonnet')
  assert.equal(d.steps[1].removed[0].model, 'opus')
  const v = checkModel(r, d, 'opus')
  assert.equal(v[0].code, 'model_exhausted')
  assert.equal(v[0].vars.next, 'sonnet')
})

test('2 limits: limits.json is read through exhaustedModels (expired entries drop out)', () => {
  const fx = makeEnv()
  try {
    const file = path.join(fx.env.CLAUDE_PLUGIN_DATA, 'limits.json')
    recordLimit(file, { model: 'opus', untilEpoch: Math.floor(Date.parse(FUTURE) / 1000), scope: '5h' })
    const m = limitsMap(file)
    assert.deepEqual(Object.keys(m), ['opus'])
    assert.deepEqual(limitsMap(file, Date.parse(FUTURE) + 1000), {})
    assert.deepEqual(limitsMap(path.join(fx.base, 'missing.json')), {})
  } finally {
    fx.cleanup()
  }
})

test('2 limits: "*" holds the whole chain and waits for that reset', () => {
  const r = routing()
  for (const t of Object.keys(r.tasks)) {
    const d = resolveRoute(r, t, { limits: { '*': FUTURE } })
    assert.equal(d.ok, false, t)
    assert.equal(d.error, 'wait', t)
    assert.equal(d.until, FUTURE, t)
  }
  const v = checkModel(r, resolveRoute(r, 'impl-spec', { limits: { '*': FUTURE } }), 'sonnet')
  assert.equal(v[0].code, 'wait')
  assert.equal(v[0].level, 'deny')
})

test('adversarial chain with the fable layer: fable first, opus as the fallback', () => {
  assert.deepEqual(routing().tasks.adversarial.chain, ['fable', 'opus'])
  assert.equal(resolveRoute(routing({ denied: ['fable'] }), 'adversarial').model, 'opus')
  // implementer on fable: the review goes to opus
  assert.equal(resolveRoute(routing(), 'adversarial', { implementer: 'fable' }).model, 'opus')
})

test('3 differ_from: implementer model is excluded when another model at the floor remains', () => {
  const r = routing()
  const d = resolveRoute(r, 'adversarial', { implementer: 'opus' })
  assert.equal(d.model, 'fable')
  assert.equal(d.sameAsImplementer, false)
  // choosing the implementer's model anyway is blocked
  const v = checkModel(r, d, 'opus')
  assert.equal(v[0].code, 'differ_violation')
  assert.equal(v[0].level, 'deny')
})

test('3 differ_from: no other model left -> same model in a fresh context, reported', () => {
  const r = routing({ denied: ['fable'] })
  const d = resolveRoute(r, 'adversarial', { implementer: 'opus' })
  assert.equal(d.ok, true)
  assert.equal(d.model, 'opus')
  assert.equal(d.sameAsImplementer, true)
  assert.equal(d.steps[2].note, 'same-model-fresh-context')
  const v = checkModel(r, d, 'opus')
  assert.deepEqual(v.map((x) => x.code), ['same_model'])
  assert.equal(v[0].level, 'info')
})

test('3 differ_from: unknown implementer is noted and skipped', () => {
  const d = resolveRoute(routing(), 'adversarial')
  assert.equal(d.model, 'fable', 'with the fable layer, adversarial review tries fable first, apart from the implementer')
  assert.equal(d.steps[2].note, 'implementer-unknown')
  // implementer given as a full model id maps to its key
  assert.equal(modelKeyFor(routing(), 'claude-opus-4-8'), 'opus')
})

test('4 floor: models below the floor are dropped, never chosen', () => {
  const r = routing()
  r.tasks.design.chain = ['fable', 'opus', 'sonnet', 'haiku']
  const d = resolveRoute(r, 'design', { limits: { fable: FUTURE, opus: FUTURE } })
  assert.equal(d.ok, false)
  assert.deepEqual(d.steps[3].removed.map((x) => x.model), ['sonnet', 'haiku'])
  const v = checkModel(routing(), resolveRoute(routing(), 'review'), 'sonnet')
  assert.equal(v[0].code, 'below_floor')
  assert.equal(v[0].level, 'deny')
  // advice only when the task type was guessed rather than declared
  assert.equal(checkModel(routing(), resolveRoute(routing(), 'review'), 'sonnet', { strict: false })[0].level, 'warn')
})

test('5 wait: design never drops below opus; waits until the earliest reset', () => {
  const r = routing({ denied: ['fable'] })
  const d = resolveRoute(r, 'design', { limits: { opus: LATER, sonnet: FUTURE } })
  assert.equal(d.ok, false)
  assert.equal(d.error, 'wait')
  assert.equal(d.until, LATER)
  assert.equal(d.on_floor, 'wait-notify')
  const v = checkModel(r, d, null)
  assert.equal(v[0].code, 'wait')
  assert.equal(v[0].notify, true)
  // review uses the earliest of the eligible resets
  const r2 = routing()
  const d2 = resolveRoute(r2, 'review', { limits: { fable: LATER, opus: FUTURE } })
  assert.equal(d2.until, FUTURE)
})

test('5 no model: everything denied gives no-model, not a wait', () => {
  const r = routing({ denied: ['opus'] })
  const d = resolveRoute(r, 'security')
  assert.equal(d.error, 'no-model')
  assert.equal(checkModel(r, d, null)[0].code, 'no_model')
})

test('checkModel: missing, unknown, off-chain, not-first', () => {
  const r = routing()
  const d = resolveRoute(r, 'impl-spec')
  assert.equal(checkModel(r, d, null)[0].code, 'model_missing')
  assert.equal(checkModel(r, d, null)[0].vars.model, 'sonnet')
  assert.equal(checkModel(r, d, 'gpt')[0].code, 'model_unknown')
  assert.equal(checkModel(r, d, 'fable')[0].code, 'off_chain')
  const nf = checkModel(r, d, 'opus')
  assert.equal(nf[0].code, 'not_first')
  assert.equal(nf[0].level, 'warn')
  assert.deepEqual(checkModel(r, d, 'sonnet'), [])
})

test('classify: marker type > template > subagent type > description keyword', () => {
  const r = routing()
  assert.deepEqual(classify({ routing: r, marker: { attrs: { type: 'security', template: 'impl' } }, description: 'implement' }).type, 'security')
  assert.equal(classify({ routing: r, marker: { attrs: { template: 'review' } } }).source, 'template')
  assert.equal(classify({ routing: r, subagentType: 'Explore' }).type, 'research')
  assert.equal(classify({ routing: r, subagentType: 'oh-my:verifier' }).type, 'review')
  assert.equal(classify({ routing: r, description: '로그인 화면 시안' }).type, 'mockup')
  assert.equal(classify({ routing: r, description: 'Fix the login bug' }).type, 'impl-multi')
  assert.equal(classify({ routing: r, description: '오탈자 정리' }).type, 'mechanical')
  assert.equal(classify({ routing: r, description: 'hello' }).type, null)
  const unk = classify({ routing: r, marker: { attrs: { type: 'nope' } } })
  assert.equal(unk.unknown, true)
})

test('explain: one line per step and the result, ko and en', () => {
  for (const lang of ['ko', 'en']) {
    const t = translator(lang)
    const lines = explainLines(resolveRoute(routing({ denied: ['fable'] }), 'design', { limits: { opus: FUTURE } }), t)
    assert.equal(lines.length, 6)
    assert.ok(!lines.some((l) => /route\./.test(l)), lines.join('\n'))
  }
})

test('lanekeeper-route: resolve prints agent_param, exit 3 while waiting, explain trace', () => {
  const fx = makeEnv()
  try {
    fs.writeFileSync(path.join(fx.env.LANEKEEPER_HOME, 'routing.json'), JSON.stringify({ version: 1, ...FABLE_ROUTING, denied: ['fable'] }))
    let r = bin('lanekeeper-route', ['resolve', 'design'], fx.env, fx.repo)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout.trim(), 'opus')
    recordLimit(path.join(fx.env.CLAUDE_PLUGIN_DATA, 'limits.json'), { model: '*', untilEpoch: Math.floor(Date.parse(FUTURE) / 1000) })
    r = bin('lanekeeper-route', ['resolve', 'design'], fx.env, fx.repo)
    assert.equal(r.status, 3)
    r = bin('lanekeeper-route', ['explain', 'design', '--json'], fx.env, fx.repo)
    assert.equal(JSON.parse(r.stdout).error, 'wait')
    r = bin('lanekeeper-route', ['check', 'review', '--model', 'haiku'], fx.env, fx.repo)
    assert.equal(r.status, 1)
    r = bin('lanekeeper-route', ['resolve', 'nope'], fx.env, fx.repo)
    assert.equal(r.status, 2)
    r = bin('lanekeeper-route', ['tasks', '--json'], fx.env, fx.repo)
    assert.deepEqual(JSON.parse(r.stdout).denied, ['fable'])
  } finally {
    fx.cleanup()
  }
})
