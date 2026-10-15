// wb-slot: concurrent acquisition, reclaiming dead and expired leases, load
// waiting (time and load are injected), and the CLI under a real race.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as slots from '../lib/slots.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-slot-')))

function setup({ heavy = 2, browser = 2, staleMin = 90, loadMax = 100 } = {}) {
  const dir = tmp()
  const settings = { leaseDir: path.join(dir, 'slots'), counts: { heavy, browser }, staleMs: staleMin * 60000, loadMax, loadSample: '1min' }
  let clock = Date.parse('2026-10-16T00:00:00Z')
  const alive = new Set([process.pid])
  const deps = slots.defaultDeps({
    now: () => clock,
    loadavg: () => 1,
    pidAlive: (pid) => alive.has(pid),
    sleep: async (ms) => {
      clock += ms
    },
  })
  return { dir, settings, deps, alive, advance: (ms) => (clock += ms), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('three requests for two heavy slots: two get one, the third gets none', () => {
  const s = setup()
  const got = [1, 2, 3].map((i) => slots.tryAcquire('heavy', s.settings, { pid: process.pid, lane: `l${i}` }, s.deps))
  assert.equal(got.filter(Boolean).length, 2)
  assert.equal(got[2], null)
  assert.deepEqual(got.slice(0, 2).map((l) => l.slot), [1, 2])
  const owner = JSON.parse(fs.readFileSync(path.join(got[0].dir, 'owner.json'), 'utf8'))
  assert.equal(owner.lane, 'l1')
  assert.equal(owner.pid, process.pid)
  // heavy and browser are counted apart
  assert.ok(slots.tryAcquire('browser', s.settings, { pid: process.pid }, s.deps))
  // release frees exactly one
  assert.ok(slots.release(got[0]))
  assert.equal(slots.tryAcquire('heavy', s.settings, { pid: process.pid }, s.deps).slot, 1)
  s.cleanup()
})

test('a lease whose owner process died is reclaimed by the next caller', () => {
  const s = setup()
  s.alive.add(999001)
  s.alive.add(999002)
  slots.tryAcquire('heavy', s.settings, { pid: 999001 }, s.deps)
  slots.tryAcquire('heavy', s.settings, { pid: 999002 }, s.deps)
  assert.equal(slots.tryAcquire('heavy', s.settings, { pid: process.pid }, s.deps), null)
  s.alive.delete(999001)
  const st = slots.status(s.settings, s.deps).find((k) => k.kind === 'heavy')
  assert.deepEqual(st.held.map((h) => h.stale), ['dead-pid', null])
  const lease = slots.tryAcquire('heavy', s.settings, { pid: process.pid }, s.deps)
  assert.equal(lease.slot, 1)
  assert.equal(lease.owner.pid, process.pid)
  s.cleanup()
})

test('a lease not renewed within stale_after_min expires; renewing keeps it', () => {
  const s = setup({ staleMin: 90 })
  s.alive.add(999003)
  const a = slots.tryAcquire('heavy', s.settings, { pid: 999003 }, s.deps)
  const b = slots.tryAcquire('heavy', s.settings, { pid: process.pid }, s.deps)
  s.advance(60 * 60000)
  assert.ok(slots.renew(b, s.deps))
  s.advance(31 * 60000) // a: 91 min since start, b: 31 min since renewal
  const reaped = slots.reapKind('heavy', s.settings, s.deps)
  assert.deepEqual(reaped.map((r) => [r.slot, r.reason]), [[a.slot, 'expired']])
  assert.ok(fs.existsSync(b.dir))
  // the old holder cannot release or renew the slot someone else now holds
  const c = slots.tryAcquire('heavy', s.settings, { pid: process.pid, lane: 'new' }, s.deps)
  assert.equal(c.slot, a.slot)
  assert.equal(slots.release(a), false)
  assert.equal(slots.renew(a, s.deps), false)
  assert.ok(fs.existsSync(c.dir))
  s.cleanup()
})

test('a slot directory without an owner file is reclaimed only after the grace period', () => {
  const s = setup({ heavy: 1 })
  const d = path.join(s.settings.leaseDir, 'heavy', 'slot1')
  fs.mkdirSync(d, { recursive: true })
  fs.utimesSync(d, s.deps.now() / 1000, s.deps.now() / 1000)
  assert.equal(slots.tryAcquire('heavy', s.settings, { pid: process.pid }, s.deps), null)
  s.advance(slots.OWNERLESS_GRACE_MS + 1000)
  assert.ok(slots.tryAcquire('heavy', s.settings, { pid: process.pid }, s.deps))
  s.cleanup()
})

test('release removes only the owner file and the slot directory (no recursive delete)', () => {
  const s = setup()
  const l = slots.tryAcquire('heavy', s.settings, { pid: process.pid }, s.deps)
  fs.writeFileSync(path.join(l.dir, 'unexpected.txt'), 'x')
  assert.equal(slots.release(l), false) // rmdir refuses a non-empty directory
  assert.ok(fs.existsSync(path.join(l.dir, 'unexpected.txt')))
  s.cleanup()
})

test('load at or above the threshold waits even when slots are free', async () => {
  const s = setup({ loadMax: 20 })
  const loads = [30, 20, 19.5]
  s.deps.loadavg = () => loads.shift() ?? 1
  const waits = []
  const r = await slots.acquire(['heavy'], s.settings, { pid: process.pid }, { pollMs: 1000, onWait: (w) => waits.push(w) }, s.deps)
  assert.equal(r.leases.length, 1)
  assert.deepEqual(waits.map((w) => [w.reason, w.load]), [['load', 30], ['load', 20]])
  s.cleanup()
})

test('busy slots wait; a timeout gives up without holding anything', async () => {
  const s = setup({ heavy: 1 })
  slots.tryAcquire('heavy', s.settings, { pid: process.pid }, s.deps)
  const waits = []
  const r = await slots.acquire(['heavy'], s.settings, { pid: process.pid }, { pollMs: 1000, timeoutMs: 3000, onWait: (w) => waits.push(w.reason) }, s.deps)
  assert.equal(r.timeout, true)
  assert.equal(r.last.reason, 'busy')
  assert.deepEqual(waits, ['busy', 'busy', 'busy'])
  s.cleanup()
})

test('heavy + browser are taken together or not at all', async () => {
  const s = setup({ heavy: 2, browser: 1 })
  const other = slots.tryAcquire('browser', s.settings, { pid: process.pid }, s.deps)
  const r = await slots.acquire(['heavy', 'browser'], s.settings, { pid: process.pid }, { pollMs: 1000, timeoutMs: 1000 }, s.deps)
  assert.equal(r.timeout, true)
  const heavy = slots.status(s.settings, s.deps).find((k) => k.kind === 'heavy')
  assert.equal(heavy.held.length, 0, 'the heavy slot taken on the way is given back')
  slots.release(other)
  const ok = await slots.acquire(['heavy', 'browser'], s.settings, { pid: process.pid }, { pollMs: 1000, timeoutMs: 1000 }, s.deps)
  assert.deepEqual(ok.leases.map((l) => l.kind), ['heavy', 'browser'])
  s.cleanup()
})

function runSlot(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'bin', 'wb-slot'), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (c) => (out += c))
    p.stderr.on('data', (c) => (err += c))
    p.on('exit', (code) => resolve({ code, out, err }))
  })
}

function cliEnv(dir, machine) {
  const home = path.join(dir, 'home')
  fs.mkdirSync(path.join(home, '.wb'), { recursive: true })
  fs.writeFileSync(path.join(home, '.wb', 'machine.json'), JSON.stringify(machine))
  return { PATH: process.env.PATH, HOME: home, WB_HOME: path.join(home, '.wb'), WB_PROJECT_DIR: dir, LANG: 'en_US.UTF-8' }
}

test('CLI race: three wb-slot processes with two heavy slots never run more than two at once', async () => {
  const dir = tmp()
  const env = cliEnv(dir, { load: { max: 100000 }, slots: { lease_dir: path.join(dir, 'slots') } })
  const log = path.join(dir, 'log')
  const job = `const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'s '+Date.now()+'\\n');setTimeout(()=>fs.appendFileSync(${JSON.stringify(log)},'e '+Date.now()+'\\n'),600)`
  const rs = await Promise.all([1, 2, 3].map(() => runSlot(['--kind', 'heavy', '--poll', '0.1', '--', process.execPath, '-e', job], env)))
  assert.deepEqual(rs.map((r) => r.code), [0, 0, 0], rs.map((r) => r.err).join('\n'))
  const events = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([k, t]) => [Number(t), k === 's' ? 1 : -1])
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let cur = 0
  let peak = 0
  for (const [, d] of events) peak = Math.max(peak, (cur += d))
  assert.equal(peak, 2)
  assert.ok(rs.some((r) => /all 2 heavy slots are in use/.test(r.err)), 'one caller waited')
  assert.deepEqual(fs.readdirSync(path.join(dir, 'slots', 'heavy')).filter((n) => n.startsWith('slot')), [], 'all released')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('CLI: exit code passes through, WB_SLOT_HELD is set, a nested wb-slot does not wait for itself', async () => {
  const dir = tmp()
  const env = cliEnv(dir, { load: { max: 100000 }, slots: { lease_dir: path.join(dir, 'slots'), heavy: { count: 1 } } })
  const nested = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(ROOT, 'bin', 'wb-slot'))} --kind heavy --timeout 2 -- sh -c 'echo held=$WB_SLOT_HELD; exit 7'`
  const r = await runSlot(['--kind', 'heavy', '--', 'sh', '-c', nested], env)
  assert.equal(r.code, 7)
  assert.match(r.out, /held=heavy/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('CLI: load above the threshold with a timeout does not run the command', async () => {
  const dir = tmp()
  // the lowest allowed threshold; checked only when the machine is at or above it
  const env = cliEnv(dir, { load: { max: 1 }, slots: { lease_dir: path.join(dir, 'slots') } })
  const marker = path.join(dir, 'ran')
  const r = await runSlot(['--timeout', '0', '--', 'touch', marker], env)
  if (os.loadavg()[0] >= 1) {
    assert.equal(r.code, 75)
    assert.match(r.err, /load is high/)
    assert.equal(fs.existsSync(marker), false)
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test('CLI: status and reap report holders and reclaim a dead one', async () => {
  const dir = tmp()
  const env = cliEnv(dir, { load: { max: 100000 }, slots: { lease_dir: path.join(dir, 'slots') } })
  const slot = path.join(dir, 'slots', 'heavy', 'slot1')
  fs.mkdirSync(slot, { recursive: true })
  fs.writeFileSync(path.join(slot, 'owner.json'), JSON.stringify({ pid: 2147483646, started: new Date().toISOString(), renewed: new Date().toISOString(), command: 'pnpm -r test', lane: 'l9' }))
  const st = JSON.parse((await runSlot(['status', '--json'], env)).out)
  assert.equal(st.slots.find((k) => k.kind === 'heavy').held[0].stale, 'dead-pid')
  const rp = JSON.parse((await runSlot(['reap', '--json'], env)).out)
  assert.deepEqual(rp.reaped.map((x) => [x.kind, x.slot, x.reason]), [['heavy', 1, 'dead-pid']])
  assert.equal(fs.existsSync(slot), false)
  fs.rmSync(dir, { recursive: true, force: true })
})
