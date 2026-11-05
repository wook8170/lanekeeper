// Token guard v3: the official usage cache of Claude Code (~/.claude.json
// cachedUsageUtilization) first, with a local estimate for the time since it
// was fetched, window resets, account switches and the budget fallback.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, bin } from './l3-fixture.mjs'
import { officialUsage, windowUsage, estimateUsage, readHistory, recordSnapshot, manualSnapshot, calibration } from '../lib/token.mjs'
import { handle as tokenCheck } from '../hooks/scripts/token-guard/check.mjs'

const H = 3600e3
const NOW = Math.floor(Date.now() / 1000) * 1000
const ACC_A = '3ac33412-e0bd-484b-b198-9d4927441107'
const ACC_B = '99999999-0000-0000-0000-00000000beef'

function writeTranscript(f, name, rows) {
  const dir = path.join(f.env.CLAUDE_CONFIG_DIR, 'projects', 'p1')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}
// output tokens only: weighted = 5 x output
const out = (ts, output) => ({ timestamp: new Date(ts).toISOString(), message: { usage: { output_tokens: output } } })
const rejected = (ts, resetMs) => ({ timestamp: new Date(ts).toISOString(), isApiErrorMessage: true, apiErrorParams: { rate_limit_info: { status: 'rejected', resetsAt: Math.floor(resetMs / 1000), rateLimitType: 'five_hour' } } })

// ~/.claude.json with the official cache; the oauth account decides which account is active.
function writeClaudeJson(f, { fetchedAt, account = ACC_A, active = account, five, seven, fiveReset, sevenReset, secret = 'sk-never-read' }) {
  const j = {
    oauthAccount: { accountUuid: active, emailAddress: 'x@example.com' },
    primaryApiKey: secret,
    cachedUsageUtilization: fetchedAt == null ? undefined : {
      fetchedAtMs: fetchedAt,
      accountUuid: account,
      utilization: {
        five_hour: { utilization: five, resets_at: new Date(fiveReset).toISOString() },
        seven_day: { utilization: seven, resets_at: new Date(sevenReset).toISOString() },
      },
    },
  }
  fs.mkdirSync(f.env.CLAUDE_CONFIG_DIR, { recursive: true })
  fs.writeFileSync(path.join(f.env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify(j))
}

test('officialUsage: reads the cache of the active account only, never other fields', () => {
  const f = makeEnv()
  try {
    assert.equal(officialUsage({ env: f.env }).snapshot, null, 'no file')
    writeClaudeJson(f, { fetchedAt: NOW - H, five: 11, seven: 54, fiveReset: NOW + 2 * H, sevenReset: NOW + 100 * H })
    const o = officialUsage({ env: f.env })
    assert.equal(o.account, ACC_A)
    assert.deepEqual(o.snapshot, { at: NOW - H, account: ACC_A, five: 11, seven: 54, five_reset: NOW + 2 * H, seven_reset: NOW + 100 * H, source: 'official' })
    assert.ok(!JSON.stringify(o).includes('sk-never-read'))
    // account switched: the cache belongs to the old account
    writeClaudeJson(f, { fetchedAt: NOW - H, account: ACC_A, active: ACC_B, five: 11, seven: 54, fiveReset: NOW + 2 * H, sevenReset: NOW + 100 * H })
    const m = officialUsage({ env: f.env })
    assert.equal(m.snapshot, null)
    assert.equal(m.mismatch, true)
    assert.equal(m.account, ACC_B)
    // explicit path
    const other = path.join(f.base, 'c.json')
    fs.copyFileSync(path.join(f.env.CLAUDE_CONFIG_DIR, '.claude.json'), other)
    assert.equal(officialUsage({ env: { ...f.env, LANEKEEPER_CLAUDE_JSON: other } }).account, ACC_B)
    assert.equal(officialUsage({ env: { ...f.env, LANEKEEPER_CLAUDE_JSON: path.join(f.base, 'missing.json') } }).snapshot, null)
  } finally {
    f.cleanup()
  }
})

test('windowUsage: sums [from, to) and collects five-hour rejections', () => {
  const f = makeEnv()
  try {
    writeTranscript(f, 'a.jsonl', [out(NOW - 4 * H, 10), out(NOW - 2 * H, 20), rejected(NOW - 90 * 60e3, NOW + H), out(NOW - H, 40), out(NOW - 60e3, 80)])
    const u = windowUsage({ env: f.env, from: NOW - 3 * H, to: NOW - 30 * 60e3 })
    assert.equal(u.weighted, 5 * 60)
    assert.deepEqual(u.limits, [{ at: NOW - 90 * 60e3, reset: NOW + H }])
  } finally {
    f.cleanup()
  }
})

test('estimate: a fresh official value is used as is; the higher of five-hour and seven-day decides', () => {
  const f = makeEnv()
  try {
    writeClaudeJson(f, { fetchedAt: NOW - 5 * 60e3, five: 11, seven: 54, fiveReset: NOW + 2 * H, sevenReset: NOW + 100 * H })
    writeTranscript(f, 'a.jsonl', [out(NOW - 2 * H, 100), out(NOW - 60e3, 1000)])
    const e = estimateUsage({ env: f.env, now: NOW, cfg: {} })
    assert.equal(e.source, 'official')
    assert.equal(e.fresh, true)
    assert.equal(e.five.pct, 11)
    assert.equal(e.seven.pct, 54)
    assert.equal(e.util, 54)
  } finally {
    f.cleanup()
  }
})

test('estimate: a stale value adds the local tokens since, scaled by the window-start ratio', () => {
  const f = makeEnv()
  try {
    // five-hour window started at NOW-3h (reset NOW+2h). 10% at NOW-1h with 1000 weighted since the window start.
    writeClaudeJson(f, { fetchedAt: NOW - H, five: 10, seven: 0, fiveReset: NOW + 2 * H, sevenReset: NOW + 100 * H })
    writeTranscript(f, 'a.jsonl', [out(NOW - 4 * H, 999), out(NOW - 2 * H, 200), out(NOW - 30 * 60e3, 100)])
    const e = estimateUsage({ env: f.env, now: NOW, cfg: {} })
    assert.equal(e.source, 'estimate')
    assert.equal(e.five.basis, 'window')
    assert.equal(e.five.official, 10)
    assert.ok(Math.abs(e.five.pct - 15) < 1e-9, String(e.five.pct)) // 10 + 500 x (10 / 1000)
    assert.equal(e.util, 15)
    const c = JSON.parse(fs.readFileSync(path.join(f.env.CLAUDE_PLUGIN_DATA, 'token-guard', `calib-${ACC_A}.json`), 'utf8'))
    assert.equal(c.account, ACC_A)
    assert.ok(Math.abs(c.five.r - 0.01) < 1e-12)
    assert.equal(readHistory(f.env, ACC_A).length, 1, 'snapshot recorded once')
    estimateUsage({ env: f.env, now: NOW, cfg: {} })
    assert.equal(readHistory(f.env, ACC_A).length, 1, 'not recorded twice')
  } finally {
    f.cleanup()
  }
})

test('estimate: two snapshots in the same window calibrate from their difference (manual point included)', () => {
  const f = makeEnv()
  try {
    writeClaudeJson(f, { fetchedAt: NOW - 3 * H, five: 10, seven: 50, fiveReset: NOW + H, sevenReset: NOW + 100 * H })
    writeTranscript(f, 'a.jsonl', [out(NOW - 3.5 * H, 100), out(NOW - 2 * H, 200), out(NOW - 30 * 60e3, 40)])
    estimateUsage({ env: f.env, now: NOW - H, cfg: {} })
    // the owner reads 30% / 60% in the app one hour ago: 20 points and 10 points for 1000 weighted
    manualSnapshot({ env: f.env, now: NOW - H, five: 30, seven: 60 })
    const e = estimateUsage({ env: f.env, now: NOW, cfg: {} })
    assert.equal(e.five.basis, 'pair')
    assert.equal(e.seven.basis, 'pair')
    assert.ok(Math.abs(e.five.pct - 34) < 1e-9, String(e.five.pct)) // 30 + 200 x 0.02
    assert.ok(Math.abs(e.seven.pct - 62) < 1e-9, String(e.seven.pct)) // 60 + 200 x 0.01
    assert.equal(e.util, 62)
    assert.equal(readHistory(f.env, ACC_A).at(-1).source, 'manual')
    assert.equal(readHistory(f.env, ACC_A).at(-1).five_reset, NOW + H, 'manual point keeps the known reset')
  } finally {
    f.cleanup()
  }
})

test('estimate: after the reset the official percentage is ignored and only tokens since the reset count', () => {
  const f = makeEnv()
  try {
    writeClaudeJson(f, { fetchedAt: NOW - 3 * H, five: 80, seven: 10, fiveReset: NOW - H, sevenReset: NOW + 100 * H })
    writeTranscript(f, 'a.jsonl', [out(NOW - 5 * H, 160), out(NOW - 30 * 60e3, 20)])
    const e = estimateUsage({ env: f.env, now: NOW, cfg: {} })
    assert.equal(e.five.reset_passed, true)
    // r = 80 / 800 = 0.1 per weighted token; 100 weighted since the reset = 10%
    assert.ok(Math.abs(e.five.pct - 10) < 1e-9, String(e.five.pct))
  } finally {
    f.cleanup()
  }
})

test('estimate: an account switch drops the old calibration; a stale cache of the old account is not used', () => {
  const f = makeEnv()
  try {
    writeClaudeJson(f, { fetchedAt: NOW - 2 * H, five: 10, seven: 10, fiveReset: NOW + 2 * H, sevenReset: NOW + 100 * H })
    writeTranscript(f, 'a.jsonl', [out(NOW - 2.5 * H, 100)])
    estimateUsage({ env: f.env, now: NOW, cfg: {} })
    assert.ok(calibration(f.env, ACC_A))
    // switch to B: the cache still holds A
    writeClaudeJson(f, { fetchedAt: NOW - 2 * H, account: ACC_A, active: ACC_B, five: 10, seven: 10, fiveReset: NOW + 2 * H, sevenReset: NOW + 100 * H })
    const e = estimateUsage({ env: f.env, now: NOW, cfg: {} })
    assert.equal(e.account, ACC_B)
    assert.equal(e.mismatch, true)
    assert.equal(e.source, 'none', 'no budget: silent')
    assert.equal(calibration(f.env, ACC_B), null)
    // B's own cache arrives
    writeClaudeJson(f, { fetchedAt: NOW - 60e3, account: ACC_B, five: 3, seven: 7, fiveReset: NOW + 4 * H, sevenReset: NOW + 150 * H })
    const b = estimateUsage({ env: f.env, now: NOW, cfg: {} })
    assert.equal(b.account, ACC_B)
    assert.equal(b.util, 7)
    assert.equal(readHistory(f.env, ACC_B).length, 1)
  } finally {
    f.cleanup()
  }
})

test('estimate: without a cache it falls back to the budget, converted from the calibration when there is no budget', () => {
  const f = makeEnv()
  try {
    writeTranscript(f, 'a.jsonl', [out(NOW - H, 40)]) // 200 weighted
    assert.equal(estimateUsage({ env: f.env, now: NOW, cfg: {} }).source, 'none')
    const b = estimateUsage({ env: f.env, now: NOW, cfg: { budget: 400 } })
    assert.equal(b.source, 'local')
    assert.equal(b.util, 50)
    // a calibration of the active account turns into a budget: 100% = 1 / r
    writeClaudeJson(f, { fetchedAt: null, active: ACC_A })
    fs.mkdirSync(path.join(f.env.CLAUDE_PLUGIN_DATA, 'token-guard'), { recursive: true })
    fs.writeFileSync(path.join(f.env.CLAUDE_PLUGIN_DATA, 'token-guard', `calib-${ACC_A}.json`), JSON.stringify({ account: ACC_A, five: { r: 0.1, basis: 'window' }, seven: null }))
    const c = estimateUsage({ env: f.env, now: NOW, cfg: {} })
    assert.equal(c.source, 'local')
    assert.equal(c.budget, 1000)
    assert.equal(c.util, 20)
  } finally {
    f.cleanup()
  }
})

test('estimate: source=official skips the local estimate, source=local uses the budget only', () => {
  const f = makeEnv()
  try {
    writeClaudeJson(f, { fetchedAt: NOW - H, five: 10, seven: 20, fiveReset: NOW + 2 * H, sevenReset: NOW + 100 * H })
    writeTranscript(f, 'a.jsonl', [out(NOW - 2 * H, 200), out(NOW - 30 * 60e3, 2000)])
    const o = estimateUsage({ env: f.env, now: NOW, cfg: { source: 'official' } })
    assert.deepEqual([o.source, o.five.pct, o.seven.pct, o.util], ['official', 10, 20, 20])
    const l = estimateUsage({ env: f.env, now: NOW, cfg: { source: 'local', budget: 22000 } })
    assert.deepEqual([l.source, l.util], ['local', 50])
    // fresh_min widens what counts as fresh
    assert.equal(estimateUsage({ env: f.env, now: NOW, cfg: { fresh_min: 90 } }).source, 'official')
  } finally {
    f.cleanup()
  }
})

test('estimate: a five-hour rejection after the snapshot is a 100% point', () => {
  const f = makeEnv()
  try {
    writeClaudeJson(f, { fetchedAt: NOW - 2 * H, five: 40, seven: 10, fiveReset: NOW + H, sevenReset: NOW + 100 * H })
    writeTranscript(f, 'a.jsonl', [out(NOW - 3 * H, 100), out(NOW - 1.5 * H, 300), rejected(NOW - H, NOW + H)])
    const e = estimateUsage({ env: f.env, now: NOW, cfg: {} })
    assert.ok(e.five.pct >= 100, String(e.five.pct))
    assert.equal(e.five.basis, 'pair')
    assert.equal(readHistory(f.env, ACC_A).at(-1).source, 'limit')
    assert.equal(e.util, 100)
  } finally {
    f.cleanup()
  }
})

test('recordSnapshot keeps one line per point', () => {
  const f = makeEnv()
  try {
    const s = { at: 1, account: ACC_A, five: 1, seven: 2, five_reset: 3, seven_reset: 4, source: 'official' }
    assert.equal(recordSnapshot(f.env, s), true)
    assert.equal(recordSnapshot(f.env, s), false)
    assert.equal(readHistory(f.env, ACC_A).length, 1)
    assert.equal(readHistory(f.env, ACC_B).length, 0)
  } finally {
    f.cleanup()
  }
})

test('token guard hook speaks from the official cache without a budget', () => {
  const f = makeEnv()
  try {
    writeClaudeJson(f, { fetchedAt: Date.now() - 60e3, five: 91, seven: 40, fiveReset: Date.now() + H, sevenReset: Date.now() + 100 * H })
    const r = tokenCheck({ session_id: 'o', cwd: f.repo, hook_event_name: 'PostToolUse' }, f.env)
    assert.match(r.hookSpecificOutput.additionalContext, /91%/)
    assert.match(r.hookSpecificOutput.additionalContext, /official/i)
  } finally {
    f.cleanup()
  }
})

test('lanekeeper-token: status shows the official value, the estimate and the calibration; calibrate --five/--seven adds a manual point; --check lists pairs', () => {
  const f = makeEnv()
  try {
    const now = Date.now()
    writeClaudeJson(f, { fetchedAt: now - H, five: 11, seven: 54, fiveReset: now + 2 * H, sevenReset: now + 100 * H })
    writeTranscript(f, 'a.jsonl', [out(now - 2.5 * H, 1000), out(now - 30 * 60e3, 1000)])
    let r = bin('lanekeeper-token', ['status'], f.env, f.repo)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /Official/)
    assert.match(r.stdout, /11%/)
    assert.match(r.stdout, /Estimate/)
    assert.match(r.stdout, /27441107/, 'last 8 characters of the account')
    r = bin('lanekeeper-token', ['calibrate', '--five', '60', '--seven', '67'], f.env, f.repo)
    assert.equal(r.status, 0, r.stderr)
    const h = readHistory(f.env, ACC_A)
    assert.deepEqual([h.at(-1).source, h.at(-1).five, h.at(-1).seven], ['manual', 60, 67])
    r = bin('lanekeeper-token', ['calibrate', '--check'], f.env, f.repo)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /official .* manual/)
    assert.equal(bin('lanekeeper-token', ['calibrate', '--five', '150'], f.env, f.repo).status, 1)
    assert.equal(bin('lanekeeper-token', ['calibrate', '--five', '20', '--at', 'soon'], f.env, f.repo).status, 1)
    const d = new Date(now - 2 * 60e3)
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    r = bin('lanekeeper-token', ['calibrate', '--five=20', '--at', hm], f.env, f.repo)
    assert.equal(r.status, 0, r.stderr)
    const m = readHistory(f.env, ACC_A).find((s) => s.five === 20)
    assert.ok(m && Math.abs(m.at - (now - 2 * 60e3)) < 60e3, '--at sets the time of the point')
    assert.equal(m.seven, null)
  } finally {
    f.cleanup()
  }
})

test('cachedEstimate: reuses a fresh result, and returns the previous one while another hook holds the lock', async () => {
  const { cachedEstimate } = await import('../lib/token.mjs')
  const f = makeEnv()
  try {
    writeClaudeJson(f, { fetchedAt: NOW - 60e3, five: 20, seven: 30, fiveReset: NOW + H, sevenReset: NOW + 100 * H })
    assert.equal(cachedEstimate({ env: f.env, now: NOW }).util, 30)
    writeClaudeJson(f, { fetchedAt: NOW - 30e3, five: 40, seven: 50, fiveReset: NOW + H, sevenReset: NOW + 100 * H })
    assert.equal(cachedEstimate({ env: f.env, now: NOW + 1000 }).util, 30, 'within 120 s')
    const lock = path.join(f.env.CLAUDE_PLUGIN_DATA, 'token-guard', 'estimate.lock')
    fs.mkdirSync(lock)
    assert.equal(cachedEstimate({ env: f.env, now: Date.now() + 200e3 }).util, 30, 'lock held: previous result')
    fs.utimesSync(lock, new Date(Date.now() - 120e3), new Date(Date.now() - 120e3))
    assert.equal(cachedEstimate({ env: f.env, now: Date.now() + 200e3 }).util, 50, 'stale lock: recomputed')
    assert.ok(!fs.existsSync(lock), 'lock released')
  } finally {
    f.cleanup()
  }
})
