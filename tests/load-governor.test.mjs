// Load governor: tiers (auto and numbers), dispatch hold for new lanes, verifier
// heavy runs refused first, orphan detection on fake ps output (never real
// processes), and the periodic check on UserPromptSubmit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, makeEnv, runScript } from './l3-fixture.mjs'
import { resolveConfig, resolveTiers } from '../lib/config.mjs'
import * as L from '../lib/load.mjs'
import { evaluate } from '../hooks/scripts/dispatch/dispatch-guard.mjs'
import { judgeSlots } from '../hooks/scripts/slots/slot-guard.mjs'
import { handle as checkHook } from '../hooks/scripts/load/check.mjs'

const TIERS = { hold_new_lanes: 20, stop_heavy: 28 }

function setup(load = {}) {
  const fx = makeEnv()
  fs.writeFileSync(path.join(fx.env.WB_HOME, 'machine.json'), JSON.stringify({ version: 1, load: { tiers: TIERS, ...load }, slots: { lease_dir: path.join(fx.base, 'slots') } }))
  const sd = path.join(fx.repo, '.git', 'wb')
  fs.mkdirSync(sd, { recursive: true })
  const lanes = (list) => fs.writeFileSync(path.join(sd, 'lanes.json'), JSON.stringify({ lanes: list }))
  return { fx, sd, lanes }
}

// ---- tiers ----------------------------------------------------------------

test('tiers: auto follows the logical core count (x2 hold, x2.8 stop, rounded)', () => {
  assert.deepEqual(resolveTiers({}, 10), { hold_new_lanes: 20, stop_heavy: 28 })
  assert.deepEqual(resolveTiers({ machine: { load: { tiers: { hold_new_lanes: 'auto', stop_heavy: 'auto' } } } }, 7), { hold_new_lanes: 14, stop_heavy: 20 })
  assert.deepEqual(resolveTiers({}, 1), { hold_new_lanes: 2, stop_heavy: 3 })
})

test('tiers: numbers are taken as they are, a mix with auto works, stop is never below hold', () => {
  assert.deepEqual(resolveTiers({ machine: { load: { tiers: { hold_new_lanes: 15, stop_heavy: 25.5 } } } }, 10), { hold_new_lanes: 15, stop_heavy: 25.5 })
  assert.deepEqual(resolveTiers({ machine: { load: { tiers: { hold_new_lanes: 12 } } } }, 10), { hold_new_lanes: 12, stop_heavy: 28 })
  assert.deepEqual(resolveTiers({ machine: { load: { tiers: { hold_new_lanes: 30, stop_heavy: 10 } } } }, 10), { hold_new_lanes: 30, stop_heavy: 30 })
})

test('tiers: settings accept auto or a number, reject anything else, and reach effective values', () => {
  const { fx } = setup({ check_every_min: 0 })
  const r = resolveConfig({ projectDir: fx.repo, env: fx.env })
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.effective.load_tiers, TIERS)
  assert.equal(L.loadSettings(r).checkEveryMin, 0)
  fs.writeFileSync(path.join(fx.env.WB_HOME, 'machine.json'), JSON.stringify({ version: 1, load: { tiers: { hold_new_lanes: 'high' }, check_every_min: -1 } }))
  const bad = resolveConfig({ projectDir: fx.repo, env: fx.env })
  const paths = bad.errors.map((e) => e.path)
  assert.ok(paths.includes('machine.load.tiers.hold_new_lanes'), paths.join(','))
  assert.ok(paths.includes('machine.load.check_every_min'), paths.join(','))
})

test('tiers: boundaries are inclusive (load equal to a threshold is in that tier)', () => {
  assert.equal(L.tierOf(19.99, TIERS), 'ok')
  assert.equal(L.tierOf(20, TIERS), 'hold')
  assert.equal(L.tierOf(27.99, TIERS), 'hold')
  assert.equal(L.tierOf(28, TIERS), 'stop')
  assert.equal(L.tierOf(NaN, TIERS), 'ok')
})

test('readLoad: WB_LOAD_FAKE replaces the load average; otherwise the sample index is used', () => {
  assert.equal(L.readLoad('1min', { WB_LOAD_FAKE: '23.5' }), 23.5)
  assert.equal(L.readLoad('5min', {}, () => [1, 2, 3]), 2)
  assert.equal(L.readLoad('1min', { WB_LOAD_FAKE: 'x' }, () => [4, 5, 6]), 4)
})

// ---- dispatch guard ---------------------------------------------------------

const BRIEF = (lane) => `<!-- wb-brief v1 type=impl-multi lane=${lane} -->\nwork`
const dispatchAt = (s, load, lane = 'n1') =>
  evaluate({ tool_name: 'Agent', tool_input: { prompt: BRIEF(lane), model: 'opus' }, cwd: s.fx.repo }, s.fx.env, { stateDir: s.sd, loadavg: () => load })
const codes = (r) => r.verdicts.map((v) => v.code)

test('dispatch guard: a new lane is denied at or above hold_new_lanes, allowed just below', () => {
  const s = setup()
  s.lanes([])
  const at = dispatchAt(s, 20)
  assert.ok(codes(at).includes('load_hold'))
  const v = at.verdicts.find((x) => x.code === 'load_hold')
  assert.equal(v.level, 'deny')
  assert.deepEqual(v.vars, { load: '20.00', hold: 20, stop: 28 })
  assert.ok(!codes(dispatchAt(s, 19.99)).includes('load_hold'))
})

test('dispatch guard: a dispatch to a lane already in lanes.json is not held, even at a high load', () => {
  const s = setup()
  s.lanes([{ id: 'l1', branch: 'b', worktree: s.fx.repo }])
  assert.ok(!codes(dispatchAt(s, 50, 'l1')).includes('load_hold'))
  assert.ok(codes(dispatchAt(s, 50, 'l2')).includes('load_hold'))
})

test('dispatch guard hook: the deny message names the load, the threshold and what to do (WB_LOAD_FAKE)', () => {
  const s = setup()
  s.lanes([])
  const r = runScript('hooks/scripts/dispatch/dispatch-guard.mjs', { tool_name: 'Agent', tool_input: { prompt: BRIEF('n9'), model: 'opus' }, cwd: s.fx.repo }, { ...s.fx.env, WB_LOAD_FAKE: '25' })
  const out = r.out
  assert.ok(out, r.err)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  const text = out.hookSpecificOutput.permissionDecisionReason
  assert.match(text, /25\.00/)
  assert.match(text, /hold-new-lanes threshold 20/)
  assert.match(text, /wb-slot check/)
})

// ---- slot guard -----------------------------------------------------------

const judge = (s, command, load, extra = {}) => judgeSlots({ tool_name: 'Bash', tool_input: { command }, cwd: s.fx.repo }, { ...s.fx.env, WB_LOAD_FAKE: String(load), ...extra })

test('slot guard: a verifier lane heavy run is denied at stop_heavy, executors keep the normal note', () => {
  const s = setup()
  s.lanes([{ id: 'v1', branch: 'b', worktree: s.fx.repo, role: 'verifier' }])
  const r = judge(s, 'npm test', 28)
  assert.equal(r.mode, 'deny')
  assert.equal(r.code, 'slot.load_stop_heavy')
  assert.equal(r.vars.lane, 'v1')
  assert.equal(judge(s, 'npm test', 27.99).code, 'slot.unwrapped')
  s.lanes([{ id: 'e1', branch: 'b', worktree: s.fx.repo, role: 'executor' }])
  assert.equal(judge(s, 'npm test', 40).code, 'slot.unwrapped')
})

test('slot guard: a wrapped heavy run of a verifier is denied too; light and status commands pass', () => {
  const s = setup()
  s.lanes([{ id: 'v1', branch: 'b', worktree: s.fx.repo, role: 'verifier' }])
  assert.equal(judge(s, 'wb-slot --kind heavy -- npm test', 30).code, 'slot.load_stop_heavy')
  assert.equal(judge(s, 'wb-slot status', 30), null)
  assert.equal(judge(s, 'ls -la', 30), null)
  assert.equal(judge(s, 'wb-slot --kind heavy -- npm test', 10), null)
})

test('slot guard: without a role in lanes.json the brief marker or a role line decides; neither = executor', () => {
  const s = setup()
  s.lanes([{ id: 'r1', branch: 'b', worktree: s.fx.repo }])
  const brief = path.join(s.fx.base, 'r1.md')
  fs.writeFileSync(path.join(s.sd, 'waves.json'), JSON.stringify({ version: 1, waves: [{ id: 'w1', lanes: [{ lane: 'r1', brief }] }] }))
  fs.writeFileSync(brief, '<!-- wb-brief v1 type=review lane=r1 role=verifier -->\n# goal\n')
  assert.equal(judge(s, 'npm test', 30).code, 'slot.load_stop_heavy')
  fs.writeFileSync(brief, '<!-- wb-brief v1 type=review lane=r1 -->\n역할: 검수자\n')
  assert.equal(judge(s, 'npm test', 30).code, 'slot.load_stop_heavy')
  fs.writeFileSync(brief, '<!-- wb-brief v1 type=impl-multi lane=r1 -->\n# goal\n')
  assert.equal(judge(s, 'npm test', 30).code, 'slot.unwrapped')
  assert.deepEqual(L.laneRole(s.sd, null), { role: 'executor', source: 'none' })
})

test('roleFromBrief: marker attribute wins, then the first role line', () => {
  assert.equal(L.roleFromBrief('<!-- wb-brief v1 type=x role=executor -->\nrole: verifier'), 'executor')
  assert.equal(L.roleFromBrief('# t\n- **Role**: verifier\n'), 'verifier')
  assert.equal(L.roleFromBrief('역할: 실행'), 'executor')
  assert.equal(L.roleFromBrief('nothing here'), null)
})

test('wb-slot: a verifier lane is refused at once with exit 75 at stop_heavy; slots already held stay', () => {
  const s = setup()
  s.lanes([{ id: 'v1', branch: 'b', worktree: s.fx.repo, role: 'verifier' }])
  const slotDir = path.join(s.fx.base, 'slots', 'heavy', 'slot1')
  fs.mkdirSync(slotDir, { recursive: true })
  const owner = { version: 1, kind: 'heavy', slot: 1, pid: process.pid, started: new Date().toISOString(), renewed: new Date().toISOString() }
  fs.writeFileSync(path.join(slotDir, 'owner.json'), JSON.stringify(owner))
  const run = (load, lane) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'wb-slot'), '--lane', lane, '--timeout', '0', '--', 'true'], { cwd: s.fx.repo, env: { ...s.fx.env, WB_LOAD_FAKE: String(load) }, encoding: 'utf8' })
  const r = run(30, 'v1')
  assert.equal(r.status, 75)
  assert.match(r.stderr, /stop-heavy threshold 28/)
  assert.ok(fs.existsSync(path.join(slotDir, 'owner.json')), 'held slot untouched')
  const e = run(5, 'v1')
  assert.equal(e.status, 0, e.stderr)
})

// ---- orphans ----------------------------------------------------------------

const PS = [
  '  1     0 /sbin/launchd',
  '100     1 node /wt/wt-gone/node_modules/.bin/vite --port 41000',
  '101     1 /wt/wt-live/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.21.5 --ping',
  '102     1 node /wt/wt-stray/node_modules/tsx/dist/cli.mjs watch src/index.ts',
  '103     1 node /wt/wt-gone/node_modules/vitest/vitest.mjs run',
  '104     1 node /wt/wt-gone/node_modules/.bin/vite',
  '105     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --user-data-dir=/wt/wt-gone/profile',
  '106     1 node /repo/main/node_modules/.bin/vite',
  '107     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new',
  '108     1 node /srv/app/server.js',
  '109     1 node /usr/local/bin/vite',
  '200   104 node /plugin/bin/wb-slot check',
].join('\n')

function fakeDeps(over = {}) {
  const killed = []
  const existing = new Set(['/wt/wt-live', '/wt/wt-stray', '/repo/main', '/srv/app', '/usr/local/bin'])
  return {
    killed,
    ps: () => PS,
    cwdOf: () => new Map([[109, '/wt/old-gone-dir'], [108, '/srv/app']]),
    listeners: () => new Map([[103, [5180]], [106, [6100]]]),
    exists: (p) => existing.has(p),
    kill: (pid, sig) => killed.push([pid, sig]),
    selfPid: 200,
    ...over,
  }
}
const OPTS = { lanes: [{ id: 'live', worktree: '/wt/wt-live' }], areas: ['/wt/wt-'], protectedPorts: new Map([[5180, 'api']]) }

test('orphans: deleted and unregistered lane folders are found; registered lanes, the owner checkout and plain node are not', () => {
  const r = L.findOrphans(OPTS, fakeDeps())
  const by = Object.fromEntries(r.candidates.map((c) => [c.pid, c]))
  assert.deepEqual(Object.keys(by).map(Number).sort((a, b) => a - b), [100, 102, 105, 109])
  assert.deepEqual([by[100].reason, by[100].path], ['deleted', '/wt/wt-gone'])
  assert.deepEqual([by[102].reason, by[102].path], ['unregistered', '/wt/wt-stray'])
  assert.equal(by[105].reason, 'deleted', 'path after --opt= counts')
  assert.deepEqual([by[109].reason, by[109].path], ['deleted', '/wt/old-gone-dir'], 'a gone working folder counts')
  for (const pid of [101, 106, 107, 108]) assert.ok(!by[pid], `pid ${pid} is not an orphan`)
})

test('orphans: processes on protected ports and this session are excluded with the reason', () => {
  const r = L.findOrphans(OPTS, fakeDeps())
  const ex = Object.fromEntries(r.excluded.map((c) => [c.pid, c]))
  assert.equal(ex[103].reason, 'protected_port')
  assert.equal(ex[103].detail, '5180 api')
  assert.equal(ex[104].reason, 'self')
  assert.equal(ex[104].detail, 'deleted')
  assert.ok(!r.candidates.some((c) => c.pid === 103 || c.pid === 104))
})

test('orphans: kill stops exactly the listed PIDs with SIGTERM and skips a PID whose command changed', () => {
  const deps = fakeDeps()
  const { candidates } = L.findOrphans(OPTS, deps)
  const changed = { ...deps, ps: () => PS.replace('node /wt/wt-stray/node_modules/tsx/dist/cli.mjs watch src/index.ts', 'bash') }
  const out = L.killOrphans(candidates, changed)
  assert.deepEqual(deps.killed, [[100, 'SIGTERM'], [105, 'SIGTERM'], [109, 'SIGTERM']])
  assert.deepEqual(out.find((o) => o.pid === 102), { pid: 102, result: 'gone' })
})

test('orphans: laneAreas follows project.git.worktree_root; protected ports include servers[] refs', () => {
  assert.deepEqual(L.laneAreas({ project: { git: { worktree_root: '{repo}/../wt-{task}' } } }, '/x/repo'), ['/x/repo/.claude/worktrees/', '/x/wt-'])
  assert.deepEqual(L.laneAreas({ project: { git: { worktree_root: '/lanes/{task}' } } }, '/x/repo'), ['/x/repo/.claude/worktrees/', '/lanes/'])
  const set = L.protectedPortSet({ machine: { ports: { protected: [{ name: 'api', port: 5180 }, { name: 'bad', port: 0 }] }, servers: [{ name: 'owner-api', port_ref: 'api' }] } })
  assert.deepEqual([...set], [[5180, 'owner-api']])
})

test('orphans: parsePs and commandPaths', () => {
  assert.deepEqual(L.parsePs('  12  1 node a b\n\nbad line\n'), [{ pid: 12, ppid: 1, command: 'node a b' }])
  assert.deepEqual(L.commandPaths("node /a/b --x=/c/d '/e f'"), ['/a/b', '/c/d', '/e'])
  assert.ok(L.ORPHAN_RE.test('node /x/node_modules/.bin/vite'))
  assert.ok(L.ORPHAN_RE.test('node /x/node_modules/vitest/vitest.mjs'))
  assert.ok(!L.ORPHAN_RE.test('node /x/server.js'))
  assert.ok(!L.ORPHAN_RE.test('/usr/bin/invited --flag'))
})

test('wb-slot reap --orphans and check run with the real ps read-only (no --kill)', () => {
  const s = setup()
  const env = { ...s.fx.env, WB_LOAD_FAKE: '21' }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'wb-slot'), 'reap', '--orphans', '--json'], { cwd: s.fx.repo, env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const j = JSON.parse(r.stdout)
  assert.equal(j.dryRun, true)
  assert.deepEqual(j.killed, [])
  const c = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'wb-slot'), 'check', '--json'], { cwd: s.fx.repo, env, encoding: 'utf8' })
  assert.equal(c.status, 0, c.stderr)
  const k = JSON.parse(c.stdout)
  assert.equal(k.tier, 'hold')
  assert.deepEqual(k.tiers, TIERS)
  assert.ok(Array.isArray(k.orphans.candidates))
  const text = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'wb-slot'), 'check'], { cwd: s.fx.repo, env, encoding: 'utf8' })
  assert.match(text.stdout, /tier: new lanes held/)
})

// ---- periodic check -----------------------------------------------------------

test('check interval: due at first, not before the interval, due after it, never when 0', () => {
  const now = 10_000_000
  assert.equal(L.dueForCheck(null, now, 30), true)
  assert.equal(L.dueForCheck({ last: now - 29 * 60_000 }, now, 30), false)
  assert.equal(L.dueForCheck({ last: now - 30 * 60_000 }, now, 30), true)
  assert.equal(L.dueForCheck(null, now, 0), false)
})

test('check hook: silent below the tiers, one line above, then quiet until the interval passes', () => {
  const s = setup()
  const input = { hook_event_name: 'UserPromptSubmit', cwd: s.fx.repo }
  let now = 1_000_000_000
  const at = (load) => checkHook(input, s.fx.env, { now: () => now, loadavg: () => load })
  assert.equal(at(5), null, 'normal load: silent')
  now += 31 * 60_000
  const out = at(22)
  assert.match(out.hookSpecificOutput.additionalContext, /^\[wb\] .*22\.00.*hold-new-lanes threshold 20/)
  now += 10 * 60_000
  assert.equal(at(40), null, 'within the interval: silent')
  now += 30 * 60_000
  assert.match(at(29).hookSpecificOutput.additionalContext, /stop-heavy threshold 28/)
})

test('check hook: check_every_min 0 turns it off; it is registered on UserPromptSubmit', () => {
  const s = setup({ check_every_min: 0 })
  assert.equal(checkHook({ cwd: s.fx.repo }, s.fx.env, { now: () => 1, loadavg: () => 99 }), null)
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks
  assert.ok(hooks.UserPromptSubmit.some((g) => g.hooks.some((h) => /load\/check\.mjs/.test(h.command))))
})
