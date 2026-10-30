// Adversarial UX check: the skill, its references, the checker agent and the briefs.
// The precheck and ship gate side (advisory kinds) is in quality.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkBrief, parseMarker } from '../lib/brief.mjs'
import { classify } from '../lib/route.mjs'

const routing = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'defaults/routing.json'), 'utf8'))

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const SKILL = 'skills/quality-ux-adversarial'

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(m, 'frontmatter')
  return Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))
}

const fill = (text) => text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => (k === 'base_sha' ? '1a2b3c4d5e' : `x-${k}`))

test('ux-adversarial skill: frontmatter, the owner rules and every reference it links', () => {
  const text = read(`${SKILL}/SKILL.md`)
  const fm = frontmatter(text)
  assert.equal(fm.name, 'quality-ux-adversarial')
  assert.match(fm.description, /\/wb:quality-ux-adversarial/)
  for (const must of [
    /wb:ux-adversary/, /fable/i, /opus/i, // separate context, model
    /No product code changes/i,
    /what the user goes through, in one sentence/i, /computed style/i, /injecting DOM or CSS/i,
    /blocker/, /high/, /medium/, /low/,
    /① Data correctness/, /② Location/, /③ What to do/, /④ Flow continuity/, /⑤ Visual consistency/, /same weight/i,
    /artifact/i, /owner confirms/i, /checks? (them |those findings )?again/i,
    /headless/i, /2x/, /--hide-scrollbars/,
    /dark/i, /narrow/i, /keyboard only/i, /no permission/i, /empty state/i, /long names/i, /leaving before saving/i, /deep link/i,
    /other front-end implementation/i, /parity/i,
    /wb-quality record ux-adversarial/, /quality\.ship\.advisory/, /quality\.ship\.requires/,
  ]) assert.match(text, must)
  for (const m of text.matchAll(/\]\((references\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(ROOT, SKILL, m[1])), m[1])
  for (const f of ['brief.ko.md', 'brief.en.md', 'findings.md', 'artifact.md', 'inject-capture.md']) assert.ok(text.includes(`references/${f}`), f)
})

test('ux-adversarial skill and quality-usability point to each other', () => {
  assert.match(read('skills/quality-usability/SKILL.md'), /\/wb:quality-ux-adversarial/)
  assert.match(read(`${SKILL}/SKILL.md`), /\/wb:quality-usability/)
})

test('ux-adversary agent: read-only toward the product, no edit tool, writes only its result folder', () => {
  const text = read('agents/ux-adversary.md')
  const fm = frontmatter(text)
  assert.equal(fm.name, 'ux-adversary')
  const tools = fm.tools.split(',').map((s) => s.trim())
  assert.ok(!tools.includes('Edit') && !tools.includes('NotebookEdit') && !tools.includes('Agent'), fm.tools)
  assert.ok(tools.includes('Write'), 'writes its findings')
  assert.match(text, /read-only/i)
  assert.match(text, /only inside the result folder/i)
  assert.match(text, /do not commit/i)
  assert.match(text, /headless/i)
  assert.match(text, /--hide-scrollbars/)
  assert.equal(classify({ routing, subagentType: 'wb:ux-adversary' }).type, 'adversarial', 'the agent name routes as adversarial without a brief type')
})

test('ux-adversarial briefs: pass the dispatch brief check once filled, route as adversarial, same outline ko/en', () => {
  const outline = []
  for (const lang of ['ko', 'en']) {
    const text = read(`${SKILL}/references/brief.${lang}.md`)
    const m = parseMarker(text)
    assert.equal(m.attrs.type, 'adversarial', 'routes away from the implementer model')
    assert.equal(m.attrs.role, 'verifier')
    assert.equal(classify({ routing, marker: m }).type, 'adversarial')
    const unfilled = checkBrief(text)
    assert.equal(unfilled.ok, false, 'an unfilled brief is refused')
    assert.ok(unfilled.placeholder)
    const r = checkBrief(fill(text))
    assert.deepEqual(r.missing, [], `${lang}: ${r.missing.join(', ')}`)
    assert.equal(r.ok, true)
    outline.push([...text.matchAll(/^#{1,3} /gm)].length)
    assert.match(text, /--hide-scrollbars/)
    assert.match(text, /⑤/)
  }
  assert.equal(outline[0], outline[1])
})

test('ux-adversarial references: counts format matches what wb-quality record reads', () => {
  const text = read(`${SKILL}/references/findings.md`)
  const json = text.match(/```json\n([\s\S]*?)```/)[1]
  const j = JSON.parse(json)
  for (const k of ['total', 'passed', 'failed', 'skipped', 'fixme', 'flaky']) assert.equal(typeof j.counts[k], 'number', k)
  assert.equal(j.counts.total, j.counts.passed + j.counts.failed + j.counts.skipped)
  assert.ok(Array.isArray(j.failures) && j.failures[0].name)
  const inject = read(`${SKILL}/references/inject-capture.md`)
  assert.match(inject, /ignoreDefaultArgs: \['--hide-scrollbars'\]/)
  assert.match(inject, /deviceScaleFactor: 2/)
  assert.match(inject, /headless: true/)
})
