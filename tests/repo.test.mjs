// Repository-level checks: manifest shape, locale parity, required folders and
// a guard against project-specific or personal strings leaking into the plugin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const json = (p) => JSON.parse(read(p))

test('plugin.json: name wb, MIT, userConfig options are well formed', () => {
  const m = json('.claude-plugin/plugin.json')
  assert.equal(m.name, 'wb')
  assert.equal(m.license, 'MIT')
  const allowed = new Set(['type', 'title', 'description', 'required', 'default', 'options', 'multiple', 'sensitive', 'min', 'max'])
  for (const [key, opt] of Object.entries(m.userConfig)) {
    assert.match(key, /^[A-Za-z_][A-Za-z0-9_]*$/)
    for (const k of Object.keys(opt)) assert.ok(allowed.has(k), `${key}.${k}`)
    for (const k of ['type', 'title', 'description']) assert.ok(opt[k], `${key}.${k}`)
    if (opt.options) assert.ok(opt.options.includes(opt.default), `${key} default in options`)
  }
})

test('userConfig options match the settings schema enums', async () => {
  const { personalSchema } = await import('../lib/schema.mjs')
  const m = json('.claude-plugin/plugin.json')
  assert.deepEqual(m.userConfig.language.options, personalSchema.props.language.enum)
  assert.deepEqual(m.userConfig.chat_detail.options, personalSchema.props.report.props.chat_detail.enum)
})

test('marketplace.json lists wb from the repository root', () => {
  const mk = json('.claude-plugin/marketplace.json')
  assert.equal(mk.plugins.length, 1)
  assert.equal(mk.plugins[0].name, 'wb')
  assert.equal(mk.plugins[0].source, './')
})

test('hooks.json skeleton has the hooks wrapper', () => {
  const h = json('hooks/hooks.json')
  assert.equal(typeof h.hooks, 'object')
})

test('directory skeleton exists', () => {
  for (const d of ['hooks', 'hooks/scripts', 'skills', 'agents', 'bin', 'templates', 'rules', 'defaults', 'locales']) {
    assert.ok(fs.statSync(path.join(ROOT, d)).isDirectory(), d)
  }
  assert.ok(fs.statSync(path.join(ROOT, 'bin', 'wb-config')).mode & 0o111, 'wb-config executable')
})

test('locales ko and en have the same keys, and every task has a label', () => {
  const ko = json('locales/ko.json')
  const en = json('locales/en.json')
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort())
  for (const task of Object.keys(json('defaults/routing.json').tasks)) {
    assert.ok(ko[`task.${task}`] && en[`task.${task}`], task)
  }
})

test('defaults carry no denied model and the agreed caps', () => {
  assert.deepEqual(json('defaults/routing.json').denied, [])
  const m = json('defaults/machine.json')
  assert.equal(m.lanes.max, 3)
  assert.equal(m.slots.heavy.count, 2)
  assert.equal(m.slots.browser.count, 2)
  assert.deepEqual(m.ports.protected, [])
  const p = json('defaults/personal.json')
  assert.equal(p.report.chat_detail, 'summary')
  assert.equal(p.auto_retry.permission_mode, 'default')
})

// Assembled from parts so this file does not match itself.
const FORBIDDEN = [
  ['ga', 'ea'],
  ['gst', 'udio'],
  ['wook', '8170'],
  ['/Vol', 'umes/'],
  ['/Us', 'ers/'],
  ['claude-', 'scratch'],
  ['@gm', 'ail'],
  ['Or', 'ca'],
].map((p) => p.join(''))

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '__pycache__') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

test('no project-specific, personal or machine-specific strings in the repository', () => {
  const hits = []
  for (const f of walk(ROOT)) {
    const body = fs.readFileSync(f, 'utf8')
    for (const s of FORBIDDEN) if (body.toLowerCase().includes(s.toLowerCase())) hits.push(`${path.relative(ROOT, f)}: ${s}`)
  }
  assert.deepEqual(hits, [])
})
