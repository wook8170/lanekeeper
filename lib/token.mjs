// Token guard: usage against the plan limits and the stage reached.
//
// 1st source: the official usage Claude Code caches in ~/.claude.json
//   (cachedUsageUtilization: five-hour and seven-day percentages, reset times,
//   account). Only that key and oauthAccount.accountUuid are read.
// When the cache is older than fresh_min, the estimate adds the weighted local
// tokens since then, scaled by a per-account ratio r (% per weighted token)
// learned from the official snapshots. After a reset only the tokens since the
// reset count. Without a cache the budget (or 100 / r) is the fallback.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getPath } from './config.mjs'
import { claudeDir, dataDir, readJson, writeJsonAtomic, safeId } from './runtime.mjs'

const ROLES = ['shrink', 'handoff', 'critical']
const CHUNK = 1 << 20

function listTranscripts(root, sinceMs) {
  const out = []
  const walk = (dir, depth) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < 4) walk(p, depth + 1)
      } else if (e.name.endsWith('.jsonl')) {
        try {
          if (fs.statSync(p).mtimeMs >= sinceMs) out.push(p)
        } catch {
          /* vanished */
        }
      }
    }
  }
  walk(root, 0)
  return out
}

// Visit the lines of a file from the end; stop when `visit` returns false.
function eachLineFromEnd(file, visit) {
  const fd = fs.openSync(file, 'r')
  try {
    let pos = fs.fstatSync(fd).size
    let carry = Buffer.alloc(0)
    while (pos > 0) {
      const n = Math.min(CHUNK, pos)
      pos -= n
      const buf = Buffer.alloc(n)
      fs.readSync(fd, buf, 0, n, pos)
      const all = Buffer.concat([buf, carry])
      let text
      if (pos === 0) {
        text = all.toString('utf8')
        carry = Buffer.alloc(0)
      } else {
        const nl = all.indexOf(10)
        if (nl < 0) {
          carry = all
          continue
        }
        carry = all.subarray(0, nl)
        text = all.subarray(nl + 1).toString('utf8')
      }
      const parts = text.split('\n')
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i] && visit(parts[i]) === false) return
    }
  } finally {
    fs.closeSync(fd)
  }
}

const FIVE = 5 * 3600e3
const SEVEN = 7 * 24 * 3600e3
const DIMS = { five: { span: FIVE, reset: 'five_reset' }, seven: { span: SEVEN, reset: 'seven_reset' } }

const weigh = (u) => (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1 + (u.output_tokens || 0) * 5

// Weighted tokens with a timestamp in [from, to): input + 1.25 cache write +
// 0.1 cache read + 5 output (an approximation of the price ratio). Also lists
// the five-hour rejections (the limit was reached) seen in the range.
export function windowUsage({ env = process.env, from, to = Date.now() } = {}) {
  const u = { msgs: 0, output: 0, input: 0, cache_read: 0, cache_creation: 0, limits: [] }
  let w = 0
  for (const f of listTranscripts(path.join(claudeDir(env), 'projects'), from - 3600e3)) {
    eachLineFromEnd(f, (line) => {
      let j
      try {
        j = JSON.parse(line)
      } catch {
        return true
      }
      const ts = Date.parse(j.timestamp)
      if (!Number.isFinite(ts)) return true
      if (ts < from) return false
      if (ts >= to) return true
      const rl = j.apiErrorParams?.rate_limit_info
      if (rl && rl.status === 'rejected' && rl.rateLimitType === 'five_hour' && Number.isFinite(rl.resetsAt)) u.limits.push({ at: ts, reset: rl.resetsAt * 1000 })
      const us = j.message?.usage
      if (!us) return true
      u.msgs++
      u.output += us.output_tokens || 0
      u.input += us.input_tokens || 0
      u.cache_read += us.cache_read_input_tokens || 0
      u.cache_creation += us.cache_creation_input_tokens || 0
      w += weigh(us)
      return true
    })
  }
  u.limits.sort((a, b) => a.at - b.at)
  u.weighted = Math.floor(w)
  return u
}

// Weighted tokens of the last `hours` hours.
export function localUsage({ env = process.env, now = Date.now(), hours = 5 } = {}) {
  const { limits, ...u } = windowUsage({ env, from: now - hours * 3600e3, to: Infinity })
  return u
}
export const percent = (weighted, budget) => (budget > 0 ? Math.floor((weighted * 100) / budget) : 0)

export function stagesOf(resolved) {
  const s = getPath(resolved.config, 'personal.token_guard.stages')
  return [...new Set(Array.isArray(s) && s.length ? s : [90, 95, 99])].sort((a, b) => a - b)
}

// Highest stage not above the percentage, with its role.
export function tierFor(util, stages) {
  let idx = -1
  stages.forEach((s, i) => {
    if (util >= s) idx = i
  })
  if (idx < 0) return { tier: 0, role: null }
  const role = idx === stages.length - 1 && stages.length > 1 ? 'critical' : stages.length >= 3 ? ROLES[Math.min(idx, 1)] : idx === 0 ? 'shrink' : 'handoff'
  return { tier: stages[idx], role }
}

export const tierFile = (sid, env = process.env) => path.join(dataDir(env), 'token-guard', `${safeId(sid)}.tier`)

export function readTier(sid, env = process.env) {
  try {
    const n = Number(fs.readFileSync(tierFile(sid, env), 'utf8').trim())
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function writeTier(sid, tier, env = process.env) {
  fs.mkdirSync(path.dirname(tierFile(sid, env)), { recursive: true })
  fs.writeFileSync(tierFile(sid, env), String(tier))
}

// ---- official usage -----------------------------------------------------------

export function claudeJsonFile(env = process.env) {
  if (env.WB_CLAUDE_JSON) return path.resolve(env.WB_CLAUDE_JSON)
  return env.CLAUDE_CONFIG_DIR ? path.join(path.resolve(env.CLAUDE_CONFIG_DIR), '.claude.json') : path.join(env.HOME || os.homedir(), '.claude.json')
}

const pctOf = (v) => (v && Number.isFinite(Number(v.utilization)) ? Number(v.utilization) : null)
const resetOf = (v) => {
  const t = v && v.resets_at ? Date.parse(v.resets_at) : NaN
  return Number.isFinite(t) ? t : null
}

// The official cache of the active account. Returns { account, snapshot, mismatch }.
// A cache written for another account (the user switched) is not used.
export function officialUsage({ env = process.env } = {}) {
  const j = readJson(claudeJsonFile(env))
  const c = j && j.cachedUsageUtilization
  const active = (j && j.oauthAccount && j.oauthAccount.accountUuid) || null
  const account = active || (c && c.accountUuid) || null
  if (!c || !Number.isFinite(c.fetchedAtMs) || !c.utilization) return { account, snapshot: null, mismatch: false }
  if (active && c.accountUuid && c.accountUuid !== active) return { account, snapshot: null, mismatch: true, cached_account: c.accountUuid }
  const u = c.utilization
  const snapshot = { at: c.fetchedAtMs, account: c.accountUuid || account, five: pctOf(u.five_hour), seven: pctOf(u.seven_day), five_reset: resetOf(u.five_hour), seven_reset: resetOf(u.seven_day), source: 'official' }
  return { account: snapshot.account, snapshot, mismatch: false }
}

const tgDir = (env) => path.join(dataDir(env), 'token-guard')
export const historyFile = (env = process.env) => path.join(tgDir(env), 'official-history.jsonl')
export const calibFile = (account, env = process.env) => path.join(tgDir(env), `calib-${safeId(account)}.json`)

// Snapshots of one account in time order (official, manual and limit points).
export function readHistory(env = process.env, account) {
  let text = ''
  try {
    text = fs.readFileSync(historyFile(env), 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of text.split('\n')) {
    try {
      const s = JSON.parse(line)
      if (s && Number.isFinite(s.at) && (!account || s.account === account)) out.push(s)
    } catch {
      /* partial line */
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

// Append a snapshot unless the same point is already there. Returns true when added.
export function recordSnapshot(env, snap) {
  if (readHistory(env, snap.account).some((s) => s.at === snap.at && s.source === snap.source)) return false
  fs.mkdirSync(tgDir(env), { recursive: true })
  fs.appendFileSync(historyFile(env), `${JSON.stringify(snap)}\n`)
  return true
}

// A value read by hand in the app (/usage): a snapshot now. Reset times are
// taken from the latest snapshot of the account when they are still ahead.
export function manualSnapshot({ env = process.env, now = Date.now(), five = null, seven = null } = {}) {
  const { account } = officialUsage({ env })
  if (!account) return null
  const hist = readHistory(env, account)
  const lastReset = (k) => {
    const s = [...hist].reverse().find((x) => x[k])
    return s && s[k] > now ? s[k] : null
  }
  const snap = { at: now, account, five, seven, five_reset: five == null ? null : lastReset('five_reset'), seven_reset: seven == null ? null : lastReset('seven_reset'), source: 'manual' }
  recordSnapshot(env, snap)
  return snap
}

export function calibration(env, account) {
  if (!account) return null
  const c = readJson(calibFile(account, env))
  return c && c.account === account ? c : null
}

const sameReset = (a, b) => a != null && b != null && Math.abs(a - b) < 5 * 60e3

// Ratio r (% per weighted token) of one dimension from the history:
// the difference of the last two snapshots of the same window, or else the
// latest snapshot against the tokens since its window started.
function ratioFor(dim, snaps, usageFn) {
  const { span, reset } = DIMS[dim]
  const q = snaps.at(-1)
  const p = snaps.at(-2)
  if (p && q && sameReset(p[reset], q[reset]) && q[dim] - p[dim] >= 2) {
    const w = usageFn(p.at, q.at)
    if (w > 0) return { r: (q[dim] - p[dim]) / w, basis: 'pair', from: p.at, to: q.at, weighted: w, points: q[dim] - p[dim], sources: [p.source, q.source] }
  }
  if (q && q[reset] && q[dim] >= 1) {
    const from = q[reset] - span
    const w = usageFn(from, q.at)
    if (w > 0) return { r: q[dim] / w, basis: 'window', from, to: q.at, weighted: w, points: q[dim], sources: [q.source], approx: dim === 'seven' }
  }
  return null
}

// Calibration of the account, recomputed only when the latest snapshots change.
function calibrate(env, account, hist, usageFn, now) {
  const prev = calibration(env, account)
  const sig = ['five', 'seven'].map((d) => hist.filter((s) => s[d] != null).at(-1)?.at ?? '-').join('|')
  if (prev && prev.sig === sig) return prev
  const c = { account, sig, at: now }
  for (const d of ['five', 'seven']) c[d] = ratioFor(d, hist.filter((s) => s[d] != null), usageFn) || (prev && prev[d]) || null
  try {
    writeJsonAtomic(calibFile(account, env), c)
  } catch {
    /* calibration is recomputed next time */
  }
  return c
}

// Estimate of one dimension from its latest snapshot.
function estimateDim(dim, last, r, { now, freshMs, usageFn, officialOnly }) {
  if (!last) return null
  const { span, reset } = DIMS[dim]
  const out = { official: last[dim], at: last.at, source: last.source, reset: last[reset], basis: r ? r.basis : null, r: r ? r.r : null, delta: 0 }
  if (last[reset] && now >= last[reset]) {
    out.reset_passed = true
    if (officialOnly || !r) return { ...out, pct: 0 }
    const w = usageFn(Math.max(last[reset], now - span), now)
    return { ...out, delta: w * r.r, pct: w * r.r, weighted: w }
  }
  if (officialOnly || now - last.at <= freshMs || !r) return { ...out, pct: last[dim] }
  const w = usageFn(last.at, now)
  return { ...out, delta: w * r.r, pct: last[dim] + w * r.r, weighted: w }
}

// Usage percentage for the guard.
//   cfg: personal.token_guard ({ source: auto|official|local, fresh_min, budget, window_hours })
// Returns { util, source: official|estimate|local|none, five, seven, account, fresh, fetched_at, calib, ... }.
export function estimateUsage({ env = process.env, now = Date.now(), cfg = {} } = {}) {
  const mode = cfg.source || 'auto'
  const freshMs = (Number.isFinite(cfg.fresh_min) ? cfg.fresh_min : 10) * 60e3
  const memo = new Map()
  const scan = (from, to) => {
    const k = `${from}|${to}`
    if (!memo.has(k)) memo.set(k, windowUsage({ env, from, to }))
    return memo.get(k)
  }
  const usageFn = (from, to) => scan(from, to).weighted
  const off = mode === 'local' ? { account: null, snapshot: null, mismatch: false } : officialUsage({ env })
  const base = { account: off.account, mismatch: off.mismatch }
  if (off.snapshot) recordSnapshot(env, off.snapshot)
  let hist = off.account && mode !== 'local' && !off.mismatch ? readHistory(env, off.account) : []
  if (hist.length && mode !== 'official') {
    // a five-hour rejection after the latest five-hour point is a 100% point
    const last5 = hist.filter((s) => s.five != null).at(-1)
    if (last5) {
      const lim = scan(last5.at, now).limits.filter((l) => l.at > last5.at).at(-1)
      if (lim && recordSnapshot(env, { at: lim.at, account: off.account, five: 100, seven: null, five_reset: lim.reset, seven_reset: null, source: 'limit' })) hist = readHistory(env, off.account)
    }
  }
  if (hist.length) {
    const officialOnly = mode === 'official'
    const calib = officialOnly ? calibration(env, off.account) : calibrate(env, off.account, hist, usageFn, now)
    const opts = { now, freshMs, usageFn, officialOnly }
    const lastOf = (d) => hist.filter((s) => s[d] != null).at(-1)
    const five = estimateDim('five', lastOf('five'), calib && calib.five, opts)
    const seven = estimateDim('seven', lastOf('seven'), calib && calib.seven, opts)
    const latest = hist.at(-1)
    const fresh = now - latest.at <= freshMs
    const resetPassed = Boolean((five && five.reset_passed) || (seven && seven.reset_passed))
    const util = Math.floor(Math.max(five ? five.pct : 0, seven ? seven.pct : 0))
    return { ...base, util, source: officialOnly || (fresh && !resetPassed && latest.source === 'official') ? 'official' : 'estimate', five, seven, fresh, fetched_at: latest.at, latest_source: latest.source, calib }
  }
  // fallback: local tokens against the budget, or 100 / r of the account
  const calib = mode === 'local' ? null : calibration(env, off.account)
  const r5 = calib && calib.five && calib.five.r
  const budget = cfg.budget > 0 ? cfg.budget : r5 > 0 ? Math.round(100 / r5) : 0
  if (!(budget > 0)) return { ...base, util: null, source: 'none' }
  const hours = cfg.window_hours || 5
  const w = usageFn(now - hours * 3600e3, Infinity)
  return { ...base, util: percent(w, budget), source: 'local', budget, budget_from: cfg.budget > 0 ? 'budget' : 'calibration', weighted: w, hours, calib }
}

// Cached for 120 s: the hook runs on every tool call. While another hook is
// computing (lock held, less than 60 s old) the previous result is returned.
export function cachedEstimate({ env = process.env, now = Date.now(), cfg = {}, ttlMs = 120e3 } = {}) {
  const file = path.join(tgDir(env), 'estimate.json')
  const lock = path.join(tgDir(env), 'estimate.lock')
  const key = JSON.stringify([cfg.source || 'auto', cfg.fresh_min ?? 10, cfg.budget || 0, cfg.window_hours || 5])
  const c = readJson(file)
  if (c && now - c.at < ttlMs && now >= c.at && c.key === key) return c.estimate
  fs.mkdirSync(tgDir(env), { recursive: true })
  try {
    fs.mkdirSync(lock)
  } catch {
    let age = Infinity
    try {
      age = Date.now() - fs.statSync(lock).mtimeMs
    } catch {
      /* gone */
    }
    if (age < 60e3 && c && c.key === key) return c.estimate
    fs.rmSync(lock, { recursive: true, force: true })
    try {
      fs.mkdirSync(lock)
    } catch {
      /* another hook won the race */
    }
  }
  try {
    const estimate = estimateUsage({ env, now, cfg })
    try {
      writeJsonAtomic(file, { at: now, key, estimate })
    } catch {
      /* cache only */
    }
    return estimate
  } finally {
    fs.rmSync(lock, { recursive: true, force: true })
  }
}
