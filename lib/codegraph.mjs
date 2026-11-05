// codegraph layer: the index queue (one index job at a time, low priority,
// inside a heavy slot), copying an existing index into a new worktree, response
// classification for the metrics file, per-session hook state, and the checks
// /lanekeeper:doctor shows.
//
// Files
//   <lanekeeper home>/run/codegraph/queue.json   machine-wide queue
//     { version: 1, items: [{ path, reason, added, state: queued|running, pid?, started? }],
//       history: [{ path, method: sync|copy|init|gone|failed, status, ms, at, error? }] }
//   <lanekeeper home>/run/codegraph/worker.pid   the running worker (created with O_EXCL)
//   <lanekeeper home>/run/codegraph/worker.log   worker output (trimmed)
//   <plugin data>/codegraph/sessions/<session>.json   { nudged, dead: { <path>: at }, queued: [] }
//   <main checkout>/<paths.metrics>/codegraph.jsonl   one line per codegraph tool response
//
// codegraph is optional. Without it on PATH every function here reports
// "missing" and does nothing; no hook fails because of it. LANEKEEPER_CODEGRAPH=off
// turns the layer off, LANEKEEPER_CODEGRAPH=<file> names the binary.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { lanekeeperHome, getPath, resolveConfig, expandHome, stateDir } from './config.mjs'
import { update, readJson as readLedger } from './ledger.mjs'
import { dataDir, safeId } from './runtime.mjs'
import * as slots from './slots.mjs'
import { projectRel } from './naming.mjs'

export const INDEX_DIR = '.codegraph'
export const EXCLUDE_LINE = '.codegraph/'
export const METRICS_FILE = 'codegraph.jsonl'
export const CLASSES = ['ok', 'empty', 'not_initialized', 'no_project', 'error']
const HISTORY_MAX = 50
const JOB_TIMEOUT_MS = 60 * 60_000
const LOG_MAX = 256 * 1024
const SESSION_TTL_MS = 7 * 24 * 3600_000
const LANEKEEPER_INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lanekeeper-index')

// ---------------------------------------------------------------- binary

export function findBin(env = process.env) {
  const v = env.LANEKEEPER_CODEGRAPH
  if (v === 'off' || v === '0') return null
  if (v) return fs.existsSync(v) ? v : null
  for (const d of (env.PATH || '').split(path.delimiter)) {
    if (!d) continue
    const p = path.join(d, 'codegraph')
    try {
      if (fs.statSync(p).isFile()) return p
    } catch {}
  }
  return null
}

function onPath(name, env) {
  return (env.PATH || '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, name)))
}

export const indexDb = (dir) => path.join(dir, INDEX_DIR, 'codegraph.db')
export const hasIndex = (dir) => Boolean(dir) && fs.existsSync(indexDb(dir))

function gitOut(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim()
  } catch {
    return null
  }
}

// Top of the git checkout that holds `p` (a file or a folder), or null.
export function checkoutOf(p) {
  if (!p) return null
  let dir = path.resolve(p)
  try {
    if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir)
  } catch {
    return null
  }
  const top = gitOut(dir, ['rev-parse', '--show-toplevel'])
  return top ? fs.realpathSync(top) : null
}

// Main checkout and every live worktree of the repository that holds `top`.
export function worktreesOf(top) {
  const out = gitOut(top, ['worktree', 'list', '--porcelain'])
  if (!out) return []
  const list = []
  let cur
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) list.push((cur = { path: line.slice(9), prunable: false, bare: false }))
    else if (line.startsWith('prunable')) cur.prunable = true
    else if (line === 'bare') cur.bare = true
  }
  return list.filter((w) => !w.bare)
}

// Add `.codegraph/` to <git-common-dir>/info/exclude so an index never makes a
// worktree look dirty (git refuses to remove a worktree with untracked files).
// A line added here (not by /lanekeeper:init) is noted in <state>/auto-excludes.json so
// /lanekeeper:doctor can mention it; init passes record:false.
export function ensureExclude(top, line = EXCLUDE_LINE, { record = true } = {}) {
  const common = gitOut(top, ['rev-parse', '--git-common-dir'])
  if (!common) return false
  const file = path.join(path.resolve(top, common), 'info', 'exclude')
  const body = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (body.split('\n').some((l) => l.trim() === line || l.trim() === line.replace(/\/$/, ''))) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${body}${body && !body.endsWith('\n') ? '\n' : ''}${line}\n`)
  if (record) noteAutoExclude(top, line)
  return true
}

const autoExcludeFile = (top) => {
  const s = stateDir(top)
  return s ? path.join(s, 'auto-excludes.json') : null
}

function noteAutoExclude(top, line) {
  try {
    const f = autoExcludeFile(top)
    if (!f) return
    const cur = autoExcludes(top)
    if (cur.includes(line)) return
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, `${JSON.stringify({ version: 1, lines: [...cur, line] }, null, 2)}\n`)
  } catch {}
}

// Lines lanekeeper added to info/exclude on its own, outside /lanekeeper:init.
export function autoExcludes(top) {
  try {
    const f = autoExcludeFile(top)
    const lines = f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).lines : []
    return Array.isArray(lines) ? lines : []
  } catch {
    return []
  }
}

// project.codegraph.auto_index (default true); the old name index_on_worktree is
// read when the new one is absent.
export function autoIndexEnabled(config) {
  const cg = config?.project?.codegraph
  const v = cg?.auto_index !== undefined ? cg.auto_index : cg?.index_on_worktree
  return v !== false
}

export function dirSize(dir) {
  let total = 0
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    try {
      if (e.isDirectory()) total += dirSize(p)
      else if (e.isFile()) total += fs.statSync(p).size
    } catch {}
  }
  return total
}

export function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

// Delete <dir>/.codegraph only (never the folder itself, never through a link).
export function dropIndex(dir) {
  const p = path.join(dir, INDEX_DIR)
  try {
    if (fs.lstatSync(p).isSymbolicLink()) return false
  } catch {
    return false
  }
  fs.rmSync(p, { recursive: true, force: true })
  return true
}

// ---------------------------------------------------------------- queue

export const queueDir = (env = process.env) => path.join(lanekeeperHome(env), 'run', 'codegraph')
export const queueFile = (env = process.env) => path.join(queueDir(env), 'queue.json')
const EMPTY_QUEUE = { version: 1, items: [], history: [] }

export function readQueue(env = process.env) {
  try {
    const q = readLedger(queueFile(env), structuredClone(EMPTY_QUEUE))
    return { ...structuredClone(EMPTY_QUEUE), ...q }
  } catch {
    return structuredClone(EMPTY_QUEUE)
  }
}

// Add a checkout to the queue. Returns { queued: true } or { skipped: <why> }.
export function enqueue(target, { reason = 'manual', env = process.env, now = () => Date.now() } = {}) {
  if (!findBin(env)) return { skipped: 'missing' }
  const top = checkoutOf(target)
  if (!top) return { skipped: 'not-git' }
  const added = update(queueFile(env), EMPTY_QUEUE, (q) => {
    q.items ||= []
    if (q.items.some((i) => i.path === top)) return false
    q.items.push({ path: top, reason, added: new Date(now()).toISOString(), state: 'queued' })
    return true
  })
  return added ? { queued: true, path: top } : { skipped: 'already', path: top }
}

export function dequeue(target, env = process.env) {
  const p = fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target)
  if (!fs.existsSync(queueFile(env))) return false
  return update(queueFile(env), EMPTY_QUEUE, (q) => {
    const before = q.items.length
    q.items = q.items.filter((i) => i.path !== p)
    return q.items.length !== before
  })
}

// Queue automatically (worktree created, grep in an unindexed checkout, a
// codegraph call that found no index) when project.codegraph.auto_index
// is on, then make sure a worker runs.
export function autoQueue(target, { reason, config, env = process.env, start = startWorker } = {}) {
  if (!autoIndexEnabled(config)) return { skipped: 'disabled' }
  const r = enqueue(target, { reason, env })
  if (r.queued || r.skipped === 'already') {
    try {
      start(env)
    } catch {}
  }
  return r
}

// ---------------------------------------------------------------- worker

const pidFile = (env) => path.join(queueDir(env), 'worker.pid')
const logFile = (env) => path.join(queueDir(env), 'worker.log')

function pidAlive(pid) {
  return slots.pidAlive(pid)
}

export function workerPid(env = process.env) {
  try {
    const pid = Number(fs.readFileSync(pidFile(env), 'utf8').trim())
    return pid && pidAlive(pid) ? pid : null
  } catch {
    return null
  }
}

function takeWorkerLock(env) {
  fs.mkdirSync(queueDir(env), { recursive: true })
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(pidFile(env), 'wx')
      fs.writeSync(fd, String(process.pid))
      fs.closeSync(fd)
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (workerPid(env)) return false
      try {
        fs.unlinkSync(pidFile(env))
      } catch {}
    }
  }
  return false
}

function dropWorkerLock(env) {
  try {
    if (Number(fs.readFileSync(pidFile(env), 'utf8').trim()) === process.pid) fs.unlinkSync(pidFile(env))
  } catch {}
}

// Start a detached worker unless one runs or nothing is queued.
export function startWorker(env = process.env) {
  if (workerPid(env)) return false
  if (!readQueue(env).items.some((i) => i.state === 'queued' || (i.state === 'running' && !pidAlive(i.pid)))) return false
  fs.mkdirSync(queueDir(env), { recursive: true })
  try {
    if (fs.statSync(logFile(env)).size > LOG_MAX) fs.truncateSync(logFile(env), 0)
  } catch {}
  const fd = fs.openSync(logFile(env), 'a')
  const child = spawn(process.execPath, [LANEKEEPER_INDEX, 'run', '--quiet'], { detached: true, stdio: ['ignore', fd, fd], env })
  child.unref()
  fs.closeSync(fd)
  return child.pid
}

export function defaultRun(bin, args, { cwd, nice = true, timeoutMs = JOB_TIMEOUT_MS, env = process.env } = {}) {
  const useNice = nice && process.platform !== 'win32' && onPath('nice', env)
  const [cmd, argv] = useNice ? ['nice', ['-n', '10', bin, ...args]] : [bin, args]
  const r = spawnSync(cmd, argv, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs })
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || String(r.error?.message || '') }
}

// The sqlite3 shell reads a single-quoted dot-command argument literally, with no
// escape for a quote. A path with a quote or a control character goes the file-copy way.
export const sqliteArgOk = (p) => !/['\x00-\x1f\x7f]/.test(String(p))

// Copy an index into `target`: a consistent sqlite3 snapshot when sqlite3 is
// on PATH, otherwise the database with its WAL files. Never copies the daemon
// files (pid, socket, log).
export function copyIndex(seed, target, { env = process.env } = {}) {
  const from = path.join(seed, INDEX_DIR)
  const to = path.join(target, INDEX_DIR)
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(to, { recursive: true })
  if (fs.existsSync(path.join(from, '.gitignore'))) fs.copyFileSync(path.join(from, '.gitignore'), path.join(to, '.gitignore'))
  const dest = path.join(to, 'codegraph.db')
  if (onPath('sqlite3', env) && sqliteArgOk(dest)) {
    const r = spawnSync('sqlite3', [path.join(from, 'codegraph.db'), `.backup '${dest}'`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60_000 })
    if (r.status === 0) return 'sqlite3'
    fs.rmSync(path.join(to, 'codegraph.db'), { force: true })
  }
  for (const f of ['codegraph.db', 'codegraph.db-wal', 'codegraph.db-shm']) {
    if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(to, f))
  }
  return 'files'
}

// An indexed checkout of the same repository to copy from (main checkout first).
export function seedFor(top) {
  const list = worktreesOf(top).filter((w) => !w.prunable && fs.existsSync(w.path))
  for (const w of list) {
    const p = fs.realpathSync(w.path)
    if (p !== top && hasIndex(p)) return p
  }
  return null
}

function statusOk(bin, dir, run, env) {
  const r = run(bin, ['status', '--json', dir], { cwd: dir, env, nice: false, timeoutMs: 60_000 })
  if (r.status !== 0) return false
  try {
    return JSON.parse(r.stdout).initialized === true
  } catch {
    return false
  }
}

// Bring the index of one checkout up to date.
//   index present        → codegraph sync
//   another worktree has one → copy it, check it opens, codegraph sync (only changed files are parsed)
//   nothing to copy      → codegraph init
// Falls back to init when the copy does not open or the sync fails.
export function indexOne(target, { env = process.env, run = defaultRun, now = () => Date.now() } = {}) {
  const bin = findBin(env)
  const start = now()
  if (!bin) return { path: target, method: 'failed', status: 1, error: 'codegraph missing', ms: 0 }
  if (!fs.existsSync(target)) return { path: target, method: 'gone', status: 0, ms: 0 }
  ensureExclude(target)
  const opts = { cwd: target, env }
  if (hasIndex(target)) {
    const r = run(bin, ['sync', target], opts)
    if (r.status === 0) return { path: target, method: 'sync', status: 0, ms: now() - start }
  } else {
    const seed = seedFor(target)
    if (seed) {
      let via = null
      try {
        via = copyIndex(seed, target, { env })
      } catch {}
      if (via && statusOk(bin, target, run, env) && run(bin, ['sync', target], opts).status === 0) {
        return { path: target, method: 'copy', via, seed, status: 0, ms: now() - start }
      }
    }
  }
  dropIndex(target)
  const r = run(bin, ['init', target], opts)
  return { path: target, method: r.status === 0 ? 'init' : 'failed', status: r.status, ms: now() - start, ...(r.status ? { error: (r.stderr || r.stdout).trim().split('\n').slice(-1)[0]?.slice(0, 200) } : {}) }
}

function pushHistory(q, result, now) {
  q.history ||= []
  q.history.push({ ...result, at: new Date(now()).toISOString() })
  if (q.history.length > HISTORY_MAX) q.history.splice(0, q.history.length - HISTORY_MAX)
}

// Run queued jobs one by one until the queue is empty. Only one worker runs per
// machine; each job waits for a heavy slot (and so for the load threshold).
export async function runWorker({ env = process.env, run = defaultRun, now = () => Date.now(), log = () => {}, slotDeps = slots.defaultDeps(), pollMs = 5000 } = {}) {
  const done = []
  for (;;) {
    if (!takeWorkerLock(env)) return { busy: true, done }
    try {
      for (;;) {
        const item = update(queueFile(env), EMPTY_QUEUE, (q) => {
          for (const i of q.items) if (i.state === 'running' && !pidAlive(i.pid)) i.state = 'queued'
          const next = q.items.find((i) => i.state === 'queued')
          if (!next) return null
          Object.assign(next, { state: 'running', pid: process.pid, started: new Date(now()).toISOString() })
          return { ...next }
        })
        if (!item) break
        const resolved = resolveConfig({ projectDir: fs.existsSync(item.path) ? item.path : queueDir(env), env })
        const settings = slots.slotSettings(resolved, (p) => expandHome(p, env.HOME))
        const held = String(env.LANEKEEPER_SLOT_HELD || '').split(',').includes('heavy')
        const got = held ? { leases: [] } : await slots.acquire(['heavy'], settings, { lane: 'codegraph-index', command: `codegraph index ${item.path}`, cwd: item.path }, { pollMs, onWait: (w) => log('wait', w) }, slotDeps)
        let result
        try {
          log('start', item)
          result = indexOne(item.path, { env, run, now })
        } catch (e) {
          result = { path: item.path, method: 'failed', status: 1, error: String(e?.message || e).slice(0, 200), ms: 0 }
        } finally {
          for (const l of got.leases || []) slots.release(l)
        }
        log('done', result)
        done.push(result)
        update(queueFile(env), EMPTY_QUEUE, (q) => {
          q.items = q.items.filter((i) => i.path !== item.path)
          pushHistory(q, result, now)
        })
      }
    } finally {
      dropWorkerLock(env)
    }
    // something queued while the lock was being released → go round once more
    if (!readQueue(env).items.some((i) => i.state === 'queued')) return { busy: false, done }
  }
}

// ---------------------------------------------------------------- responses

export function responseText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(responseText).join('\n')
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text
    if (v.content !== undefined) return responseText(v.content)
    if (v.result !== undefined) return responseText(v.result)
    try {
      return JSON.stringify(v)
    } catch {
      return ''
    }
  }
  return String(v)
}

// One of ok · empty · not_initialized · no_project · error (+ stale for ok).
export function classify(text, isError = false) {
  const t = String(text || '')
  if (/not initialized/i.test(t)) return { cls: 'not_initialized' }
  if (/No CodeGraph project is loaded/i.test(t)) return { cls: 'no_project' }
  if (isError) return { cls: 'error' }
  const head = t.trimStart().slice(0, 300)
  if (/^No results found/i.test(head) || /\(0 found\)/.test(head) || /No relevant|No matching/i.test(head)) return { cls: 'empty' }
  const stale = /edited since the last index sync/i.test(t) || /stale/i.test(head)
  return { cls: 'ok', stale }
}

export const isCodegraphTool = (name) => /^mcp__.*codegraph.*__codegraph_\w+$/.test(String(name || ''))
export const toolShort = (name) => String(name || '').replace(/^.*__/, '')

// Path a codegraph call is about: projectPath, or the path named in a
// "not initialized in <path>" message, or '' for the server's own project.
export function callPath(input, text = '') {
  const p = input?.tool_input?.projectPath
  if (p) return path.resolve(input.cwd || process.cwd(), String(p))
  const m = /not initialized in (\/[^\s'"]+?)\.?(?:\s|$)/i.exec(String(text))
  return m ? m[1] : ''
}

// main checkout of the repository holding `cwd`, so lane worktrees write to one file
export function metricsPath(cwd, config) {
  const top = checkoutOf(cwd) || path.resolve(cwd)
  const common = gitOut(top, ['rev-parse', '--git-common-dir'])
  let root = top
  if (common) {
    const c = path.resolve(top, common)
    if (path.basename(c) === '.git') root = path.dirname(c)
  }
  const rel = projectRel(root, getPath(config || {}, 'project.paths.metrics') || '.lanekeeper/metrics/')
  return { root, file: path.join(path.resolve(root, rel), METRICS_FILE), rel }
}

export function appendMetric(cwd, config, row) {
  const { root, file, rel } = metricsPath(cwd, config)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file) && !path.isAbsolute(rel)) {
    try {
      ensureExclude(root, `${rel.replace(/\/?$/, '/')}`)
    } catch {}
  }
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`)
  return file
}

export function readMetrics(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

// Counts per class and the error rate, on the same basis as the measurement
// report (error = not_initialized + no_project + error, over all responses).
export function summarize(rows, { sinceMs = null } = {}) {
  const list = sinceMs == null ? rows : rows.filter((r) => Date.parse(r.ts) >= sinceMs)
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]))
  let stale = 0
  for (const r of list) {
    if (counts[r.class] !== undefined) counts[r.class]++
    if (r.stale) stale++
  }
  const total = list.length
  const errors = counts.not_initialized + counts.no_project + counts.error
  return { total, counts, stale, errors, error_rate: total ? errors / total : 0, sessions: new Set(list.map((r) => r.session)).size }
}

// ---------------------------------------------------------------- session state

export const sessionsDir = (env = process.env) => path.join(dataDir(env), 'codegraph', 'sessions')
const sessionFile = (id, env) => path.join(sessionsDir(env), `${safeId(id)}.json`)

export function loadSession(id, env = process.env) {
  try {
    const s = JSON.parse(fs.readFileSync(sessionFile(id, env), 'utf8'))
    return { nudged: false, dead: {}, queued: [], ...s }
  } catch {
    return { nudged: false, dead: {}, queued: [] }
  }
}

export function saveSession(id, state, env = process.env, now = () => Date.now()) {
  const dir = sessionsDir(env)
  fs.mkdirSync(dir, { recursive: true })
  const file = sessionFile(id, env)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state))
  fs.renameSync(tmp, file)
  // forget old sessions now and then
  if (Math.random() < 0.05) {
    for (const f of fs.readdirSync(dir)) {
      try {
        const p = path.join(dir, f)
        if (now() - fs.statSync(p).mtimeMs > SESSION_TTL_MS) fs.unlinkSync(p)
      } catch {}
    }
  }
}

// ---------------------------------------------------------------- grep nudge

const VALUE_OPTS = {
  grep: new Set(['e', 'f', 'm', 'A', 'B', 'C', 'd', 'D']),
  rg: new Set(['e', 'f', 'g', 't', 'T', 'm', 'A', 'B', 'C', 'j', 'M']),
}
const LONG_VALUE = new Set(['--regexp', '--file', '--max-count', '--context', '--after-context', '--before-context', '--include', '--exclude', '--exclude-dir', '--glob', '--type', '--type-not', '--threads', '--color', '--colour', '--max-columns'])

// { pattern, patterns, paths } of a grep/rg command, or null for other commands
// and for a grep that only filters piped input.
export function grepCall(cmd) {
  const kind = cmd.name === 'rg' ? 'rg' : ['grep', 'egrep', 'fgrep'].includes(cmd.name) ? 'grep' : null
  if (!kind || cmd.pipedFrom) return null
  const patterns = []
  const rest = []
  const args = cmd.args.map((a) => a.text)
  let endOpts = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!endOpts && a === '--') {
      endOpts = true
      continue
    }
    if (!endOpts && a.startsWith('--')) {
      const [name, val] = a.split('=', 2)
      if (name === '--regexp') patterns.push(val ?? args[++i])
      else if (val === undefined && LONG_VALUE.has(name)) i++
      continue
    }
    if (!endOpts && a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        if (VALUE_OPTS[kind].has(a[j])) {
          const val = a.slice(j + 1) || args[++i]
          if (a[j] === 'e') patterns.push(val)
          break
        }
      }
      continue
    }
    rest.push(a)
  }
  if (!patterns.length) {
    if (!rest.length) return null
    patterns.push(rest.shift())
  }
  return { patterns, pattern: patterns.length === 1 ? patterns[0] : null, paths: rest }
}

const KEYWORDS = new Set(['TODO', 'FIXME', 'XXX', 'NOTE', 'HACK'])

// The identifier a pattern looks for (a function, type or constant name), or null.
// Plain lowercase words and all-capital words (TODO, ERROR) are not identifiers here.
export function identifierOf(pattern) {
  if (pattern == null) return null
  let s = String(pattern).trim()
  s = s.replace(/^\^/, '').replace(/\$$/, '')
  s = s.replace(/^(\\b|\\<)/, '').replace(/(\\b|\\>)$/, '')
  s = s.replace(/(\\?\()$/, '')
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{2,}$/.test(s)) return null
  if (KEYWORDS.has(s)) return null
  if (/^[a-z0-9]+$/.test(s)) return null
  if (/^[A-Z0-9]+$/.test(s)) return null
  return s
}

// ---------------------------------------------------------------- orphans

// Indexes in folders that are no longer worktrees of the repository: paths
// the queue indexed before, .claude/worktrees/*, and folders matching
// project.git.worktree_root.
export function scanIndexes(top, config, env = process.env) {
  const live = worktreesOf(top)
    .filter((w) => !w.prunable && fs.existsSync(w.path))
    .map((w) => fs.realpathSync(w.path))
  const main = live[0] || top
  const cands = new Set()
  for (const h of readQueue(env).history || []) if (h.path) cands.add(h.path)
  const add = (dir, re = null) => {
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && (!re || re.test(e.name))) cands.add(path.join(dir, e.name))
    } catch {}
  }
  add(path.join(main, '.claude', 'worktrees'))
  const tpl = config?.project?.git?.worktree_root || '{repo}/../wt-{task}'
  const pattern = expandHome(tpl.replace(/\{repo\}/g, main), env.HOME)
  const abs = path.resolve(main, pattern)
  const base = path.basename(abs)
  if (/\{(task|lane|name)\}/.test(base)) {
    const re = new RegExp(`^${base.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\{(task|lane|name)\}/g, '.+')}$`)
    add(path.dirname(abs), re)
  }
  const liveSet = new Set(live)
  const indexed = []
  const orphans = []
  for (const p of live) if (hasIndex(p)) indexed.push({ path: p, bytes: dirSize(path.join(p, INDEX_DIR)) })
  for (const c of cands) {
    let real
    try {
      real = fs.realpathSync(c)
    } catch {
      continue
    }
    if (liveSet.has(real) || !fs.existsSync(path.join(real, INDEX_DIR))) continue
    if (orphans.some((o) => o.path === real)) continue
    orphans.push({ path: real, bytes: dirSize(path.join(real, INDEX_DIR)) })
  }
  return { indexed, orphans }
}

// Facts for /lanekeeper:doctor (all optional; never throws).
export function doctorInfo(projectDir, config, env = process.env) {
  const bin = findBin(env)
  const info = { installed: Boolean(bin), bin, indexed: null, queue: null, orphans: [], indexes: [], autoExcludes: autoExcludes(projectDir) }
  if (!bin) return info
  try {
    const top = checkoutOf(projectDir)
    info.indexed = top ? hasIndex(top) : null
    const q = readQueue(env)
    const recent = (q.history || []).slice(-10)
    info.queue = { waiting: q.items.filter((i) => i.state === 'queued').length, running: q.items.filter((i) => i.state === 'running').length, failed: recent.filter((h) => h.method === 'failed'), worker: workerPid(env) }
    if (top) {
      const s = scanIndexes(top, config, env)
      info.orphans = s.orphans
      info.indexes = s.indexed
    }
  } catch {}
  return info
}
