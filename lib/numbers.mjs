// Number reservation ledger: parallel lanes that each add a numbered file
// (migrations, decision records ...) take their number here so two lanes never
// pick the same one. A series is declared in .lanekeeper/config.json:
//   "numbers": { "<series>": { "dir": "db/migrations", "pattern": "^(\\d+)_", "width": 3, "start": 1 } }
// The next number is above every file in dir (in each given root) and above every
// live reservation. Reservations live in <stateDir>/numbers.json.
import fs from 'node:fs'
import path from 'node:path'
import { update, readJson } from './ledger.mjs'
import { LedgerError } from './waves.mjs'

export const numbersFile = (sd) => path.join(sd, 'numbers.json')
const EMPTY = { version: 1, series: {} }

export function seriesConfig(config, name) {
  const s = config?.project?.numbers?.[name]
  if (!s || !s.dir) throw new LedgerError('numbers.no_series', { series: name, known: Object.keys(config?.project?.numbers || {}).join(', ') || '-' })
  return { dir: s.dir, pattern: s.pattern || '^(\\d+)', width: s.width || 3, start: s.start ?? 1 }
}

// Numbers found as file names in dir, from every root. [{ n, file }]
export function scanSeries(cfg, roots) {
  const re = new RegExp(cfg.pattern)
  const found = []
  for (const root of roots) {
    let names = []
    try {
      names = fs.readdirSync(path.resolve(root, cfg.dir))
    } catch {}
    for (const f of names) {
      const m = re.exec(f)
      if (m && /^\d+$/.test(m[1])) found.push({ n: Number(m[1]), file: path.join(cfg.dir, f), root })
    }
  }
  return found
}

export const format = (cfg, n) => String(n).padStart(cfg.width, '0')

export function readNumbers(sd) {
  const d = readJson(numbersFile(sd), structuredClone(EMPTY))
  d.series = d.series || {}
  return d
}

export function reserve(sd, name, cfg, roots, { lane, note, count = 1 } = {}, now = Date.now()) {
  if (!(count >= 1 && count <= 50)) throw new LedgerError('numbers.bad_count', { count })
  return update(numbersFile(sd), EMPTY, (d) => {
    d.series = d.series || {}
    const list = (d.series[name] = d.series[name] || [])
    const filesMax = Math.max(cfg.start - 1, ...scanSeries(cfg, roots).map((f) => f.n))
    const resMax = Math.max(0, ...list.filter((r) => r.status !== 'released').map((r) => r.n))
    const out = []
    for (let i = 1; i <= count; i++) {
      const rec = { n: Math.max(filesMax, resMax) + i, lane: lane || null, at: new Date(now).toISOString(), status: 'reserved', ...(note ? { note } : {}) }
      list.push(rec)
      out.push(rec)
    }
    return out
  })
}

export function release(sd, name, n) {
  return update(numbersFile(sd), EMPTY, (d) => {
    const rec = (d.series?.[name] || []).find((r) => r.n === Number(n) && r.status === 'reserved')
    if (!rec) throw new LedgerError('numbers.not_reserved', { series: name, n })
    rec.status = 'released'
    return rec
  })
}

// Problems: two files with one number, a reserved number whose file now exists
// (marked used), a number reserved twice.
export function check(sd, name, cfg, roots) {
  const files = scanSeries(cfg, roots)
  const byNum = new Map()
  for (const f of files) {
    const key = f.n
    if (!byNum.has(key)) byNum.set(key, new Set())
    byNum.get(key).add(f.file)
  }
  const problems = []
  for (const [n, set] of byNum) if (set.size > 1) problems.push({ code: 'duplicate_file', vars: { n: format(cfg, n), files: [...set].join(', ') } })
  const list = readNumbers(sd).series[name] || []
  const live = list.filter((r) => r.status === 'reserved')
  const seen = new Map()
  for (const r of live) {
    if (seen.has(r.n)) problems.push({ code: 'duplicate_reservation', vars: { n: format(cfg, r.n), lanes: `${seen.get(r.n)}, ${r.lane || '-'}` } })
    seen.set(r.n, r.lane || '-')
  }
  const used = live.filter((r) => byNum.has(r.n))
  if (used.length) {
    update(numbersFile(sd), EMPTY, (d) => {
      for (const r of d.series[name] || []) if (r.status === 'reserved' && byNum.has(r.n)) r.status = 'used'
    })
  }
  return { problems, used: used.map((r) => r.n) }
}
