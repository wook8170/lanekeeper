// Test result workbook support: where results live, whether Python + openpyxl are available,
// the `lanekeeper-check test-results` verdict and the summary text used by /lanekeeper:report.
// The workbook itself is built by templates/test-results/core (Python).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { PLUGIN_ROOT, getPath } from './config.mjs'

export const CORE_DIR = path.join(PLUGIN_ROOT, 'templates', 'test-results', 'core')
export const PROJECT_DIR = path.join(PLUGIN_ROOT, 'templates', 'test-results', 'project')
export const VERIFY_CONFIG = path.join('.lanekeeper', 'verify.config.json')

const DEFAULTS = {
  test_results: 'docs/test-results/{date}/{name}-{HHMM}.xlsx',
  test_runs_raw: 'test-results/runs/{name}-{stamp}/',
  e2e_ledger: 'docs/e2e/',
}

export function resultPaths(root, config) {
  const get = (k) => String(getPath(config, `project.paths.${k}`) || DEFAULTS[k])
  const tpl = get('test_results')
  const raw = get('test_runs_raw')
  return {
    resultsTemplate: tpl,
    // the folder that holds the dated sub folders
    resultsBase: path.resolve(root, tpl.split('{')[0].replace(/[^/]*$/, '')),
    runsDir: path.resolve(root, raw.split('{')[0].replace(/[^/]*$/, '')),
    ledgerDir: path.resolve(root, get('e2e_ledger')),
  }
}

const p2 = (n) => String(n).padStart(2, '0')

/** Fill {date} {name} {HHMM} {stamp} of a path template. */
export function expandTemplate(tpl, name, d = new Date()) {
  const vars = {
    date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    HHMM: `${p2(d.getHours())}${p2(d.getMinutes())}`,
    stamp: `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`,
    name,
  }
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
}

/** python3 + openpyxl: { ok, python: 'ok'|'missing'|'old', openpyxl: bool, version } */
export function pythonStatus(env = process.env) {
  const py = env.LANEKEEPER_PYTHON || 'python3'
  const r = spawnSync(py, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' })
  if (r.error || r.status !== 0) return { ok: false, python: 'missing', openpyxl: false, version: '', cmd: py }
  const version = r.stdout.trim()
  const [maj, min] = version.split('.').map(Number)
  if (maj < 3 || (maj === 3 && min < 8)) return { ok: false, python: 'old', openpyxl: false, version, cmd: py }
  const o = spawnSync(py, ['-c', 'import openpyxl'], { encoding: 'utf8' })
  return { ok: o.status === 0, python: 'ok', openpyxl: o.status === 0, version, cmd: py }
}

/** Newest workbook under <resultsBase>/<date>/*.xlsx (date folder name first, then modification time). */
export function findLatest(base) {
  let best = null
  let dates = []
  try { dates = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return null }
  for (const d of dates) {
    for (const f of fs.readdirSync(path.join(base, d))) {
      if (!f.endsWith('.xlsx') || f.startsWith('~$')) continue
      const full = path.join(base, d, f)
      const key = [d, fs.statSync(full).mtimeMs]
      if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] > best.key[1])) best = { file: full, key }
    }
  }
  return best ? best.file : null
}

const git = (cwd, args) => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}

export function readSummary(xlsx) {
  try { return JSON.parse(fs.readFileSync(xlsx.replace(/\.xlsx$/, '.json'), 'utf8')) } catch { return null }
}

/**
 * `lanekeeper-check test-results`. Returns { ok, file, json, items[], summary }.
 * items: { id, level: 'ok'|'warn'|'fail', vars }. ok = no 'fail' item.
 * fail: no workbook, workbook or summary not committed, ledger exists and does not match the run.
 * warn: summary json missing, run commit differs from HEAD, verdict failed (fail with requirePass).
 */
export function checkTestResults(root, config, { requirePass = false } = {}) {
  const { resultsBase, resultsTemplate } = resultPaths(root, config)
  const items = []
  const add = (id, level, vars = {}) => items.push({ id, level, vars })
  const file = findLatest(resultsBase)
  if (!file) {
    add('none', 'fail', { dir: path.relative(root, resultsBase) || '.', template: resultsTemplate })
    return { ok: false, file: null, json: null, items, summary: null }
  }
  const rel = path.relative(root, file)
  add('found', 'ok', { file: rel })
  const jsonFile = file.replace(/\.xlsx$/, '.json')
  const summary = readSummary(file)
  if (!summary) add('json_missing', 'warn', { file: path.relative(root, jsonFile) })

  const tracked = (f) => git(root, ['ls-files', '--error-unmatch', '--', f]) !== null
  const dirty = (f) => (git(root, ['status', '--porcelain', '--', f]) || '') !== ''
  const inGit = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true'
  if (inGit) {
    const files = [file, ...(summary ? [jsonFile] : [])]
    const bad = files.filter((f) => !tracked(f) || dirty(f)).map((f) => path.relative(root, f))
    if (bad.length) add('uncommitted', 'fail', { files: bad.join(', ') })
    else add('committed', 'ok', { file: rel })
  } else add('no_git', 'warn')

  if (summary) {
    const v = summary.verdict
    add('verdict', v === 'passed' ? 'ok' : requirePass ? 'fail' : 'warn', { verdict: v })
    const head = git(root, ['rev-parse', '--short', 'HEAD'])
    const ran = String(summary.meta?.commit || '')
    if (head && ran) {
      const same = head.startsWith(ran) || ran.startsWith(head)
      // a commit that only adds result files (this workbook) keeps the run valid
      const resultsOnly = !same && onlyUnder(resultsPrefix(config), changedSince(root, ran, 'HEAD'))
      add(same ? 'head_ok' : resultsOnly ? 'head_results_only' : 'head_differs', same || resultsOnly ? 'ok' : 'warn', { run: ran, head })
    }
    if (summary.meta?.ledgerCases) {
      const n = (summary.ledger || []).length
      if (summary.meta.ledgerCompared) add(n === 0 ? 'ledger_ok' : 'ledger_mismatch', n === 0 ? 'ok' : 'fail', { n, cases: summary.meta.ledgerCases })
      else add('ledger_not_compared', 'warn', { cases: summary.meta.ledgerCases })
    }
  }
  return { ok: !items.some((i) => i.level === 'fail'), file: rel, json: summary ? path.relative(root, jsonFile) : null, items, summary }
}

/** Counts for /lanekeeper:report and the chat summary: one object, no formatting. */
export function summarize(summary) {
  if (!summary) return null
  const by = {}
  for (const s of summary.suites || []) {
    const k = s.kind
    by[k] ||= { suites: 0, total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 }
    by[k].suites += 1
    for (const f of ['total', 'passed', 'failed', 'skipped', 'flaky']) by[k][f] += s[f] || 0
  }
  const gate = summary.gate || []
  return {
    verdict: summary.verdict,
    name: summary.meta?.name,
    commit: summary.meta?.commit,
    kinds: by,
    gate: { steps: gate.length, failed: gate.filter((g) => g.status === 'failed').length, notRun: gate.filter((g) => g.status === 'notRun').length },
    failures: (summary.failures || []).filter((t) => t.status === 'failed').length,
    flaky: (summary.failures || []).filter((t) => t.status === 'flaky' || t.flakyByRerun).length,
    ledger: summary.meta?.ledgerCompared ? { cases: summary.meta.ledgerCases, mismatches: (summary.ledger || []).length } : null,
  }
}

// ---- gate lock -----------------------------------------------------------
// <git common dir>/lanekeeper/gate.lock exists while a gate or verify run is in progress. The
// safety hook and lanekeeper-integrate refuse merges meanwhile; lanekeeper-reap clears a stale lock.
// Returns { ok: true, file, release } or { ok: false, pid } when a live run holds it.
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

export function acquireGateLock(sd, { command = '', pid = process.pid, now = new Date() } = {}) {
  if (!sd) return { ok: true, file: null, release() {} }
  const file = path.join(sd, 'gate.lock')
  try {
    const cur = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Number.isInteger(cur?.pid) && cur.pid !== pid && alive(cur.pid)) return { ok: false, pid: cur.pid, file }
  } catch {
    /* none, or unreadable: replace it */
  }
  fs.mkdirSync(sd, { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ pid, at: now.toISOString(), command })}\n`)
  let done = false
  return {
    ok: true,
    file,
    release() {
      if (done) return
      done = true
      try {
        if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === pid) fs.rmSync(file, { force: true })
      } catch {
        /* already gone */
      }
    },
  }
}

// ---- gate pass stamp -----------------------------------------------------
// <git common dir>/lanekeeper/<project.git.gate_stamp>.json { head, at, command } is written after a
// full gate pass on a clean `head`. The safety hook reads it before a protected merge or push.

/** Repo-relative folder (posix, trailing slash) that holds the result workbooks; '' when the template has none. */
export function resultsPrefix(config) {
  const tpl = String(getPath(config, 'project.paths.test_results') || DEFAULTS.test_results)
  return tpl.split('{')[0].replace(/[^/]*$/, '').replace(/^\.\//, '').replace(/\\/g, '/')
}

/** true when `files` (from changedSince) is a list and every path is under `prefix`: a commit that only adds result files. */
export function onlyUnder(prefix, files) {
  if (!prefix || !Array.isArray(files)) return false
  return files.every((f) => f.startsWith(prefix))
}

/** Changed paths from `from` to `to`, or null when `from` is not an ancestor of `to` (or git fails). */
export function changedSince(root, from, to = 'HEAD') {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', from, to], { cwd: root, stdio: 'ignore' })
  } catch {
    return null
  }
  const out = git(root, ['diff', '--name-only', from, to])
  return out === null ? null : out.split('\n').filter(Boolean)
}

/** Full HEAD sha and whether tracked files are unchanged (untracked files are ignored). */
export function headState(root) {
  const head = git(root, ['rev-parse', '-q', '--verify', 'HEAD'])
  const st = git(root, ['status', '--porcelain', '--untracked-files=no'])
  return { head, clean: st === '' }
}

export function stampFile(sd, config) {
  return path.join(sd, `${getPath(config, 'project.git.gate_stamp') || 'lanekeeper-gate-pass'}.json`)
}

export function writeGateStamp(file, { head, command, gate, now = new Date() }) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const s = { head, at: now.toISOString(), command, ...(gate ? { gate } : {}) }
  fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`)
  return s
}
