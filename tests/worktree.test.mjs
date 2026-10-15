// wb-worktree: lane worktrees from the integration HEAD, port leases,
// lanes.json in the format the safety hooks read, the lane limit, the setup
// command inside a slot, and removal that stops at running processes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../lib/config.mjs'
import * as wt from '../lib/worktree.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function fixture({ machine = {}, project = {} } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-wt-')))
  const repo = path.join(base, 'repo')
  fs.mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n')
  fs.writeFileSync(path.join(repo, '.worktreeinclude'), '.env\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'branch', 'wb/t/int')
  // the integration branch moves ahead of main
  git(repo, 'checkout', '-q', 'wb/t/int')
  fs.writeFileSync(path.join(repo, 'int.txt'), 'int\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'int work')
  git(repo, 'checkout', '-q', 'main')
  fs.writeFileSync(path.join(repo, '.env'), 'KEY=local\n')
  const home = path.join(base, 'home')
  fs.mkdirSync(path.join(home, '.wb'), { recursive: true })
  fs.writeFileSync(path.join(home, '.wb', 'machine.json'), JSON.stringify({ load: { max: 100000 }, slots: { lease_dir: path.join(base, 'slots') }, ...machine }))
  fs.mkdirSync(path.join(repo, '.wb'))
  fs.writeFileSync(path.join(repo, '.wb', 'config.json'), JSON.stringify(project))
  const env = { PATH: process.env.PATH, HOME: home, WB_HOME: path.join(home, '.wb'), LANG: 'en_US.UTF-8', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  const ctx = (extra = {}) => {
    const resolved = resolveConfig({ projectDir: repo, env })
    assert.deepEqual(resolved.errors, [])
    return { cwd: repo, env, resolved, config: resolved.config, portDeps: { listening: () => new Set() }, pollMs: 10, log: () => {}, ...extra }
  }
  const lanes = () => JSON.parse(fs.readFileSync(path.join(repo, '.git', 'wb', 'lanes.json'), 'utf8'))
  const leases = () => JSON.parse(fs.readFileSync(path.join(repo, '.git', 'wb', 'ports.json'), 'utf8')).leases
  return { base, repo, env, ctx, lanes, leases, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) }
}

test('create: branches from the integration HEAD, leases ports, registers the lane, copies .worktreeinclude', async () => {
  const f = fixture()
  const r = await wt.createWorktree(f.ctx(), { id: 'l1' })
  assert.equal(r.integration, 'wb/t/int')
  assert.equal(r.branch, 'wb/t/l1')
  assert.equal(r.worktree, path.join(f.base, 'wt-l1'))
  assert.equal(r.baseSha, git(f.repo, 'rev-parse', 'wb/t/int'))
  assert.equal(git(r.worktree, 'rev-parse', 'HEAD'), r.baseSha)
  assert.ok(fs.existsSync(path.join(r.worktree, 'int.txt')))
  assert.equal(fs.readFileSync(path.join(r.worktree, '.env'), 'utf8'), 'KEY=local\n')
  assert.deepEqual(r.copied, ['.env'])
  assert.equal(r.ports.web, 7000)
  // lanes.json keeps the shape the safety hooks read
  assert.deepEqual(f.lanes(), { lanes: [{ id: 'l1', branch: 'wb/t/l1', worktree: r.worktree, integration: 'wb/t/int' }] })
  assert.deepEqual(f.leases().map((l) => [l.lane, l.block, l.worktree]), [['l1', 0, r.worktree]])
  f.cleanup()
})

test('create: --agent-id is stored, explicit branch and base are honoured, ports skip protected ones', async () => {
  const f = fixture({ machine: { load: { max: 100000 }, ports: { protected: [{ name: 'owner-api', port: 7003, project: '*' }] } } })
  const r = await wt.createWorktree(f.ctx(), { id: 'l2', branch: 'feat/l2', base: 'main', agentId: 'agent-7' })
  assert.equal(r.branch, 'feat/l2')
  assert.equal(r.baseSha, git(f.repo, 'rev-parse', 'main'))
  assert.equal(r.ports.web, 7010)
  assert.equal(f.lanes().lanes[0].agent_id, 'agent-7')
  f.cleanup()
})

test('create: refuses past machine.lanes.max and leaves nothing behind', async () => {
  const f = fixture({ machine: { load: { max: 100000 }, lanes: { max: 1 } } })
  await wt.createWorktree(f.ctx(), { id: 'l1' })
  await assert.rejects(wt.createWorktree(f.ctx(), { id: 'l2' }), (e) => e.code === 'wt.lanes_full' && e.vars.max === 1)
  assert.equal(fs.existsSync(path.join(f.base, 'wt-l2')), false)
  assert.equal(f.lanes().lanes.length, 1)
  f.cleanup()
})

test('create: rejects bad ids and two integration branches without --integration', async () => {
  const f = fixture()
  await assert.rejects(wt.createWorktree(f.ctx(), { id: '../x' }), (e) => e.code === 'wt.bad_id')
  git(f.repo, 'branch', 'wb/u/int')
  await assert.rejects(wt.createWorktree(f.ctx(), { id: 'l1' }), (e) => e.code === 'wt.integration_ambiguous')
  const r = await wt.createWorktree(f.ctx(), { id: 'l1', integration: 'wb/u/int' })
  assert.equal(r.branch, 'wb/u/l1')
  f.cleanup()
})

test('create: setup runs in the new worktree inside a heavy slot, with lane and port variables', async () => {
  const f = fixture({ project: { worktree: { setup: 'echo "$WB_LANE $WB_PORT_WEB $WB_SLOT_HELD" > setup.out; ls "$SLOTS"/heavy > slots.out' } } })
  const c = f.ctx()
  c.env = { ...c.env, SLOTS: path.join(f.base, 'slots') }
  const r = await wt.createWorktree(c, { id: 'l1' })
  assert.equal(r.setup.status, 0)
  assert.equal(fs.readFileSync(path.join(r.worktree, 'setup.out'), 'utf8').trim(), 'l1 7000 heavy')
  assert.match(fs.readFileSync(path.join(r.worktree, 'slots.out'), 'utf8'), /slot1/)
  assert.deepEqual(fs.readdirSync(path.join(f.base, 'slots', 'heavy')).filter((n) => n.startsWith('slot')), [], 'slot released')
  f.cleanup()
})

test('create: no free heavy slot within the limit -> setup skipped, worktree kept', async () => {
  const f = fixture({ machine: { load: { max: 100000 }, slots: { lease_dir: '', heavy: { count: 1 } } }, project: { worktree: { setup: 'touch ran' } } })
  const c = f.ctx()
  const leaseDir = path.join(f.base, 'held')
  c.resolved.config.machine.slots.lease_dir = leaseDir
  fs.mkdirSync(path.join(leaseDir, 'heavy', 'slot1'), { recursive: true })
  fs.writeFileSync(path.join(leaseDir, 'heavy', 'slot1', 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), renewed: new Date().toISOString() }))
  const r = await wt.createWorktree(c, { id: 'l1', slotTimeoutMs: 50 })
  assert.equal(r.setup.skipped, 'slot-timeout')
  assert.ok(fs.existsSync(r.worktree))
  assert.equal(fs.existsSync(path.join(r.worktree, 'ran')), false)
  f.cleanup()
})

test('remove: stops while a process works in the path and names the PIDs', async () => {
  const f = fixture()
  const r = await wt.createWorktree(f.ctx(), { id: 'l1' })
  const busy = f.ctx({ procsIn: () => [{ pid: 4242, why: 'cwd', command: 'vite' }] })
  assert.throws(() => wt.removeWorktree(busy, { target: 'l1' }), (e) => e.code === 'wt.busy' && e.exit === 3 && e.vars.pids === '4242')
  assert.ok(fs.existsSync(r.worktree))
  assert.equal(f.lanes().lanes.length, 1)
  f.cleanup()
})

test('remove: refuses uncommitted changes unless --force; then releases ports and unregisters', async () => {
  const f = fixture()
  const r = await wt.createWorktree(f.ctx(), { id: 'l1' })
  fs.writeFileSync(path.join(r.worktree, 'new.txt'), 'x')
  const c = f.ctx({ procsIn: () => [] })
  assert.throws(() => wt.removeWorktree(c, { target: 'l1' }), (e) => e.code === 'wt.dirty' && e.exit === 4)
  const out = wt.removeWorktree(c, { target: 'l1', force: true })
  assert.equal(fs.existsSync(r.worktree), false)
  assert.deepEqual(out.unregistered, ['l1'])
  assert.equal(out.released.length, 1)
  assert.deepEqual(f.lanes().lanes, [])
  assert.deepEqual(f.leases(), [])
  assert.ok(git(f.repo, 'branch', '--list', 'wb/t/l1'), 'branch kept unless --delete-branch')
  f.cleanup()
})

test('remove: never deletes the main checkout or a folder that is not a worktree', async () => {
  const f = fixture()
  const c = f.ctx({ procsIn: () => [] })
  assert.throws(() => wt.removeWorktree(c, { target: f.repo }), (e) => e.code === 'wt.main_checkout')
  const plain = path.join(f.base, 'plain')
  fs.mkdirSync(plain)
  fs.writeFileSync(path.join(plain, 'keep.txt'), 'x')
  assert.throws(() => wt.removeWorktree(c, { target: plain }), (e) => e.code === 'wt.not_worktree')
  assert.ok(fs.existsSync(path.join(plain, 'keep.txt')))
  f.cleanup()
})

test('remove: finds a real process whose working directory is inside the worktree', async () => {
  const f = fixture()
  const r = await wt.createWorktree(f.ctx(), { id: 'l1' })
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)'], { cwd: r.worktree, stdio: 'ignore' })
  await new Promise((res) => setTimeout(res, 300))
  try {
    const procs = wt.realProcsIn(r.worktree)
    assert.ok(procs.some((p) => p.pid === child.pid), JSON.stringify(procs))
    assert.ok(!procs.some((p) => p.pid === process.pid), 'this process is never listed')
  } finally {
    child.kill()
  }
  f.cleanup()
})

function cli(f, args, input) {
  return execFileSync(process.execPath, [path.join(ROOT, 'bin', 'wb-worktree'), ...args], { cwd: f.repo, env: f.env, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] })
}

test('WorktreeCreate / WorktreeRemove hooks: path on the last stdout line, no lane registration, cleanup', () => {
  const f = fixture()
  const out = cli(f, ['hook-create'], JSON.stringify({ hook_event_name: 'WorktreeCreate', name: 'bold-oak', cwd: f.repo }))
  const lines = out.trim().split('\n')
  assert.equal(lines.length, 1, 'only the path on stdout')
  const p = lines[0]
  assert.equal(p, path.join(f.repo, '.claude', 'worktrees', 'bold-oak'))
  assert.equal(git(p, 'rev-parse', '--abbrev-ref', 'HEAD'), 'worktree-bold-oak')
  assert.equal(git(p, 'rev-parse', 'HEAD'), git(f.repo, 'rev-parse', 'wb/t/int'))
  assert.equal(fs.existsSync(path.join(f.repo, '.git', 'wb', 'lanes.json')), false)
  assert.equal(f.leases()[0].lane, 'bold-oak')
  cli(f, ['hook-remove'], JSON.stringify({ hook_event_name: 'WorktreeRemove', worktree_path: p, cwd: f.repo }))
  assert.equal(fs.existsSync(p), false)
  assert.deepEqual(f.leases(), [])
  assert.equal(git(f.repo, 'branch', '--list', 'worktree-bold-oak'), '', 'merged hook branch deleted')
  f.cleanup()
})

test('WorktreeRemove hook: exits non-zero and keeps a folder that is not a worktree', () => {
  const f = fixture()
  const plain = path.join(f.base, 'plain')
  fs.mkdirSync(plain)
  assert.throws(() => cli(f, ['hook-remove'], JSON.stringify({ worktree_path: plain, cwd: f.repo })), (e) => e.status === 1)
  assert.ok(fs.existsSync(plain))
  f.cleanup()
})

test('CLI create / list / remove round trip with JSON output', () => {
  const f = fixture()
  const r = JSON.parse(cli(f, ['create', 'l1', '--no-setup', '--json']))
  assert.equal(r.branch, 'wb/t/l1')
  const list = JSON.parse(cli(f, ['list', '--json']))
  assert.deepEqual(list.lanes.map((l) => [l.id, l.exists]), [['l1', true]])
  const gone = JSON.parse(cli(f, ['remove', 'l1', '--json', '--delete-branch']))
  assert.equal(gone.branchDeleted, 'wb/t/l1')
  f.cleanup()
})

test('remove --delete-branch keeps a branch that has commits of its own', async () => {
  const f = fixture()
  const r = await wt.createWorktree(f.ctx(), { id: 'l1' })
  fs.writeFileSync(path.join(r.worktree, 'work.txt'), 'w')
  git(r.worktree, 'add', '.')
  git(r.worktree, 'commit', '-q', '-m', 'lane work')
  const out = wt.removeWorktree(f.ctx({ procsIn: () => [] }), { target: 'l1', deleteBranch: true })
  assert.equal(out.branchDeleted, false)
  assert.ok(git(f.repo, 'branch', '--list', 'wb/t/l1'))
  f.cleanup()
})
