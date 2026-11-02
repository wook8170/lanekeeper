// Lane port bands: protected ports are never handed out, ports already in use
// are skipped, two lanes never share a block, finished leases come back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as ports from '../lib/ports.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-port-')))
const none = { listening: () => new Set() }

function cfg(machinePorts = {}) {
  return {
    machine: {
      ports: {
        protected: [],
        lane_range: { base: 7000, step: 10, per_lane: ['web', 'web2', 'api', 'db', 'aux'], max_lanes: 9 },
        ...machinePorts,
      },
    },
  }
}

test('default lane range starts at 41000 with 20 ports per band (clear of macOS AirPlay on 7000)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'defaults', 'machine.json'), 'utf8'))
  const range = ports.laneRange(m.machine ? m : { machine: m })
  assert.deepEqual([range.base, range.step], [41000, 20])
  assert.deepEqual(ports.blockPorts(range, 0), { web: 41000, web2: 41001, api: 41002, db: 41003, aux: 41004 })
  assert.equal(ports.blockPorts(range, 8).aux, 41164)
  assert.deepEqual(ports.rangeProblems({ machine: m }), [])
  assert.deepEqual(ports.laneRange({}), { base: 41000, step: 20, names: ['web'], max: 9 })
})

test('block layout: base + block*step + index', () => {
  assert.deepEqual(ports.blockPorts(ports.laneRange(cfg()), 2), { web: 7020, web2: 7021, api: 7022, db: 7023, aux: 7024 })
})

test('two lanes get different blocks; the same lane gets its lease back', () => {
  const dir = tmp()
  const file = path.join(dir, 'ports.json')
  const a = ports.leaseLane(file, cfg(), { lane: 'l1', worktree: dir }, none)
  const b = ports.leaseLane(file, cfg(), { lane: 'l2', worktree: dir }, none)
  assert.equal(a.block, 0)
  assert.equal(b.block, 1)
  const again = ports.leaseLane(file, cfg(), { lane: 'l1', worktree: dir }, none)
  assert.equal(again.block, 0)
  assert.equal(again.reused, true)
  const all = Object.values(a.ports).concat(Object.values(b.ports))
  assert.equal(new Set(all).size, all.length, 'no port shared between lanes')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a block holding a protected port is skipped', () => {
  const dir = tmp()
  const file = path.join(dir, 'ports.json')
  const c = cfg({ protected: [{ name: 'owner-api', port: 7002, project: '*' }, { name: 'owner-web', port: 7013, project: '*' }] })
  const a = ports.leaseLane(file, c, { lane: 'l1', worktree: dir }, none)
  assert.equal(a.block, 2)
  assert.deepEqual(a.skipped.map((s) => [s.block, s.reason, s.port]), [[0, 'protected', 7002], [1, 'protected', 7013]])
  assert.ok(!Object.values(a.ports).includes(7002))
  // the range check names the clash too
  assert.deepEqual(ports.rangeProblems(c).map((p) => [p.code, p.port]), [['protected', 7002], ['protected', 7013]])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a block with a port somebody already listens on is skipped (port conflict)', () => {
  const dir = tmp()
  const file = path.join(dir, 'ports.json')
  const a = ports.leaseLane(file, cfg(), { lane: 'l1', worktree: dir }, { listening: () => new Set([7000, 7014]) })
  assert.equal(a.block, 2)
  assert.deepEqual(a.skipped.map((s) => s.reason), ['listening', 'listening'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('no free block -> error; a lease whose worktree is gone is reused', () => {
  const dir = tmp()
  const file = path.join(dir, 'ports.json')
  const c = cfg({ lane_range: { base: 7000, step: 10, per_lane: ['web'], max_lanes: 2 } })
  const gone = path.join(dir, 'wt-gone')
  fs.mkdirSync(gone)
  ports.leaseLane(file, c, { lane: 'l1', worktree: dir }, none)
  ports.leaseLane(file, c, { lane: 'l2', worktree: gone }, none)
  fs.rmdirSync(gone)
  const r = ports.leaseLane(file, c, { lane: 'l3', worktree: dir }, none)
  assert.equal(r.block, 1, 'the block of the vanished worktree is free again')
  const full = ports.leaseLane(file, c, { lane: 'l4', worktree: dir }, none)
  assert.equal(full.error, 'full')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('concurrent leases from several processes never share a block', async () => {
  const dir = tmp()
  const file = path.join(dir, 'ports.json')
  const script = `import(${JSON.stringify(path.join(ROOT, 'lib', 'ports.mjs'))}).then((p) => { const r = p.leaseLane(process.argv[1], { machine: { ports: { lane_range: { base: 7100, step: 10, per_lane: ['web'], max_lanes: 9 } } } }, { lane: process.argv[2], worktree: process.argv[3] }, { listening: () => new Set() }); process.stdout.write(String(r.block)) })`
  const { spawn } = await import('node:child_process')
  const run = (lane) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, ['-e', script, file, lane, dir], { stdio: ['ignore', 'pipe', 'inherit'] })
      let out = ''
      p.stdout.on('data', (c) => (out += c))
      p.on('exit', () => resolve(Number(out)))
    })
  const blocks = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(run))
  assert.equal(new Set(blocks).size, 5, `blocks ${blocks}`)
  assert.equal(ports.readLeases(file).length, 5)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('range problems: overlapping bands and ports above 65535', () => {
  const codes = ports.rangeProblems(cfg({ lane_range: { base: 65530, step: 2, per_lane: ['web', 'api', 'db'], max_lanes: 3 } })).map((p) => p.code)
  assert.deepEqual(codes, ['overlap', 'too-high'])
})

test('lookup by name: protected port, lane.<name> with and without a lease', () => {
  const dir = tmp()
  const file = path.join(dir, 'ports.json')
  const c = cfg({ protected: [{ name: 'owner-api', port: 5555, project: '*' }] })
  ports.leaseLane(file, c, { lane: 'l1', worktree: dir }, none)
  assert.deepEqual(ports.lookup(c, file, 'owner-api'), { port: 5555 })
  assert.deepEqual(ports.lookup(c, file, 'lane.api', 'l1'), { port: 7002 })
  assert.equal(ports.lookup(c, file, 'lane.api', 'l9').error, 'no-lease')
  assert.equal(ports.lookup(c, file, 'lane.api').error, 'no-lane')
  assert.equal(ports.lookup(c, file, 'nope').error, 'unknown-name')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('ledger path follows machine.ports.leases', () => {
  assert.equal(ports.portsFile(cfg(), '/r/.git/wb'), '/r/.git/wb/ports.json')
  assert.equal(ports.portsFile(cfg({ leases: '{git_common_dir}/other.json' }), '/r/.git/wb'), '/r/.git/other.json')
})

test('wb-port CLI: get and list read machine settings', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  fs.mkdirSync(path.join(home, '.wb'), { recursive: true })
  fs.writeFileSync(path.join(home, '.wb', 'machine.json'), JSON.stringify({ ports: { protected: [{ name: 'owner-api', port: 5555, project: '*' }] } }))
  execFileSync('git', ['init', '-q', path.join(dir, 'repo')])
  const env = { PATH: process.env.PATH, HOME: home, WB_ACTIVE: '1', WB_HOME: path.join(home, '.wb'), LANG: 'en_US.UTF-8', GIT_CONFIG_GLOBAL: '/dev/null' }
  const run = (...a) => execFileSync(process.execPath, [path.join(ROOT, 'bin', 'wb-port'), ...a], { cwd: path.join(dir, 'repo'), env, encoding: 'utf8' })
  assert.equal(run('get', 'owner-api').trim(), '5555')
  const list = JSON.parse(run('list', '--json'))
  assert.equal(list.protected[0].port, 5555)
  assert.throws(() => run('get', 'lane.web'), (e) => e.status === 1 && /lane is unknown/.test(e.stderr))
  fs.rmSync(dir, { recursive: true, force: true })
})
