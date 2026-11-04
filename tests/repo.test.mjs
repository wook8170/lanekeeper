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
  ['wj', 'ang'],
  ['lic', 'admin'],
  ['pg', 'test'],
  ['claude.ai/code/', 'session'],
].map((p) => p.join(''))

// General patterns (design 6.2-2): private addresses, personal mail, home folders.
// Customer names are not listed here; the owner runs that list on their own machine.
const FORBIDDEN_RE = [
  [/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'private IPv4 10/8'],
  [/\b192\.168\.\d{1,3}\.\d{1,3}\b/, 'private IPv4 192.168/16'],
  [/\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/, 'private IPv4 172.16/12'],
  [/[A-Za-z0-9._%+-]+@(?!example\.(com|org)\b|anthropic\.com\b)[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[a-z]{2,}\b/, 'mail address'],
  [/\/home\/(?!user\b)[a-z][a-z0-9_-]*\//, 'home folder'],
]

// Public contact the owner chose for publication (owner decision 2026-10-17):
// copyright holder name and the security contact mail. Allowed only in these
// files and only as this exact string; anything else still trips the guard.
const PUBLIC_CONTACT = ['wook8', '1701', '@gm', 'ail.com'].join('')
const PUBLIC_CONTACT_FILES = new Set([
  'SECURITY.md', 'SECURITY.ko.md', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json',
])

// Public GitHub install names (owner decision 2026-11-05): the plugin
// repository, the combined marketplace repository and its marketplace name.
// Allowed only in the READMEs and only as these exact strings.
const PUBLIC_OWNER = ['wook', '8170'].join('')
const PUBLIC_INSTALL = [`${PUBLIC_OWNER}/wb-plugin`, `${PUBLIC_OWNER}/claude-plugins`, `wb@${PUBLIC_OWNER}-plugins`]
const PUBLIC_INSTALL_FILES = new Set(['README.md', 'README.ko.md'])

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
    let body = fs.readFileSync(f, 'utf8')
    const rel = path.relative(ROOT, f).split(path.sep).join('/')
    if (PUBLIC_CONTACT_FILES.has(rel)) body = body.split(PUBLIC_CONTACT).join('')
    if (PUBLIC_INSTALL_FILES.has(rel)) for (const s of PUBLIC_INSTALL) body = body.split(s).join('')
    for (const s of FORBIDDEN) if (body.toLowerCase().includes(s.toLowerCase())) hits.push(`${path.relative(ROOT, f)}: ${s}`)
    for (const [re, name] of FORBIDDEN_RE) {
      const m = re.exec(body)
      if (m) hits.push(`${path.relative(ROOT, f)}: ${name} (${m[0]})`)
    }
  }
  assert.deepEqual(hits, [])
})

test('copyright holder and contact are filled in (no placeholder left)', () => {
  const files = ['LICENSE', 'SECURITY.md', 'SECURITY.ko.md', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']
  for (const f of files) assert.doesNotMatch(read(f), /[A-Z_]+_PLACEHOLDER/, f)
  assert.match(read('LICENSE'), /^Copyright \(c\) 2026 윤결파파$/m)
  assert.equal(json('.claude-plugin/plugin.json').author.name, '윤결파파')
  assert.equal(json('.claude-plugin/marketplace.json').owner.name, '윤결파파')
  for (const f of ['SECURITY.md', 'SECURITY.ko.md']) assert.ok(read(f).includes(PUBLIC_CONTACT), f)
})

test('README and SECURITY: English first with a language switch, Korean in *.ko.md', () => {
  for (const base of ['README', 'SECURITY']) {
    const en = read(`${base}.md`)
    const ko = read(`${base}.ko.md`)
    assert.ok(!fs.existsSync(path.join(ROOT, `${base}.en.md`)), `${base}.en.md is gone`)
    assert.match(en.split('\n')[1], new RegExp(`^\\*\\*English\\*\\* · \\[한국어\\]\\(${base}\\.ko\\.md\\)$`), `${base}.md switch line`)
    assert.match(ko.split('\n')[1], new RegExp(`^\\[English\\]\\(${base}\\.md\\) · \\*\\*한국어\\*\\*$`), `${base}.ko.md switch line`)
  }
  // install commands and requirements sit on the first screen of both READMEs
  for (const f of ['README.md', 'README.ko.md']) {
    const head = read(f).split('\n').slice(0, 25).join('\n')
    assert.match(head, /claude plugin marketplace add \S+\/claude-plugins/, f)
    assert.match(head, /claude plugin marketplace add \S+\/wb-plugin/, f)
    assert.match(head, /Node\.js 18\.19/, f)
    assert.match(head, /Claude Code 2\.1\.295/, f)
  }
})

test('plugin icon: square PNG 512-2048 px under 2 MB, baked from the committed SVG', () => {
  const png = fs.readFileSync(path.join(ROOT, '.claude-plugin', 'icon.png'))
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG')
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  assert.equal(w, h)
  assert.ok(w >= 512 && w <= 2048, String(w))
  assert.ok(png.length < 2 * 1024 * 1024)
  assert.match(read('.claude-plugin/icon.svg'), /<svg[^>]*viewBox="0 0 512 512"/)
})
