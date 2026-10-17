// L7: wb-art (WebP, report HTML), wb-defects export, mockup-first and artifact-check hooks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { makeEnv, git, bin, runScript, ROOT } from './l3-fixture.mjs'
import * as A from '../lib/art.mjs'
import * as C from '../lib/cases.mjs'
import { translator } from '../lib/i18n.mjs'
import { handle as mockup, isStructural, tags } from '../hooks/scripts/mockup/mockup-first.mjs'
import { handle as artifactCheck, scan } from '../hooks/scripts/report/artifact-check.mjs'

// ---- PNG fixture -------------------------------------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
// RGB PNG; noisy = random pixels (does not compress, so the file is big)
function png(file, w, h, noisy) {
  const rows = []
  for (let y = 0; y < h; y++) rows.push(Buffer.concat([Buffer.from([0]), noisy ? crypto.randomBytes(w * 3) : Buffer.alloc(w * 3, 200)]))
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]))
  return file
}
const fakeConverter = { name: 'fake', run: (src, dst, q) => (fs.writeFileSync(dst, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from(`q${q}`)])), true) }
const realConverter = A.findConverter(process.env)

test('placeFiles: a PNG over 300KB becomes WebP, a small one stays PNG', () => {
  const fx = makeEnv()
  const big = png(path.join(fx.base, 'big.png'), 400, 300, true)
  const small = png(path.join(fx.base, 'small.png'), 40, 30, false)
  assert.ok(fs.statSync(big).size > 300 * 1024)
  const out = A.placeFiles([big, small], path.join(fx.base, 'keep'), { converter: fakeConverter })
  assert.equal(out[0].converted, true)
  assert.equal(path.basename(out[0].dest), 'big.webp')
  assert.ok(A.isWebp(fs.readFileSync(out[0].dest)))
  assert.match(fs.readFileSync(out[0].dest, 'utf8'), /q80/)
  assert.equal(out[1].converted, false)
  assert.equal(path.basename(out[1].dest), 'small.png')
  // threshold and quality come from the settings
  const tuned = A.placeFiles([small], path.join(fx.base, 'k2'), { converter: fakeConverter, webp: { over_kb: 0, quality: 55 } })
  assert.match(fs.readFileSync(tuned[0].dest, 'utf8'), /q55/)
  // no converter: copied with a warning
  const none = A.placeFiles([big], path.join(fx.base, 'k3'), { converter: null })
  assert.equal(none[0].warn, 'no_converter')
  assert.equal(path.basename(none[0].dest), 'big.png')
})

test('wb-art keep: real conversion to WebP under docs/reports/artifacts/<slug>/', { skip: !realConverter && 'no cwebp or Pillow on this machine' }, () => {
  const fx = makeEnv()
  const big = png(path.join(fx.base, 'after.png'), 400, 300, true)
  const r = bin('wb-art', ['keep', big, '--slug', 'list-search', '--json'], fx.env, fx.repo)
  assert.equal(r.status, 0, r.stderr)
  const [row] = JSON.parse(r.stdout)
  assert.equal(row.converted, true)
  assert.equal(row.dest, path.join(fx.repo, 'docs', 'reports', 'artifacts', 'list-search', 'after.webp'))
  assert.ok(A.isWebp(fs.readFileSync(row.dest)))
})

test('wb-art temp goes to the scratch folder and never converts', () => {
  const fx = makeEnv()
  const big = png(path.join(fx.base, 'x.png'), 400, 300, true)
  const r = bin('wb-art', ['temp', big, '--slug', 's1', '--json'], fx.env, fx.repo)
  assert.equal(r.status, 0, r.stderr)
  const [row] = JSON.parse(r.stdout)
  assert.equal(row.converted, false)
  assert.ok(row.dest.startsWith(path.join(fx.env.HOME, '.wb-scratch', 'repo', 'art', 's1')))
  assert.equal(bin('wb-art', ['keep', path.join(fx.base, 'missing.png')], fx.env, fx.repo).status, 2)
})

test('wb-art report: one HTML file, images embedded, Markdown rendered and escaped', () => {
  const fx = makeEnv({ WB_ART_CONVERTER: 'none' })
  const before = png(path.join(fx.base, 'before.png'), 40, 30, false)
  const after = png(path.join(fx.base, 'after.png'), 40, 30, false)
  const md = path.join(fx.base, 'r.md')
  fs.writeFileSync(md, '## Result\n\n| item | value |\n|---|---|\n| tests | **12** passed |\n\n- one\n- two <script>x</script>\n\n```\ncode <b>\n```\n')
  const out = path.join(fx.base, 'out', 'report.html')
  const r = bin('wb-art', ['report', '--title', 'List search', '--md', md, '--image', `Before=${before}`, '--image', `After=${after}`, '--out', out], fx.env, fx.repo)
  assert.equal(r.status, 0, r.stderr)
  const html = fs.readFileSync(out, 'utf8')
  assert.match(html, /<title>List search<\/title>/)
  assert.equal((html.match(/src="data:image\/png;base64,/g) || []).length, 2)
  assert.match(html, /<table>.*<strong>12<\/strong>/s)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script/)
  assert.doesNotMatch(html, /src="https?:/)
  assert.match(html, /prefers-color-scheme: dark/)
  assert.match(html, /<figcaption>Before<\/figcaption>/)
})

test('wb-art report embeds a big PNG as WebP', { skip: !realConverter && 'no cwebp or Pillow on this machine' }, () => {
  const fx = makeEnv()
  const big = png(path.join(fx.base, 'big.png'), 400, 300, true)
  const md = path.join(fx.base, 'r.md')
  fs.writeFileSync(md, 'text\n')
  const r = bin('wb-art', ['report', '--title', 'T', '--md', md, '--image', `After=${big}`, '--slug', 'x', '--json'], fx.env, fx.repo)
  assert.equal(r.status, 0, r.stderr)
  const { file } = JSON.parse(r.stdout)
  assert.match(fs.readFileSync(file, 'utf8'), /src="data:image\/webp;base64,/)
})

// ---- defects -------------------------------------------------------------------

test('wb-defects summary and export (Markdown always, xlsx with openpyxl)', () => {
  const fx = makeEnv()
  const dir = path.join(fx.repo, 'docs', 'e2e')
  C.addDefect(dir, { title: 'Sort lost after reload', severity: 'high', cases: ['LIST-003'], lane: 'l2' })
  C.addDefect(dir, { title: 'Typo | pipe', severity: 'low' })
  C.resolveDefect(dir, 'D-002', { status: 'fixed' })
  const s = JSON.parse(bin('wb-defects', ['summary', '--json'], fx.env, fx.repo).stdout)
  assert.deepEqual(s, { total: 2, status: { open: 1, fixed: 1, wontfix: 0 }, open_by_severity: { critical: 0, high: 1, medium: 0, low: 0 }, open_ids: ['D-001'] })
  const md = C.defectsMarkdown(dir, translator('ko'))
  assert.match(md, /# 결함 대장/)
  assert.match(md, /\| D-001 \| 높음 \| 열림 \| LIST-003 \|/)
  assert.match(md, /Typo \\\| pipe/)
  // the fixture HOME hides a user-site openpyxl; point Python at the real user base
  const userBase = spawnSync('python3', ['-m', 'site', '--user-base'], { encoding: 'utf8' }).stdout.trim()
  const env = { ...fx.env, PYTHONUSERBASE: userBase }
  const hasXlsx = spawnSync('python3', ['-c', 'import openpyxl'], { env }).status === 0
  const r = bin('wb-defects', ['export'], env, fx.repo)
  assert.ok(fs.existsSync(path.join(dir, 'defect-register.md')))
  if (hasXlsx) {
    assert.equal(r.status, 0, r.stderr)
    const x = path.join(dir, 'defect-register.xlsx')
    assert.equal(fs.readFileSync(x).subarray(0, 2).toString(), 'PK')
    const rows = spawnSync('python3', ['-c', 'import sys,openpyxl;ws=openpyxl.load_workbook(sys.argv[1]).active;print(ws.max_row, ws["A2"].value, ws["B2"].value)', x], { encoding: 'utf8', env }).stdout.trim()
    assert.equal(rows, '3 D-001 high')
  } else assert.equal(r.status, 3)
  const noPy = bin('wb-defects', ['export', '--format', 'xlsx', '--out', path.join(fx.base, 'x')], { ...fx.env, WB_PYTHON: '/nonexistent/python' }, fx.repo)
  assert.equal(noPy.status, 3)
})

// ---- mockup-first --------------------------------------------------------------

function mockupRepo(config) {
  const fx = makeEnv()
  fs.mkdirSync(path.join(fx.repo, '.wb'))
  fs.writeFileSync(path.join(fx.repo, '.wb', 'config.json'), JSON.stringify({ version: 1, ...config }))
  fs.mkdirSync(path.join(fx.repo, 'src', 'list'), { recursive: true })
  fs.writeFileSync(path.join(fx.repo, 'src', 'list', 'List.tsx'), 'export const List = () => <ul className="a"><li>Item</li></ul>\n')
  fs.writeFileSync(path.join(fx.repo, 'src', 'list', 'list.css'), '.list { display: block; }\n')
  const call = (tool, file, ti) => mockup({ tool_name: tool, cwd: fx.repo, tool_input: { file_path: path.join(fx.repo, file), ...ti } }, fx.env)
  return { ...fx, call }
}
const UI = { mockup: { ui_globs: ['src/**/*.{tsx,css}'], decision_required: true } }
const denied = (r) => r?.hookSpecificOutput?.permissionDecision === 'deny'

test('mockup-first: off without ui_globs or with decision_required false', () => {
  assert.equal(mockupRepo({}).call('Write', 'src/list/New.tsx', { content: '<div/>' }), null)
  assert.equal(mockupRepo({ mockup: { ui_globs: ['src/**'], decision_required: false } }).call('Write', 'src/list/New.tsx', { content: '<div/>' }), null)
})

test('mockup-first: structure changes are blocked, text and property edits pass', () => {
  const m = mockupRepo(UI)
  assert.ok(denied(m.call('Write', 'src/list/Search.tsx', { content: 'export const S = () => <input />\n' })), 'new UI file')
  assert.ok(denied(m.call('Edit', 'src/list/List.tsx', { old_string: '<li>Item</li>', new_string: '<li>Item</li><li><button>More</button></li>' })), 'new elements')
  assert.equal(m.call('Edit', 'src/list/List.tsx', { old_string: '<li>Item</li>', new_string: '<li>Entry</li>' }), null, 'text only')
  assert.equal(m.call('Edit', 'src/list/List.tsx', { old_string: 'className="a"', new_string: 'className="b"' }), null, 'attribute only')
  assert.equal(m.call('Edit', 'src/list/list.css', { old_string: 'display: block;', new_string: 'display: grid;' }), null, 'css property')
  assert.ok(denied(m.call('Edit', 'src/list/list.css', { old_string: '.list { display: block; }', new_string: '.list { display: block; }\n.list__row { gap: 4px; }' })), 'new selector')
  assert.ok(denied(m.call('MultiEdit', 'src/list/List.tsx', { edits: [{ old_string: 'Item', new_string: 'Entry' }, { old_string: '</ul>', new_string: '</ul><nav />' }] })), 'multi edit')
  assert.equal(m.call('Write', 'src/list/List.tsx', { content: 'export const List = () => <ul className="z"><li>Other</li></ul>\n' }), null, 'rewrite, same tags')
  assert.equal(m.call('Write', 'README.md', { content: '<div>' }), null, 'not a UI path')
  assert.deepEqual(tags('<A><b.c x="<1"/></A>'), ['A', 'b.c'])
  assert.equal(isStructural('Edit', { old_string: 'a', new_string: 'b' }, '/x/y.tsx'), false)
})

test('mockup-first: a recorded decision whose scope covers the file unlocks it', () => {
  const m = mockupRepo(UI)
  const dir = path.join(m.repo, 'docs', 'decisions')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '2026-10-17-table.md'), '<!-- wb-decision v1 kind=mockup scope=src/table/** -->\n# Table\n')
  assert.ok(denied(m.call('Write', 'src/list/Search.tsx', { content: '<input />' })), 'scope elsewhere')
  fs.writeFileSync(path.join(dir, '2026-10-17-list.md'), '<!-- wb-decision v1 kind=mockup scope=src/list/**,src/shared/Pager.tsx -->\n# List search\nChoice: B\n')
  assert.equal(m.call('Write', 'src/list/Search.tsx', { content: '<input />' }), null)
  assert.ok(denied(m.call('Write', 'src/other/X.tsx', { content: '<i />' })))
  fs.writeFileSync(path.join(dir, '2026-10-17-all.md'), '<!-- wb-decision v1 kind=mockup -->\n')
  assert.equal(m.call('Write', 'src/other/X.tsx', { content: '<i />' }), null, 'no scope covers every UI file')
})

test('mockup-first hook process: three-part Korean message, registered in hooks.json', () => {
  const m = mockupRepo(UI)
  const r = runScript('hooks/scripts/mockup/mockup-first.mjs', { tool_name: 'Write', cwd: m.repo, tool_input: { file_path: path.join(m.repo, 'src/list/New.tsx'), content: '<p/>' } }, { ...m.env, LANG: 'ko_KR.UTF-8' })
  assert.equal(r.status, 0)
  const reason = r.out.hookSpecificOutput.permissionDecisionReason
  assert.match(reason, /막았습니다: src\/list\/New\.tsx/)
  assert.match(reason, /이렇게 고치세요: .*wb-decision v1 kind=mockup scope=src\/list\/New\.tsx/)
  assert.match(reason, /물어볼 곳: /)
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
  assert.ok(h.hooks.PreToolUse.some((e) => e.matcher === 'Write|Edit|MultiEdit' && e.hooks.some((x) => x.command.endsWith('mockup/mockup-first.mjs'))))
  assert.ok(h.hooks.Stop[0].hooks.some((x) => x.command.endsWith('report/artifact-check.mjs')))
})

// ---- artifact-check ------------------------------------------------------------

const use = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
const say = (text) => ({ type: 'user', message: { content: text } })
function transcript(fx, rows) {
  const f = path.join(fx.base, `t-${crypto.randomUUID()}.jsonl`)
  fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return f
}

test('artifact-check: scan finds the report stage and what came after it', () => {
  assert.deepEqual(scan([say('hello'), use('Artifact', {})]), { start: -1, artifact: false, htmlFile: false })
  assert.equal(scan([use('Artifact', {}), use('Skill', { skill: 'wb:report' })]).artifact, false, 'artifact before the stage does not count')
  assert.equal(scan([say('<command-name>/wb:report</command-name>'), use('Artifact', { action: 'publish' })]).artifact, true)
  assert.equal(scan([use('Skill', { skill: 'report' }), use('Bash', { command: 'wb-art report --title x --md r.md' })]).htmlFile, true)
})

test('artifact-check: blocks once at the report stage without an artifact', () => {
  const fx = makeEnv()
  const input = (rows, extra = {}) => ({ session_id: 's1', cwd: fx.repo, transcript_path: transcript(fx, rows), ...extra })
  assert.equal(artifactCheck(input([say('done'), use('Bash', { command: 'ls' })]), fx.env), null, 'not a report stage')
  const rows = [use('Skill', { skill: 'wb:report' }), use('Bash', { command: 'wb-defects export' })]
  const first = artifactCheck(input(rows), fx.env)
  assert.equal(first.decision, 'block')
  assert.match(first.reason, /artifact/i)
  assert.equal(artifactCheck(input(rows), fx.env), null, 'once per report')
  assert.equal(artifactCheck(input(rows, { session_id: 's2', stop_hook_active: true }), fx.env), null)
  assert.equal(artifactCheck(input([...rows, use('Artifact', { file_path: 'r.html' })], { session_id: 's3' }), fx.env), null)
  assert.equal(artifactCheck(input([...rows, use('Bash', { command: 'wb-art report --title T --md r.md' })], { session_id: 's4' }), fx.env), null, 'html fallback')
  fx.personal({ report: { artifact_fallback: 'none' } })
  assert.equal(artifactCheck(input([...rows, use('Bash', { command: 'wb-art report --title T --md r.md' })], { session_id: 's5' }), fx.env).decision, 'block', 'fallback off')
  fx.personal({ report: { artifact_check: false } })
  assert.equal(artifactCheck(input(rows, { session_id: 's6' }), fx.env), null, 'switched off')
})

test('artifact-check: a project that keeps result workbooks needs a committed one', () => {
  const fx = makeEnv()
  fs.mkdirSync(path.join(fx.repo, '.wb'))
  fs.writeFileSync(path.join(fx.repo, '.wb', 'verify.config.json'), '{}')
  const rows = [use('Skill', { skill: 'wb:report' }), use('Artifact', {})]
  const r = artifactCheck({ session_id: 'x', cwd: fx.repo, transcript_path: transcript(fx, rows) }, fx.env)
  assert.equal(r.decision, 'block')
  assert.match(r.reason, /wb-check test-results/)
  assert.doesNotMatch(r.reason, /not published/)
  const p = runScript('hooks/scripts/report/artifact-check.mjs', { session_id: 'y', cwd: fx.repo, transcript_path: transcript(fx, rows) }, { ...fx.env, LANG: 'ko_KR.UTF-8' })
  assert.equal(p.out.decision, 'block')
  assert.match(p.out.reason, /최신 검증 결과 엑셀/)
})
