// User manual (docs/) against the code: skill names, lanekeeper-* commands and their
// subcommands, settings keys with their defaults, rule and skill counts, the
// generated rules chapter, links, and the Korean/English pair.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMAS } from '../lib/schema.mjs'
import { collectSources, mergeSources, getPath } from '../lib/config.mjs'
import { loadCatalog, renderManual } from '../lib/rules.mjs'
import { translator } from '../lib/i18n.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const LANGS = ['ko', 'en']
const CHAPTERS = ['01-getting-started.md', '02-features.md', '03-configuration.md', '04-rules.md', '05-troubleshooting.md']
const docFiles = () => ['docs/README.md', ...LANGS.flatMap((l) => CHAPTERS.map((c) => `docs/${l}/${c}`))]
const doc = (lang, chapter) => read(`docs/${lang}/${chapter}`)

const skills = () => fs.readdirSync(path.join(ROOT, 'skills')).filter((d) => fs.existsSync(path.join(ROOT, 'skills', d, 'SKILL.md'))).sort()
const commands = () => fs.readdirSync(path.join(ROOT, 'bin')).filter((f) => f.startsWith('lanekeeper-')).sort()

// Skills that messages mention but this release does not ship. Each entry must
// still be mentioned by a locale message; remove it when the skill lands.
const ABSENT_SKILLS = {}

// lanekeeper-* words that are names, not commands.
const NOT_COMMANDS = new Set(['lanekeeper', 'lanekeeper-brief', 'lanekeeper-decision', 'lanekeeper-gate-pass', 'lanekeeper-scratch'])

// Leaf keys of the settings schema. A map with default entries contributes one
// key per entry (project.paths.briefs …); other maps count as one key.
function leafKeys(defaults) {
  const out = []
  const walk = (s, p) => {
    if (s.type === 'object') for (const [k, v] of Object.entries(s.props)) walk(v, `${p}.${k}`)
    else if (s.type === 'map' && p === 'project.paths') for (const k of Object.keys(getPath(defaults, p))) out.push(`${p}.${k}`)
    else out.push(p)
  }
  for (const [ns, s] of Object.entries(SCHEMAS)) walk(s, ns)
  return out
}

function mergedDefaults() {
  const { sources } = collectSources({ projectDir: null, env: { HOME: '/nonexistent', LANEKEEPER_HOME: '/nonexistent-lanekeeper-home' } })
  return mergeSources(sources).config
}

// Does a dotted key name a settings path (a leaf, a section, or an entry of a map)?
function isSettingsPath(key) {
  const parts = key.split('.')
  let s = SCHEMAS[parts[0]]
  if (!s) return false
  for (const part of parts.slice(1)) {
    if (s.type === 'object') {
      if (!s.props[part]) return false
      s = s.props[part]
    } else if (s.type === 'map') s = s.values
    else return false
  }
  return true
}

// Rows of a reference table: | `key` | default | … |
function keyRows(text) {
  const rows = new Map()
  for (const line of text.split('\n')) {
    const m = line.match(/^\| `((?:routing|machine|personal|project)\.[A-Za-z0-9_.]+)` \| (.*?) \|/)
    if (m) rows.set(m[1], m[2].trim())
  }
  return rows
}

const codeSpans = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
const codeBlockLines = (text) => [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n'))

test('docs: every chapter exists in Korean and English, and the root README links the manual', () => {
  for (const f of docFiles()) assert.ok(fs.existsSync(path.join(ROOT, f)), f)
  const index = read('docs/README.md')
  for (const l of LANGS) for (const c of CHAPTERS) assert.ok(index.includes(`${l}/${c}`), `docs/README.md links ${l}/${c}`)
  assert.ok(read('README.md').includes('docs/README.md'), 'README.md links the manual')
  assert.ok(read('README.ko.md').includes('docs/README.md'), 'README.ko.md links the manual')
})

test('docs: the rules chapter is generated from the catalog (lanekeeper-rules manual --write)', () => {
  const rules = loadCatalog()
  for (const l of LANGS) assert.equal(doc(l, '04-rules.md'), renderManual(rules, l, translator(l)), `docs/${l}/04-rules.md is stale`)
})

test('docs: rules chapter lists every catalog rule once', () => {
  const rules = loadCatalog()
  for (const l of LANGS) {
    const text = doc(l, '04-rules.md')
    for (const r of rules) assert.equal(text.split(`(\`${r.id}\`)`).length - 1, 1, `${l}: ${r.id}`)
  }
})

test('docs: every skill has its own section in the features chapter, and no unknown skill is named', () => {
  const names = skills()
  for (const l of LANGS) {
    const text = doc(l, '02-features.md')
    const headings = [...text.matchAll(/^### \/lanekeeper:([a-z0-9-]+)$/gm)].map((m) => m[1]).sort()
    assert.deepEqual(headings, names, `${l}: skill sections`)
  }
  const messages = read('locales/ko.json') + read('locales/en.json')
  for (const [name, key] of Object.entries(ABSENT_SKILLS)) {
    assert.ok(!names.includes(name), `${name} ships now; drop it from ABSENT_SKILLS`)
    assert.ok(messages.includes(`/lanekeeper:${name}`) && messages.includes(`"${key}"`), `${name} no longer mentioned by ${key}`)
  }
  for (const f of docFiles()) {
    for (const m of read(f).matchAll(/\/lanekeeper:([a-z][a-z0-9-]*)/g)) {
      assert.ok(names.includes(m[1]) || m[1] in ABSENT_SKILLS, `${f}: /lanekeeper:${m[1]} is not a skill`)
    }
  }
})

test('docs: stated skill and rule counts match the code', () => {
  const nSkills = skills().length
  const nRules = loadCatalog().length
  const patterns = [
    [/스킬 (\d+)개/g, nSkills, 'skills'],
    [/(\d+) skills/g, nSkills, 'skills'],
    [/규칙 (\d+)개/g, nRules, 'rules'],
    [/(\d+) rules/g, nRules, 'rules'],
  ]
  let seen = 0
  for (const f of docFiles()) {
    const text = read(f)
    for (const [re, want, what] of patterns) {
      for (const m of text.matchAll(re)) {
        seen++
        assert.equal(Number(m[1]), want, `${f}: "${m[0]}" (${what})`)
      }
    }
  }
  assert.ok(seen >= 4, 'the manual states the counts')
})

test('docs: every lanekeeper-* command exists, and every subcommand appears in the command usage', () => {
  const bins = new Set(commands())
  const usage = Object.fromEntries([...bins].map((b) => [b, read(`bin/${b}`).split('\n').filter((l) => l.startsWith('//')).join('\n')]))
  for (const f of docFiles()) {
    const text = read(f)
    for (const m of text.matchAll(/\blanekeeper-[a-z][a-z-]*[a-z]\b/g)) {
      if (NOT_COMMANDS.has(m[0])) continue
      assert.ok(bins.has(m[0]), `${f}: ${m[0]} is not a command in bin/`)
    }
    for (const line of [...codeSpans(text), ...codeBlockLines(text)]) {
      const m = line.trim().replace(/^\$ /, '').match(/^(lanekeeper-[a-z-]+) ([a-z][a-z-]*)\b/)
      if (!m || !bins.has(m[1])) continue
      assert.match(usage[m[1]], new RegExp(`\\b${m[2]}\\b`), `${f}: \`${m[1]} ${m[2]}\` is not in the usage of ${m[1]}`)
    }
  }
})

test('docs: the configuration chapter has a row for every settings key, with the real default', () => {
  const defaults = mergedDefaults()
  const keys = leafKeys(defaults)
  for (const l of LANGS) {
    const rows = keyRows(doc(l, '03-configuration.md'))
    for (const k of keys) assert.ok(rows.has(k), `${l}: no row for ${k}`)
    for (const [k, cell] of rows) {
      assert.ok(keys.includes(k), `${l}: row for unknown key ${k}`)
      const m = cell.match(/^`(.+)`$/)
      if (!m) continue
      assert.deepEqual(JSON.parse(m[1]), getPath(defaults, k), `${l}: default of ${k}`)
    }
  }
})

test('docs: every settings key named anywhere in the manual exists', () => {
  for (const f of docFiles()) {
    for (const span of codeSpans(read(f))) {
      const m = span.match(/^((?:routing|machine|personal|project)\.[A-Za-z0-9_.]+?)(?:\.\*)?(?:[ :=].*)?$/)
      if (!m || /\.(json|md|mjs)$/.test(m[1])) continue
      assert.ok(isSettingsPath(m[1]), `${f}: \`${span}\` names no settings key`)
    }
  }
})

test('docs: relative links point to existing files', () => {
  for (const f of [...docFiles(), 'README.md', 'README.ko.md', 'SECURITY.md', 'SECURITY.ko.md']) {
    const dir = path.dirname(path.join(ROOT, f))
    for (const m of read(f).matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
      if (/^[a-z]+:/.test(m[1])) continue
      assert.ok(fs.existsSync(path.resolve(dir, m[1])), `${f}: broken link ${m[1]}`)
    }
  }
})

test('docs: Korean and English chapters have the same outline', () => {
  for (const c of CHAPTERS) {
    const count = (t, re) => (t.match(re) || []).length
    const [ko, en] = LANGS.map((l) => doc(l, c))
    assert.equal(count(ko, /^## /gm), count(en, /^## /gm), `${c}: sections`)
    assert.equal(count(ko, /^### /gm), count(en, /^### /gm), `${c}: subsections`)
    assert.equal(count(ko, /^```/gm), count(en, /^```/gm), `${c}: code fences`)
    assert.deepEqual([...keyRows(ko).keys()], [...keyRows(en).keys()], `${c}: key rows`)
  }
})

test('docs: npm pack includes the manual', () => {
  const pkg = JSON.parse(read('package.json'))
  if (pkg.files) assert.ok(pkg.files.some((f) => f === 'docs' || f.startsWith('docs/')), 'package.json files lists docs')
  for (const ignore of ['.npmignore', '.gitignore']) {
    if (!fs.existsSync(path.join(ROOT, ignore))) continue
    const lines = read(ignore).split('\n').map((l) => l.trim())
    assert.ok(!lines.some((l) => /^\/?docs\/?$/.test(l)), `${ignore} excludes docs`)
  }
})

test('lanekeeper-rules manual: prints the chapter in reading order (git first, planned last), numbered 1..n', async () => {
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync(process.execPath, [path.join(ROOT, 'bin', 'lanekeeper-rules'), 'manual', '--lang', 'en'], {
    encoding: 'utf8',
    env: { ...process.env, LANEKEEPER_HOME: '/nonexistent-lanekeeper-home' },
  })
  const rules = loadCatalog()
  assert.equal(out, renderManual(rules, 'en', translator('en')))
  const nums = [...out.matchAll(/^### (\d+)\. /gm)].map((m) => Number(m[1]))
  assert.deepEqual(nums, rules.map((_, i) => i + 1))
  const groups = [...out.matchAll(/^## (.+)$/gm)].map((m) => m[1])
  assert.equal(groups[0], 'Rule list')
  assert.equal(groups[1], translator('en')('rules.group.git'))
  assert.equal(groups.at(-1), translator('en')('rules.group.planned'))
})
