// Quality results per kind (unit · integration · gate · e2e · uistab · usability · ux-adversarial · ship):
// common head JSON (quality-result/1), the index (quality-index/1), the ship precheck with
// weakening detection, and the version roll-up. Commands come from project.quality.suites,
// so nothing here knows a particular repository. The workbooks are written by
// templates/quality/write_xlsx.py from the sheet specs built here.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { PLUGIN_ROOT, getPath } from './config.mjs'

export const RESULT_SCHEMA = 'quality-result/1'
export const INDEX_SCHEMA = 'quality-index/1'
export const CATEGORIES = ['unit', 'integration', 'gate', 'e2e', 'uistab', 'usability', 'ux-adversarial', 'ship']
export const PARSERS = ['vitest', 'jest', 'playwright', 'pytest', 'vitest-log', 'json', 'exit', 'steps']
export const COUNT_KEYS = ['total', 'passed', 'failed', 'skipped', 'fixme', 'flaky']
export const STATES = ['ok', 'missing', 'stale', 'failed', 'weakened', 'manual']
export const XLSX_WRITER = path.join(PLUGIN_ROOT, 'templates', 'quality', 'write_xlsx.py')
const REQUIRED_HEAD = ['schema', 'kind', 'category', 'version', 'commit', 'branch', 'dirty', 'startedAt', 'endedAt', 'env', 'verdict', 'counts', 'files']
const INDEX_EXTRA = ['legacy', 'originalPath', 'versionBasis', 'external', 'inferred', 'run']
const MAX_FAILURES = 200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ---- settings -------------------------------------------------------------

export function qualitySettings(config) {
  const q = getPath(config, 'project.quality') || {}
  const ship = q.ship || {}
  const suites = {}
  for (const [id, s] of Object.entries(q.suites || {})) {
    suites[id] = {
      id,
      category: s.category || (CATEGORIES.includes(id) ? id : 'unit'),
      command: s.command || '',
      steps: Array.isArray(s.steps) ? s.steps : [],
      parser: s.parser || (Array.isArray(s.steps) && s.steps.length ? 'steps' : 'exit'),
      result: s.result || '',
      slot: s.slot || 'heavy',
      thresholds: (s.thresholds || []).map((t) => (typeof t === 'string' ? { file: t, rule: 'hash' } : { file: t.file, rule: t.rule || 'hash' })),
      stale_paths: s.stale_paths || [],
      timeout_min: s.timeout_min || 0,
      env: s.env || {},
      note: s.note || '',
    }
  }
  // project.docs_sync with targets registers the kind `docs` (category gate) unless a suite of that name exists.
  const ds = getPath(config, 'project.docs_sync') || {}
  if (Array.isArray(ds.targets) && ds.targets.length && !suites.docs) {
    const lanekeeperDocs = path.join(PLUGIN_ROOT, 'bin', 'lanekeeper-docs')
    suites.docs = {
      id: 'docs', category: 'gate', parser: 'json', result: '', slot: 'none', thresholds: [], stale_paths: [], timeout_min: 10, env: {},
      command: `"${process.execPath}" "${lanekeeperDocs}" check --base ${ds.quality_base || 'release'} --json {file}`,
      steps: [], note: 'docs sync gate (project.docs_sync)', builtin: true,
    }
  }
  return {
    resultsRoot: q.results_root || 'docs/test-results',
    rawRoot: q.raw_root || 'test-results/runs',
    versionFile: q.version_file || 'VERSION',
    suites,
    ship: {
      requires: ship.requires || [],
      // Checked like requires, but a kind that is not ok only warns (unless it is also in requires).
      advisory: (ship.advisory || []).filter((k) => !(ship.requires || []).includes(k)),
      enforce: ship.enforce || 'deny',
      agents: ship.agents || [],
      skills: ship.skills || [],
    },
  }
}

export const suitesOf = (settings, category) => Object.values(settings.suites).filter((s) => s.category === category)

// ---- small helpers ----------------------------------------------------------

const p2 = (n) => String(n).padStart(2, '0')
export const localDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
export const localHHMM = (d) => `${p2(d.getHours())}${p2(d.getMinutes())}`
export const localStamp = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${localHHMM(d)}`

/** ISO 8601 with the local offset: 2026-10-18T22:30:00.000+09:00 */
export function isoLocal(d = new Date()) {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const a = Math.abs(off)
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${localDate(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${ms}${sign}${p2(Math.floor(a / 60))}:${p2(a % 60)}`
}

const posix = (p) => p.split(path.sep).join('/')

export function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim()
  } catch {
    return null
  }
}

export function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

/** Version string from the version file (first line), else package.json version, else "unversioned". */
export function readVersion(root, settings) {
  try {
    const v = fs.readFileSync(path.join(root, settings.versionFile), 'utf8').split('\n')[0].trim()
    if (v) return v
  } catch {}
  const pkg = readJsonFile(path.join(root, 'package.json'))
  return pkg?.version ? String(pkg.version) : 'unversioned'
}

/** Compare versions numerically part by part ("1.10.0" > "1.9.2"); "-" and words sort first. */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/)
  const pb = String(b).split(/[.-]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? ''
    const y = pb[i] ?? ''
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny && Number(x) !== Number(y)) return Number(x) - Number(y)
    if (nx !== ny) return nx ? 1 : -1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export function emptyCounts() {
  return { total: 0, passed: 0, failed: 0, skipped: 0, fixme: 0, flaky: 0 }
}

function addCounts(a, b) {
  for (const k of COUNT_KEYS) a[k] = (a[k] ?? 0) + (b[k] ?? 0)
  return a
}

const firstLine = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 300) || ''

/** Glob with `*` and `**` (posix paths). */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Files matching a path whose last segment may hold `*`. */
export function expandResultFiles(pattern) {
  if (!pattern.includes('*')) return fs.existsSync(pattern) ? [pattern] : []
  const dir = path.dirname(pattern)
  const re = globToRegExp(path.basename(pattern))
  try {
    return fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

// ---- parsers ------------------------------------------------------------------
// Each returns { counts, suites[], failures[] } or throws when the input cannot be read.

function parseVitestLike(json, suiteName) {
  const counts = emptyCounts()
  const failures = []
  for (const file of json.testResults || []) {
    for (const t of file.assertionResults || []) {
      counts.total++
      const st = t.status
      if (st === 'passed') counts.passed++
      else if (st === 'failed') {
        counts.failed++
        if (failures.length < MAX_FAILURES) failures.push({ suite: suiteName, name: t.fullName || t.title || '', message: firstLine((t.failureMessages || [])[0]) })
      } else if (st === 'todo') counts.fixme++
      else counts.skipped++
    }
  }
  if (!counts.total && Number.isInteger(json.numTotalTests)) {
    counts.total = json.numTotalTests
    counts.passed = json.numPassedTests || 0
    counts.failed = json.numFailedTests || 0
    counts.fixme = json.numTodoTests || 0
    counts.skipped = json.numPendingTests || 0
  }
  return { counts, suites: [{ name: suiteName, ...counts }], failures }
}

function parsePlaywright(json, suiteName) {
  const counts = emptyCounts()
  const failures = []
  const byProject = new Map()
  const walk = (suite, titles) => {
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const proj = t.projectName || suiteName
        const pc = byProject.get(proj) || emptyCounts()
        byProject.set(proj, pc)
        const bump = (k) => {
          counts[k]++
          pc[k]++
        }
        bump('total')
        const fixme = (t.annotations || []).some((a) => a.type === 'fixme')
        if (t.status === 'skipped') bump(fixme ? 'fixme' : 'skipped')
        else if (t.status === 'unexpected') {
          bump('failed')
          const res = (t.results || []).find((r) => r.error || (r.errors || []).length)
          if (failures.length < MAX_FAILURES) failures.push({ suite: proj, name: [...titles, spec.title].filter(Boolean).join(' › '), message: firstLine(res?.error?.message || res?.errors?.[0]?.message) })
        } else if (t.status === 'flaky') {
          bump('passed')
          bump('flaky')
        } else bump('passed')
      }
    }
    for (const s of suite.suites || []) walk(s, [...titles, s.title])
  }
  for (const s of json.suites || []) walk(s, [s.title])
  return { counts, suites: [...byProject].map(([name, c]) => ({ name, ...c })), failures }
}

function parseJunit(xml, suiteName) {
  const counts = emptyCounts()
  const failures = []
  const attr = (tag, name) => {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
    return m ? m[1] : ''
  }
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    counts.total++
    const body = m[3] || ''
    if (/<(failure|error)\b/.test(body)) {
      counts.failed++
      const f = /<(?:failure|error)\b([^>]*)>?/.exec(body)
      if (failures.length < MAX_FAILURES) failures.push({ suite: attr(m[1], 'classname') || suiteName, name: attr(m[1], 'name'), message: firstLine(attr(f[1], 'message')) })
    } else if (/<skipped\b/.test(body)) {
      const s = /<skipped\b([^>]*)/.exec(body)
      if (/fixme|xfail/i.test(attr(s[1], 'type') + attr(s[1], 'message'))) counts.fixme++
      else counts.skipped++
    } else counts.passed++
  }
  return { counts, suites: [{ name: suiteName, ...counts }], failures }
}

/** Sum of vitest "Tests  12 passed | 1 skipped | 2 todo (15)" lines in a log (one per package). */
export function parseVitestLog(text, suiteName) {
  const counts = emptyCounts()
  const suites = []
  let seen = false
  const clean = String(text).replace(/\x1b\[[0-9;]*m/g, '')
  for (const line of clean.split('\n')) {
    const m = /^(?:(\S+)\s+test:)?\s*Tests\s+(.+?)\s*\((\d+)\)\s*$/.exec(line)
    if (!m) continue
    seen = true
    const c = emptyCounts()
    c.total = Number(m[3])
    for (const part of m[2].split('|')) {
      const pm = /(\d+)\s+(passed|failed|skipped|todo|flaky)/.exec(part)
      if (!pm) continue
      const k = pm[2] === 'todo' ? 'fixme' : pm[2]
      c[k] += Number(pm[1])
    }
    suites.push({ name: m[1] || `${suiteName}#${suites.length + 1}`, ...c })
    addCounts(counts, c)
  }
  if (!seen) throw new Error('no vitest "Tests" summary line in the log')
  const failures = []
  for (const m of clean.matchAll(/^\s*(?:FAIL|×|✗)\s+(.+)$/gm)) if (failures.length < MAX_FAILURES) failures.push({ suite: suiteName, name: m[1].trim().slice(0, 300), message: '' })
  return { counts, suites, failures }
}

function parseCustomJson(json, suiteName) {
  const counts = emptyCounts()
  for (const k of COUNT_KEYS) if (Number.isInteger(json.counts?.[k])) counts[k] = json.counts[k]
  if (!json.counts || !Number.isInteger(json.counts.total)) throw new Error('json result has no counts.total')
  return {
    counts,
    suites: Array.isArray(json.suites) ? json.suites : [{ name: suiteName, ...counts }],
    failures: (json.failures || []).slice(0, MAX_FAILURES),
    detail: json.detail,
    notes: json.notes,
  }
}

/** Parse the raw result of one suite run. */
export function parseResult(parser, { files = [], log = '', exitCode = 0, suiteName = 'suite', steps = [] }) {
  if (parser === 'exit') {
    const counts = { ...emptyCounts(), total: 1, passed: exitCode === 0 ? 1 : 0, failed: exitCode === 0 ? 0 : 1 }
    return { counts, suites: [{ name: suiteName, ...counts }], failures: exitCode === 0 ? [] : [{ suite: suiteName, name: suiteName, message: `exit ${exitCode}` }] }
  }
  if (parser === 'steps') {
    const counts = emptyCounts()
    const suites = []
    const failures = []
    for (const s of steps) {
      counts.total++
      const ok = s.exitCode === 0
      counts[ok ? 'passed' : 'failed']++
      suites.push({ name: s.name, total: 1, passed: ok ? 1 : 0, failed: ok ? 0 : 1, skipped: 0, fixme: 0, flaky: 0, exitCode: s.exitCode, durationSec: s.durationSec })
      if (!ok) failures.push({ suite: suiteName, name: s.name, message: `exit ${s.exitCode}${s.tail ? ` · ${firstLine(s.tail)}` : ''}` })
    }
    return { counts, suites, failures }
  }
  if (parser === 'vitest-log') return parseVitestLog(log, suiteName)
  if (!files.length) throw new Error('result file not found')
  const out = { counts: emptyCounts(), suites: [], failures: [] }
  for (const f of files) {
    const name = files.length > 1 ? path.basename(f).replace(/\.(json|xml)$/, '') : suiteName
    const body = fs.readFileSync(f, 'utf8')
    let r
    if (parser === 'pytest') r = parseJunit(body, name)
    else {
      const json = JSON.parse(body)
      if (parser === 'vitest' || parser === 'jest') r = parseVitestLike(json, name)
      else if (parser === 'playwright') r = parsePlaywright(json, name)
      else if (parser === 'json') r = parseCustomJson(json, name)
      else throw new Error(`unknown parser ${parser}`)
    }
    addCounts(out.counts, r.counts)
    out.suites.push(...r.suites)
    out.failures.push(...r.failures)
    if (r.detail) out.detail = r.detail
    if (r.notes) out.notes = r.notes
  }
  out.failures = out.failures.slice(0, MAX_FAILURES)
  return out
}

/** passed when the command (or every step) exited 0, nothing failed and something ran. */
export function verdictOf({ exitCode, counts, parseError }) {
  if (parseError) return 'error'
  if (exitCode !== 0 || counts.failed > 0) return 'failed'
  if (!counts.total) return 'error'
  return 'passed'
}

// ---- head ---------------------------------------------------------------------

export function envInfo() {
  return { os: `${process.platform} ${os.release()}`, node: process.version, cpus: os.cpus().length }
}

export function gitInfo(root) {
  const commit = git(root, ['rev-parse', 'HEAD']) || ''
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || ''
  return { commit, branch }
}

/** Uncommitted tracked changes outside `prefix` (the results folder)? */
export function treeDirty(root, prefix = '') {
  const st = git(root, ['status', '--porcelain', '--untracked-files=no'])
  if (st === null) return false
  return st.split('\n').filter(Boolean).some((l) => !(prefix && l.slice(3).startsWith(prefix)))
}

export function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return null
  }
}

export function makeHead(fields) {
  const head = {
    schema: RESULT_SCHEMA,
    kind: fields.kind,
    category: fields.category,
    version: fields.version,
    commit: fields.commit,
    branch: fields.branch,
    dirty: Boolean(fields.dirty),
    startedAt: fields.startedAt,
    endedAt: fields.endedAt,
    durationSec: fields.durationSec ?? null,
    env: fields.env,
    command: fields.command ?? null,
    exitCode: fields.exitCode ?? null,
    verdict: fields.verdict,
    counts: { ...emptyCounts(), ...fields.counts },
    thresholds: fields.thresholds || [],
    suites: fields.suites || [],
    failures: (fields.failures || []).slice(0, MAX_FAILURES),
    raw: fields.raw || null,
    files: fields.files,
    notes: fields.notes || [],
    detail: fields.detail || {},
  }
  return head
}

/** Missing or malformed common head keys. */
export function validateHead(h) {
  const errs = []
  if (!h || typeof h !== 'object') return ['not an object']
  for (const k of REQUIRED_HEAD) if (!(k in h)) errs.push(`missing ${k}`)
  if (h.schema && h.schema !== RESULT_SCHEMA) errs.push(`schema ${h.schema}`)
  if (h.category && !CATEGORIES.includes(h.category)) errs.push(`category ${h.category}`)
  if (h.verdict && !['passed', 'failed', 'error', 'skipped'].includes(h.verdict)) errs.push(`verdict ${h.verdict}`)
  for (const k of COUNT_KEYS) if (h.counts && !(Number.isInteger(h.counts[k]) || h.counts[k] === null)) errs.push(`counts.${k}`)
  return errs
}

/** <results>/<version>/<date>/<kind>-<HHMM>[-n] without extension, never an existing one. */
export function resultBase(root, settings, version, kind, d) {
  const dir = path.join(root, settings.resultsRoot, version, localDate(d))
  let base = path.join(dir, `${kind}-${localHHMM(d)}`)
  for (let n = 2; fs.existsSync(`${base}.json`) || fs.existsSync(`${base}.xlsx`); n++) base = path.join(dir, `${kind}-${localHHMM(d)}-${n}`)
  return base
}

export function thresholdsOf(root, suite) {
  return suite.thresholds.map((t) => ({ file: t.file, rule: t.rule, sha256: sha256File(path.join(root, t.file)) }))
}

// ---- workbook specs -------------------------------------------------------------

const countRow = (c) => COUNT_KEYS.map((k) => c?.[k] ?? '')

/** Sheet spec of one result: summary (head), suites, failures. */
export function resultSheets(h, t) {
  const kv = [
    [t('q.col.kind'), h.kind], [t('q.col.category'), h.category], [t('q.col.version'), h.version],
    [t('q.col.commit'), h.commit], [t('q.col.branch'), h.branch], [t('q.col.dirty'), h.dirty ? 'yes' : 'no'],
    [t('q.col.started'), h.startedAt], [t('q.col.ended'), h.endedAt], [t('q.col.duration'), h.durationSec ?? ''],
    [t('q.col.verdict'), t(`q.verdict.${h.verdict}`)], [t('q.col.command'), h.command || ''], [t('q.col.exit'), h.exitCode ?? ''],
    ...COUNT_KEYS.map((k) => [t(`q.count.${k}`), h.counts[k] ?? '']),
    [t('q.col.env'), `${h.env?.os || ''} · node ${h.env?.node || ''} · cpu ${h.env?.cpus ?? ''} · load ${h.env?.loadStart ?? ''}→${h.env?.loadEnd ?? ''}`],
    [t('q.col.raw'), h.raw?.dir || ''],
    ...(h.thresholds || []).map((x) => [t('q.col.threshold'), `${x.file} (${x.rule || 'hash'}) ${x.sha256 ? x.sha256.slice(0, 12) : '-'}`]),
    ...(h.notes || []).map((n) => [t('q.col.note'), n]),
  ]
  return [
    { name: t('q.sheet.summary'), columns: [t('q.col.item'), t('q.col.value')], rows: kv },
    { name: t('q.sheet.suites'), columns: [t('q.col.suite'), ...COUNT_KEYS.map((k) => t(`q.count.${k}`))], rows: (h.suites || []).map((s) => [s.name, ...countRow(s)]) },
    { name: t('q.sheet.failures'), columns: [t('q.col.suite'), t('q.col.name'), t('q.col.message')], rows: (h.failures || []).map((f) => [f.suite || '', f.name || '', f.message || '']) },
  ]
}

/** python3 + openpyxl writes the sheets. Returns { ok, error }. */
export function writeXlsx(file, sheets, { python = process.env.LANEKEEPER_PYTHON || 'python3', spawn } = {}) {
  const spec = `${file}.spec.json`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(spec, JSON.stringify({ sheets }))
  try {
    const run = spawn || ((cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }))
    run(python, [XLSX_WRITER, spec, file])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: firstLine(e.stderr || e.message) }
  } finally {
    fs.rmSync(spec, { force: true })
  }
}

/** Write <base>.json (and <base>.xlsx when possible). Returns the head with files filled. */
export function saveResult(root, base, head, t, opts = {}) {
  const rel = (f) => posix(path.relative(root, f))
  head.files = { json: rel(`${base}.json`), xlsx: rel(`${base}.xlsx`) }
  const x = opts.noXlsx ? { ok: false, error: 'skipped' } : writeXlsx(`${base}.xlsx`, resultSheets(head, t), opts)
  if (!x.ok) {
    head.files.xlsx = null
    if (x.error !== 'skipped') head.notes = [...(head.notes || []), `xlsx: ${x.error}`]
  }
  writeJson(`${base}.json`, head)
  return head
}

// ---- index ------------------------------------------------------------------------

function sumSuites(suites) {
  const c = emptyCounts()
  c.fixme = null
  for (const s of suites || []) {
    for (const k of ['total', 'passed', 'failed', 'skipped', 'flaky']) c[k] += s[k] || 0
  }
  return c
}

// The workbook named by files.xlsx (repo-relative), looked up next to the json; a bundle
// workbook shared by several results sits in the same folder.
function xlsxOf(resultsDir, file, named) {
  if (!named) return null
  const f = path.join(path.dirname(file), path.basename(named))
  return fs.existsSync(f) ? posix(path.relative(resultsDir, f)) : null
}

/** Index entry from a result JSON file (common head, or an older summary inferred from its content). */
export function entryFromFile(resultsDir, file, { version, date, legacy }) {
  const j = readJsonFile(file)
  const relJson = posix(path.relative(resultsDir, file))
  const xlsxFile = file.replace(/\.json$/, '.xlsx')
  const relXlsx = fs.existsSync(xlsxFile) ? posix(path.relative(resultsDir, xlsxFile)) : null
  const base = path.basename(file, '.json')
  const kindGuess = base.replace(/-\d{4}(-\d+)?$/, '')
  if (j && j.schema === RESULT_SCHEMA) {
    return {
      version: j.version ?? version, date, kind: j.kind, category: j.category, commit: j.commit, branch: j.branch,
      verdict: j.verdict, counts: j.counts, startedAt: j.startedAt, endedAt: j.endedAt, dirty: Boolean(j.dirty),
      json: relJson, xlsx: xlsxOf(resultsDir, file, j.files?.xlsx) || relXlsx,
      legacy: Boolean(legacy), ...(j.run ? { run: j.run } : {}),
    }
  }
  if (!j || typeof j !== 'object') return null
  // An older summary (for example a lanekeeper-test-report workbook summary): infer what we can.
  const meta = j.meta || {}
  const cat = CATEGORIES.includes(kindGuess) ? kindGuess : null
  return {
    version: meta.version || version, date, kind: kindGuess, category: cat, commit: meta.commit || j.commit || null, branch: meta.branch || null,
    verdict: j.verdict || null, counts: j.counts || sumSuites(j.suites), startedAt: meta.started || meta.startedAt || null, endedAt: meta.ended || meta.endedAt || null,
    dirty: false, json: relJson, xlsx: relXlsx, legacy: Boolean(legacy), inferred: true,
  }
}

const listDir = (d) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Scan the results folder and build the index. Optional keys of an existing index survive. */
export function buildIndex(root, settings, { now = new Date(), previous } = {}) {
  const dir = path.join(root, settings.resultsRoot)
  const prev = previous ?? readJsonFile(path.join(dir, 'index.json'))
  const keep = new Map()
  for (const e of prev?.entries || []) keep.set(e.json || e.xlsx, e)
  const entries = []
  const addFolder = (folder, version, date, legacy) => {
    const files = listDir(folder).filter((e) => e.isFile()).map((e) => e.name).filter((f) => !f.startsWith('~$'))
    const jsonNames = new Set(files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)))
    for (const f of files.sort()) {
      let e = null
      if (f.endsWith('.json')) e = entryFromFile(dir, path.join(folder, f), { version, date, legacy })
      else if (f.endsWith('.xlsx') && !jsonNames.has(f.slice(0, -5))) {
        e = { version, date, kind: f.slice(0, -5).replace(/-\d{4}(-\d+)?$/, ''), category: null, commit: null, branch: null, verdict: null, counts: null, startedAt: null, endedAt: null, dirty: false, json: null, xlsx: posix(path.relative(dir, path.join(folder, f))), legacy: Boolean(legacy), inferred: true }
      }
      if (!e) continue
      const old = keep.get(e.json || e.xlsx)
      if (old) for (const k of INDEX_EXTRA) if (old[k] !== undefined) e[k] = old[k]
      if (old?.version && e.legacy && old.versionBasis) e.version = old.version
      entries.push(e)
    }
  }
  for (const top of listDir(dir)) {
    if (!top.isDirectory()) continue
    if (DATE_RE.test(top.name)) {
      addFolder(path.join(dir, top.name), '-', top.name, true)
      continue
    }
    for (const sub of listDir(path.join(dir, top.name))) {
      if (sub.isDirectory() && DATE_RE.test(sub.name)) addFolder(path.join(dir, top.name, sub.name), top.name, sub.name, false)
    }
  }
  entries.sort((a, b) => compareVersions(a.version, b.version) || a.date.localeCompare(b.date) || String(a.startedAt || a.json || a.xlsx || '').localeCompare(String(b.startedAt || b.json || b.xlsx || '')))
  const accepted = readJsonFile(path.join(dir, 'accepted.json'))?.accepted || []
  return { schema: INDEX_SCHEMA, updatedAt: isoLocal(now), entries, accepted }
}

export function renderIndexMd(index, t) {
  const out = [`# ${t('q.index.title')}`, '', t('q.index.intro'), '']
  const versions = [...new Set(index.entries.map((e) => e.version))].sort(compareVersions).reverse()
  for (const v of versions) {
    out.push(`## ${v === '-' ? t('q.index.legacy') : v}`, '')
    out.push(`| ${t('q.col.date')} | ${t('q.col.kind')} | ${t('q.col.verdict')} | ${t('q.col.commit')} | ${t('q.count.total')} | ${t('q.count.passed')} | ${t('q.count.failed')} | ${t('q.count.skipped')} | ${t('q.count.fixme')} | ${t('q.col.file')} |`)
    out.push('|---|---|---|---|---|---|---|---|---|---|')
    const rows = index.entries.filter((e) => e.version === v).sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind))
    for (const e of rows) {
      const c = e.counts || {}
      const link = e.xlsx || e.json
      const n = (x) => (x === null || x === undefined ? '-' : x)
      out.push(`| ${e.date} | ${e.kind}${e.inferred ? ` ${t('q.index.inferred')}` : ''} | ${e.verdict ? t(`q.verdict.${e.verdict}`) : '-'} | ${e.commit ? e.commit.slice(0, 9) : '-'} | ${n(c.total)} | ${n(c.passed)} | ${n(c.failed)} | ${n(c.skipped)} | ${n(c.fixme)} | [${path.basename(link)}](${link}) |`)
    }
    out.push('')
  }
  if (index.accepted.length) {
    out.push(`## ${t('q.index.accepted')}`, '')
    for (const a of index.accepted) out.push(`- ${a.kind} · ${String(a.commit).slice(0, 9)} · ${a.at} · ${a.reason}${a.via ? ` · ${a.via}` : ''}`)
    out.push('')
  }
  return `${out.join('\n').trimEnd()}\n`
}

export function writeIndex(root, settings, t, opts = {}) {
  const index = buildIndex(root, settings, opts)
  const dir = path.join(root, settings.resultsRoot)
  writeJson(path.join(dir, 'index.json'), index)
  fs.writeFileSync(path.join(dir, 'INDEX.md'), renderIndexMd(index, t))
  return index
}

// ---- precheck ------------------------------------------------------------------------

const stamp = (e) => String(e.endedAt || e.startedAt || `${e.date}T00:00`)
const sameCommit = (a, b) => Boolean(a && b) && (a.startsWith(b) || b.startsWith(a))

/** Newest result of a kind with a commit (optionally limited to a version). */
export function latestOf(entries, kind, { version } = {}) {
  const list = entries.filter((e) => e.kind === kind && e.commit && (!version || e.version === version))
  list.sort((a, b) => stamp(a).localeCompare(stamp(b)))
  return list.at(-1) || null
}

/**
 * Baseline for `entry`: the newest passed result of the kind before it, on a different commit, that is
 * itself not an unaccepted weakening of the baseline before it. Walking the chain keeps a weaker result
 * from becoming the next baseline just by running again on a new commit.
 * `weaker(cur, base)` returns the weakening reasons; `isAccepted(e)` tells an owner-accepted result.
 */
export function baselineOf(entries, entry, { weaker = () => [], isAccepted = () => false } = {}) {
  const list = entries.filter((e) => e.kind === entry.kind && e.verdict === 'passed' && e.commit && e !== entry && e.json !== entry.json && stamp(e) < stamp(entry))
  list.sort((a, b) => stamp(a).localeCompare(stamp(b)))
  const valid = []
  for (const e of list) {
    const base = [...valid].reverse().find((v) => !sameCommit(v.commit, e.commit))
    if (!base || isAccepted(e) || !weaker(e, base).length) valid.push(e)
  }
  return [...valid].reverse().find((v) => !sameCommit(v.commit, entry.commit)) || null
}

function numericLeaves(v, p = '', out = new Map()) {
  if (typeof v === 'number') out.set(p, v)
  else if (Array.isArray(v)) {
    out.set(`${p}#length`, v.length)
    v.forEach((x, i) => numericLeaves(x, `${p}[${i}]`, out))
  } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) numericLeaves(x, p ? `${p}.${k}` : k, out)
  return out
}

/** Loosened leaves between two JSON texts under rule max (bigger = looser) or min (smaller = looser). Array growth is always looser. */
export function loosenedLeaves(oldText, newText, rule) {
  let a
  let b
  try {
    a = numericLeaves(JSON.parse(oldText))
    b = numericLeaves(JSON.parse(newText))
  } catch {
    return null
  }
  const out = []
  for (const [k, nv] of b) {
    if (!a.has(k)) continue
    const ov = a.get(k)
    const grew = nv > ov
    if (k.endsWith('#length') ? grew : rule === 'max' ? grew : nv < ov) out.push(`${k.replace(/#length$/, '.length')} ${ov}→${nv}`)
  }
  return out
}

/** Reasons the current result is weaker than the baseline (empty when it is not). */
export function weakening(cur, base, { root, show } = {}) {
  const reasons = []
  if (!base) return reasons
  const c = cur.counts || {}
  const b = base.counts || {}
  if (Number.isInteger(c.total) && Number.isInteger(b.total) && c.total < b.total) reasons.push({ code: 'total_down', vars: { from: b.total, to: c.total } })
  const hold = (x) => (Number.isInteger(x.skipped) ? x.skipped : 0) + (Number.isInteger(x.fixme) ? x.fixme : 0)
  if (hold(c) > hold(b)) reasons.push({ code: 'skip_up', vars: { from: hold(b), to: hold(c) } })
  const ct = cur.thresholds || []
  const bt = new Map((base.thresholds || []).map((x) => [x.file, x]))
  for (const x of ct) {
    const old = bt.get(x.file)
    if (!old || old.sha256 === x.sha256) continue
    if (x.rule === 'max' || x.rule === 'min') {
      const read = show || ((commit, file) => git(root, ['show', `${commit}:${file}`]))
      const ot = read(base.commit, x.file)
      const nt = read(cur.commit, x.file)
      const loose = ot !== null && nt !== null ? loosenedLeaves(ot, nt, x.rule) : null
      if (loose === null) reasons.push({ code: 'threshold_changed', vars: { file: x.file } })
      else if (loose.length) reasons.push({ code: 'threshold_loosened', vars: { file: x.file, leaves: loose.slice(0, 5).join(', ') } })
    } else reasons.push({ code: 'threshold_changed', vars: { file: x.file } })
  }
  return reasons
}

/** Paths changed between two commits, or null when `from` is not an ancestor. */
export function changedFiles(root, from, to = 'HEAD') {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', from, to], { cwd: root, stdio: 'ignore' })
  } catch {
    return null
  }
  const out = git(root, ['diff', '--name-only', from, to])
  return out === null ? null : out.split('\n').filter(Boolean)
}

/** Is a result on `commit` still valid at HEAD? Only result-folder changes, or no change inside stale_paths. */
export function staleCheck(root, settings, suite, commit, head) {
  if (sameCommit(commit, head)) return { stale: false }
  const files = changedFiles(root, commit, head)
  if (files === null) return { stale: true, why: 'not_ancestor' }
  const prefix = `${settings.resultsRoot.replace(/\/+$/, '')}/`
  const relevant = suite?.stale_paths?.length
    ? files.filter((f) => suite.stale_paths.some((g) => globToRegExp(g).test(f)))
    : files.filter((f) => !f.startsWith(prefix))
  return relevant.length ? { stale: true, why: 'changed', files: relevant } : { stale: false }
}

function loadHead(root, settings, entry) {
  if (!entry?.json) return null
  return readJsonFile(path.join(root, settings.resultsRoot, entry.json))
}


/** Weakening reasons of `entry` against its baseline (empty when none or accepted). */
export function weakenedReasons(root, settings, idx, entry, cache = new Map()) {
  const accepted = idx.accepted || []
  const withThr = (e) => {
    if (!cache.has(e.json)) cache.set(e.json, loadHead(root, settings, e)?.thresholds || [])
    return { ...e, thresholds: cache.get(e.json) }
  }
  const isAccepted = (e) => accepted.some((a) => a.kind === entry.kind && sameCommit(String(a.commit), e.commit))
  const weaker = (cur, base) => weakening(withThr(cur), withThr(base), { root })
  const base = baselineOf(idx.entries, entry, { weaker, isAccepted })
  if (!base || isAccepted(entry)) return []
  return weaker(entry, base).map((r) => ({ ...r, vars: { ...r.vars, base: base.commit.slice(0, 9) } }))
}

/**
 * Ship precheck: one row per required kind, plus one advisory row per kind in ship.advisory.
 * row = { kind, state, entry, reasons[], runnable, advisory? }
 * state: ok | missing | stale | failed | weakened | manual (no command: the skill runs it)
 * `ok` looks at the required rows only; advisory rows that are not ok are warnings.
 */
export function precheck(root, settings, { index, head } = {}) {
  const idx = index || buildIndex(root, settings)
  const h = head || git(root, ['rev-parse', 'HEAD'])
  const rows = []
  const advisory = []
  const thr = new Map()
  for (const kind of [...settings.ship.requires, ...(settings.ship.advisory || [])]) {
    const suite = settings.suites[kind]
    const runnable = Boolean(suite && (suite.command || suite.steps.length))
    const entry = latestOf(idx.entries, kind)
    const row = { kind, state: 'ok', entry, reasons: [], runnable }
    if (settings.ship.requires.includes(kind)) rows.push(row)
    else advisory.push(Object.assign(row, { advisory: true }))
    if (!entry) {
      row.state = runnable ? 'missing' : 'manual'
      row.reasons.push({ code: 'missing', vars: {} })
      continue
    }
    if (entry.verdict !== 'passed') {
      row.state = 'failed'
      row.reasons.push({ code: 'failed', vars: { verdict: entry.verdict || '-', failed: entry.counts?.failed ?? '-' } })
      continue
    }
    if (entry.dirty) {
      row.state = 'stale'
      row.reasons.push({ code: 'dirty', vars: {} })
      continue
    }
    const st = staleCheck(root, settings, suite, entry.commit, h)
    if (st.stale) {
      row.state = 'stale'
      row.reasons.push({ code: st.why === 'not_ancestor' ? 'not_ancestor' : 'stale', vars: { commit: entry.commit.slice(0, 9), files: (st.files || []).slice(0, 3).join(', '), more: Math.max(0, (st.files || []).length - 3) } })
      continue
    }
    const reasons = weakenedReasons(root, settings, idx, entry, thr)
    if (reasons.length) {
      row.state = 'weakened'
      row.reasons.push(...reasons)
    }
  }
  return { ok: rows.every((r) => r.state === 'ok'), rows, advisory, head: h }
}

export const needsRun = (row) => row.runnable && ['missing', 'stale', 'failed'].includes(row.state)

/** Owner acceptance of a weakened result on `commit` (kept in <results>/accepted.json). */
export function recordAcceptance(root, settings, { kind, commit, reason, via, now = new Date() }) {
  if (!reason || !String(reason).trim()) throw new Error('reason required')
  const file = path.join(root, settings.resultsRoot, 'accepted.json')
  const cur = readJsonFile(file) || { accepted: [] }
  cur.accepted.push({ kind, commit, reason: String(reason).trim(), at: isoLocal(now), ...(via ? { via } : {}) })
  writeJson(file, cur)
  return file
}

// ---- version roll-up -------------------------------------------------------------------

/** Latest result per kind for a version, plus the run history of that version. */
export function rollup(root, settings, version, { index } = {}) {
  const idx = index || buildIndex(root, settings)
  const inVersion = idx.entries.filter((e) => e.version === version && !e.legacy)
  const kinds = [...new Set([...settings.ship.requires, ...(settings.ship.advisory || []), ...Object.keys(settings.suites), ...inVersion.map((e) => e.kind)])]
  const latest = []
  for (const k of kinds) {
    const e = latestOf(inVersion, k)
    const weakened = e && e.verdict === 'passed' ? weakenedReasons(root, settings, idx, e) : []
    latest.push({ kind: k, category: e?.category || settings.suites[k]?.category || (CATEGORIES.includes(k) ? k : null), entry: e, head: e ? loadHead(root, settings, e) : null, weakened })
  }
  const missing = settings.ship.requires.filter((k) => !latest.find((l) => l.kind === k)?.entry)
  return { version, latest, history: inVersion, missing, allPassed: latest.every((l) => !l.entry || (l.entry.verdict === 'passed' && !l.weakened.length)) && missing.length === 0 }
}

export function rollupSheets(r, t) {
  const sheets = [{
    name: t('q.sheet.summary'),
    columns: [t('q.col.kind'), t('q.col.category'), t('q.col.date'), t('q.col.commit'), t('q.col.verdict'), ...COUNT_KEYS.map((k) => t(`q.count.${k}`)), t('q.col.file')],
    rows: r.latest.map((l) => [l.kind, l.category || '', l.entry?.date || '', l.entry?.commit?.slice(0, 9) || '', l.entry ? t(`q.verdict.${l.entry.verdict}`) : t('q.report.none'), ...countRow(l.entry?.counts), l.entry?.json || '']),
  }]
  for (const l of r.latest) {
    if (!l.head) continue
    const [, suites, failures] = resultSheets(l.head, t)
    sheets.push({ name: l.kind.slice(0, 28), columns: suites.columns, rows: suites.rows })
    if (failures.rows.length) sheets.push({ name: `${l.kind.slice(0, 22)}-${t('q.sheet.fail_short')}`, columns: failures.columns, rows: failures.rows })
  }
  sheets.push({
    name: t('q.sheet.history'),
    columns: [t('q.col.date'), t('q.col.kind'), t('q.col.commit'), t('q.col.verdict'), ...COUNT_KEYS.map((k) => t(`q.count.${k}`)), t('q.col.file')],
    rows: r.history.map((e) => [e.date, e.kind, e.commit?.slice(0, 9) || '', e.verdict ? t(`q.verdict.${e.verdict}`) : '', ...countRow(e.counts), e.json || e.xlsx || '']),
  })
  return sheets
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Plain-language Markdown of the roll-up. */
export function rollupMarkdown(r, t) {
  const n = (x) => (x === null || x === undefined ? '-' : x)
  const out = [`# ${t('q.report.title', { version: r.version })}`, '']
  out.push(r.allPassed ? t('q.report.lead_ok', { n: r.latest.filter((l) => l.entry).length }) : t('q.report.lead_bad'), '')
  out.push(`## ${t('q.report.by_kind')}`, '')
  out.push(`| ${t('q.col.kind')} | ${t('q.col.date')} | ${t('q.col.commit')} | ${t('q.col.verdict')} | ${t('q.count.total')} | ${t('q.count.passed')} | ${t('q.count.failed')} | ${t('q.count.skipped')} | ${t('q.count.fixme')} |`)
  out.push('|---|---|---|---|---|---|---|---|---|')
  for (const l of r.latest) {
    const c = l.entry?.counts || {}
    out.push(`| ${l.kind} | ${l.entry?.date || '-'} | ${l.entry?.commit?.slice(0, 9) || '-'} | ${l.entry ? t(`q.verdict.${l.entry.verdict}`) : t('q.report.none')} | ${n(c.total)} | ${n(c.passed)} | ${n(c.failed)} | ${n(c.skipped)} | ${n(c.fixme)} |`)
  }
  out.push('')
  if (r.missing.length) out.push(`## ${t('q.report.missing')}`, '', ...r.missing.map((k) => `- ${k}`), '')
  const weak = r.latest.filter((l) => l.weakened?.length)
  if (weak.length) out.push(`## ${t('q.report.weakened')}`, '', ...weak.map((l) => `- ${l.kind}: ${l.weakened.map((x) => t(`q.why.${x.code}`, x.vars)).join(' · ')}`), '')
  const fails = r.latest.flatMap((l) => (l.head?.failures || []).map((f) => ({ kind: l.kind, ...f })))
  out.push(`## ${t('q.report.issues')}`, '')
  if (!fails.length) out.push(t('q.report.no_issues'), '')
  else out.push(...fails.slice(0, 50).map((f) => `- ${f.kind} · ${f.name}${f.message ? ` — ${f.message}` : ''}`), ...(fails.length > 50 ? [t('q.report.more', { n: fails.length - 50 })] : []), '')
  const held = r.latest.filter((l) => (l.entry?.counts?.skipped || 0) + (l.entry?.counts?.fixme || 0) > 0)
  out.push(`## ${t('q.report.excluded')}`, '')
  if (!held.length) out.push(t('q.report.no_excluded'), '')
  else out.push(...held.map((l) => `- ${t('q.report.excluded_line', { kind: l.kind, skipped: l.entry.counts.skipped ?? 0, fixme: l.entry.counts.fixme ?? 0 })}`), '')
  out.push(`## ${t('q.report.history')}`, '', t('q.report.history_line', { n: r.history.length, kinds: [...new Set(r.history.map((e) => e.kind))].length }), '')
  return `${out.join('\n').trimEnd()}\n`
}

/** Self-contained HTML of the same Markdown (tables, headings, lists), light and dark. */
export function markdownToHtml(md, title) {
  const lines = md.split('\n')
  const body = []
  let i = 0
  const inline = (s) => esc(s).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  while (i < lines.length) {
    const l = lines[i]
    if (l.startsWith('# ')) body.push(`<h1>${inline(l.slice(2))}</h1>`)
    else if (l.startsWith('## ')) body.push(`<h2>${inline(l.slice(3))}</h2>`)
    else if (l.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++])
      i--
      const cells = (r) => r.slice(1, -1).split('|').map((c) => c.trim())
      body.push('<table><thead><tr>', ...cells(rows[0]).map((c) => `<th>${inline(c)}</th>`), '</tr></thead><tbody>')
      for (const r of rows.slice(2)) body.push('<tr>', ...cells(r).map((c) => `<td>${inline(c)}</td>`), '</tr>')
      body.push('</tbody></table>')
    } else if (l.startsWith('- ')) {
      body.push('<ul>')
      while (i < lines.length && lines[i].startsWith('- ')) body.push(`<li>${inline(lines[i++].slice(2))}</li>`)
      i--
      body.push('</ul>')
    } else if (l.trim()) body.push(`<p>${inline(l)}</p>`)
    i++
  }
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#fff;--text:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--head:#f5f5f7}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#161618;--text:#f5f5f7;--muted:#a1a1a6;--line:#3a3a3c;--head:#232325}}
:root[data-theme="dark"]{--bg:#161618;--text:#f5f5f7;--muted:#a1a1a6;--line:#3a3a3c;--head:#232325}
body{background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;margin:0 auto;max-width:960px;padding:24px 16px}
h1{font-size:24px}h2{font-size:18px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;white-space:nowrap}th{background:var(--head)}
p,li{color:var(--text)}a{color:inherit}
</style></head><body>
${body.join('\n')}
</body></html>
`
}

/** Write quality-<version>.{md,html,xlsx} under <results>/<version>/. */
export function writeRollup(root, settings, version, t, opts = {}) {
  const r = rollup(root, settings, version, opts)
  const dir = path.join(root, settings.resultsRoot, version)
  fs.mkdirSync(dir, { recursive: true })
  const base = path.join(dir, `quality-${version}`)
  const md = rollupMarkdown(r, t)
  fs.writeFileSync(`${base}.md`, md)
  fs.writeFileSync(`${base}.html`, markdownToHtml(md, t('q.report.title', { version })))
  const x = opts.noXlsx ? { ok: false, error: 'skipped' } : writeXlsx(`${base}.xlsx`, rollupSheets(r, t), opts)
  const rel = (f) => posix(path.relative(root, f))
  return { ...r, files: { md: rel(`${base}.md`), html: rel(`${base}.html`), xlsx: x.ok ? rel(`${base}.xlsx`) : null }, xlsxError: x.ok ? null : x.error }
}

// ---- ship gate target ---------------------------------------------------------------

const tail = (s) => String(s || '').toLowerCase().replace(/^\//, '').split(':').pop()

/** Does a tool call start ship verification (VPR)? Agent/Task by subagent type or prompt, Skill by name. */
export function isShipTarget(input, settings) {
  const ti = input.tool_input || {}
  const skills = settings.ship.skills.map(tail)
  if (input.tool_name === 'Skill') return skills.includes(tail(ti.skill))
  if (input.tool_name === 'Agent' || input.tool_name === 'Task') {
    if (settings.ship.agents.map(tail).includes(tail(ti.subagent_type))) return true
    const prompt = String(ti.prompt || '').toLowerCase()
    return settings.ship.skills.some((s) => s && prompt.includes(String(s).toLowerCase()))
  }
  return false
}
