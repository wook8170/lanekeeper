// Token guard: usage of the recent window from the local session transcripts,
// converted to a percentage of a calibrated budget, and the stage reached.
import fs from 'node:fs'
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

// Weighted tokens of the last `hours` hours: input + 1.25 cache write +
// 0.1 cache read + 5 output (an approximation of the price ratio).
export function localUsage({ env = process.env, now = Date.now(), hours = 5 } = {}) {
  const cutMs = now - hours * 3600e3
  const u = { msgs: 0, output: 0, input: 0, cache_read: 0, cache_creation: 0 }
  for (const f of listTranscripts(path.join(claudeDir(env), 'projects'), cutMs - 3600e3)) {
    eachLineFromEnd(f, (line) => {
      let j
      try {
        j = JSON.parse(line)
      } catch {
        return true
      }
      const ts = Date.parse(j.timestamp)
      if (!Number.isFinite(ts)) return true
      if (ts < cutMs) return false
      const us = j.message?.usage
      if (!us) return true
      u.msgs++
      u.output += us.output_tokens || 0
      u.input += us.input_tokens || 0
      u.cache_read += us.cache_read_input_tokens || 0
      u.cache_creation += us.cache_creation_input_tokens || 0
      return true
    })
  }
  u.weighted = Math.floor(u.input + u.cache_creation * 1.25 + u.cache_read * 0.1 + u.output * 5)
  return u
}

// Cached for 120 s: the hook runs on every tool call.
export function cachedUsage({ env = process.env, now = Date.now(), hours = 5, ttlMs = 120e3 } = {}) {
  const file = path.join(dataDir(env), 'token-guard', 'usage.json')
  const c = readJson(file)
  if (c && now - c.at < ttlMs && c.hours === hours) return c.usage
  const usage = localUsage({ env, now, hours })
  try {
    writeJsonAtomic(file, { at: now, hours, usage })
  } catch {
    /* cache only */
  }
  return usage
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
