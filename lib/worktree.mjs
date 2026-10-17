// Lane worktrees: create from the integration HEAD, lease a port block,
// register in lanes.json, run the project's setup command inside a heavy
// slot; remove only when no process works in the path.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { stateDir as stateDirOf, expandHome } from './config.mjs'
import { readLanes, upsertLane, removeLane } from './ledger.mjs'
import { portsFile, leaseLane, releaseLane, readLeases } from './ports.mjs'
import * as slots from './slots.mjs'
import * as cg from './codegraph.mjs'
import { procCwds, isMissingBinary } from './procs.mjs'

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export class WbError extends Error {
  constructor(code, vars = {}, exit = 1) {
    super(code)
    this.code = code
    this.vars = vars
    this.exit = exit
  }
}

export function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    if (allowFail) return null
    throw new WbError('wt.git_failed', { cmd: `git ${args.join(' ')}`, msg: String(e.stderr || e.message).trim().split('\n')[0] })
  }
}

// Paths of the repository: toplevel of cwd, the main checkout, the shared state dir.
export function repoPaths(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true })
  if (!top) throw new WbError('wt.not_git', { cwd })
  const common = path.resolve(top, git(top, ['rev-parse', '--git-common-dir']))
  const main = path.basename(common) === '.git' ? path.dirname(common) : top
  return { top, main, common, state: stateDirOf(top) }
}

const globRe = (glob) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '.*').replace(/\u0000/g, '.*').replace(/\?/g, '.')}$`)

// The integration branch: explicit > lanes.json "integration" > the one local
// branch matching project.git.integration_branch_pattern. null when none.
export function resolveIntegration(repo, config, explicit) {
  if (explicit) return explicit
  try {
    const top = readLanes(repo.state).integration
    if (top) return top
  } catch {}
  const pattern = config.project?.git?.integration_branch_pattern
  if (!pattern) return null
  const re = globRe(pattern)
  const branches = (git(repo.top, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']) || '').split('\n').filter(Boolean)
  const hits = branches.filter((b) => re.test(b))
  if (hits.length > 1) throw new WbError('wt.integration_ambiguous', { branches: hits.join(', ') })
  return hits[0] || null
}

export function laneBranch(id, integration) {
  if (integration && integration.includes('/')) return `${integration.slice(0, integration.lastIndexOf('/'))}/${id}`
  return `wb/${id}`
}

export function worktreePath(repo, config, id) {
  const tpl = config.project?.git?.worktree_root || '{repo}/../wt-{task}'
  const p = expandHome(tpl.replace(/\{repo\}/g, repo.main).replace(/\{(task|lane|name)\}/g, id))
  return path.resolve(repo.main, p)
}

// Copy git-ignored files listed by .worktreeinclude (same idea as Claude
// Code's default worktree creation, which a WorktreeCreate hook replaces).
export function copyIncluded(fromTop, toTop) {
  const list = path.join(fromTop, '.worktreeinclude')
  if (!fs.existsSync(list)) return []
  const out = git(fromTop, ['ls-files', '-o', '-i', '-z', `--exclude-from=${list}`], { allowFail: true }) || ''
  const copied = []
  for (const rel of out.split('\0').filter(Boolean)) {
    const src = path.join(fromTop, rel)
    const dst = path.join(toTop, rel)
    if (fs.existsSync(dst) || !fs.statSync(src).isFile()) continue
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
    copied.push(rel)
  }
  return copied
}

export function liveLanes(repo) {
  return readLanes(repo.state).lanes.filter((l) => l.worktree && fs.existsSync(l.worktree))
}

export function portEnv(lease) {
  const env = {}
  if (!lease?.ports) return env
  for (const [name, port] of Object.entries(lease.ports)) env[`WB_PORT_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] = String(port)
  return env
}

// Run the project's setup command (project.worktree.setup) in `dir` inside a
// heavy slot. Output goes to stderr so a hook's stdout stays the path.
export async function runSetup(dir, ctx, { lane, lease, slotTimeoutMs = null, log = () => {} } = {}) {
  const setup = ctx.config.project?.worktree?.setup
  if (!setup) return { skipped: 'none' }
  const settings = slots.slotSettings(ctx.resolved, (p) => expandHome(p, ctx.env.HOME))
  const held = new Set(String(ctx.env.WB_SLOT_HELD || '').split(',').filter(Boolean))
  const need = held.has('heavy') ? [] : ['heavy']
  const got = await slots.acquire(need, settings, { lane, command: setup, cwd: dir }, { timeoutMs: slotTimeoutMs, pollMs: ctx.pollMs ?? 5000, onWait: (w) => log('wait', w) }, ctx.deps || slots.defaultDeps())
  if (got.timeout) return { skipped: 'slot-timeout' }
  try {
    const r = spawnSync('sh', ['-c', setup], {
      cwd: dir,
      env: { ...ctx.env, WB_LANE: lane, WB_SLOT_HELD: [...held, 'heavy'].join(','), ...portEnv(lease) },
      stdio: ['ignore', 2, 2],
    })
    return { status: r.status ?? 1, command: setup }
  } finally {
    for (const l of got.leases) slots.release(l)
  }
}

// create: { id, branch?, base?, integration?, path?, agentId?, register=true, setup=true, hookStyle=false }
export async function createWorktree(ctx, opts) {
  const { id } = opts
  if (!ID_RE.test(id || '')) throw new WbError('wt.bad_id', { id })
  const repo = repoPaths(ctx.cwd)
  if (!repo.state) throw new WbError('wt.not_git', { cwd: ctx.cwd })
  const config = ctx.config
  const register = opts.register !== false

  if (register) {
    const max = config.machine?.lanes?.max ?? 3
    const others = liveLanes(repo).filter((l) => l.id !== id)
    if (others.length >= max) throw new WbError('wt.lanes_full', { count: others.length, max, lanes: others.map((l) => l.id).join(', ') })
  }

  const integration = opts.base ? opts.integration || null : resolveIntegration(repo, config, opts.integration)
  const baseRef = opts.base || integration || 'HEAD'
  let baseSha = git(repo.top, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { allowFail: true })
  if (!baseSha && baseRef === 'HEAD') throw new WbError('wt.no_commit', {})
  if (!baseSha) baseSha = git(repo.top, ['rev-parse', '--verify', `${baseRef}^{commit}`])
  const branch = opts.branch || (opts.hookStyle ? `worktree-${id}` : laneBranch(id, integration))
  const dir = opts.path ? path.resolve(ctx.cwd, opts.path) : opts.hookStyle ? path.join(repo.top, '.claude', 'worktrees', id) : worktreePath(repo, config, id)
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new WbError('wt.path_exists', { path: dir })

  const exists = git(repo.top, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true })
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  if (exists) git(repo.top, ['worktree', 'add', dir, branch])
  else git(repo.top, ['worktree', 'add', '-b', branch, dir, baseSha])
  const realDir = fs.realpathSync(dir)

  const copied = copyIncluded(repo.top, realDir)
  const lease = leaseLane(portsFile(config, repo.state), config, { lane: id, worktree: realDir }, ctx.portDeps || {})
  if (register) upsertLane(repo.state, { id, branch, worktree: realDir, integration: integration || undefined, agent_id: opts.agentId, role: opts.role })

  // codegraph index for the new checkout (project.codegraph.auto_index):
  // queued here, built by the wb-index worker one at a time inside a heavy slot.
  let index = { skipped: 'disabled' }
  if (opts.index !== false) {
    try {
      index = (ctx.queueIndex || cg.autoQueue)(realDir, { reason: opts.hookStyle ? 'worktree-hook' : 'worktree', config, env: ctx.env })
    } catch (e) {
      index = { skipped: 'error', error: String(e?.message || e) }
    }
  }

  let setup = { skipped: 'disabled' }
  if (opts.setup !== false) setup = await runSetup(realDir, ctx, { lane: id, lease, slotTimeoutMs: opts.slotTimeoutMs ?? null, log: ctx.log })

  return {
    id,
    worktree: realDir,
    branch,
    branchExisted: Boolean(exists),
    base: baseRef,
    baseSha,
    integration,
    registered: register,
    ports: lease.error ? null : lease.ports,
    portError: lease.error ? lease : null,
    copied,
    index,
    setup,
  }
}

// Processes whose working directory or command line is inside `dir`,
// excluding this process and its ancestors.
export function realProcsIn(dir, procDir = '/proc') {
  const real = fs.realpathSync(dir)
  const found = new Map()
  const inDir = (p) => p === real || p.startsWith(`${real}${path.sep}`)
  try {
    const out = execFileSync('lsof', ['-a', '-d', 'cwd', '-Fpn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 })
    let pid
    for (const line of out.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1))
      else if (line.startsWith('n') && inDir(line.slice(1))) found.set(pid, { pid, why: 'cwd' })
    }
  } catch (e) {
    // no lsof (minimal Linux): read the working directories from /proc instead
    if (isMissingBinary(e)) for (const [pid, cwd] of procCwds(procDir)) if (inDir(cwd)) found.set(pid, { pid, why: 'cwd' })
  }
  const parents = new Map()
  try {
    const out = execFileSync('ps', ['-Ao', 'pid=,ppid=,command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 })
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
      if (!m) continue
      const pid = Number(m[1])
      parents.set(pid, { ppid: Number(m[2]), command: m[3] })
      if (m[3].includes(real) || m[3].includes(dir)) if (!found.has(pid)) found.set(pid, { pid, why: 'command' })
    }
  } catch {}
  const mine = new Set()
  for (let p = process.pid; p > 1 && !mine.has(p); p = parents.get(p)?.ppid ?? 0) mine.add(p)
  return [...found.values()].filter((p) => !mine.has(p.pid)).map((p) => ({ ...p, command: parents.get(p.pid)?.command?.slice(0, 160) || '' }))
}

export function listWorktrees(repo) {
  const out = git(repo.top, ['worktree', 'list', '--porcelain'])
  const list = []
  let cur
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) list.push((cur = { path: line.slice(9) }))
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '')
  }
  return list
}

// Delete a branch only when its commits are on another local branch too, so
// no work is lost (a lane branch with no commits of its own, or one merged).
export function deleteBranchIfKept(repo, branch) {
  const tip = git(repo.top, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true })
  if (!tip) return false
  const holders = (git(repo.top, ['for-each-ref', '--format=%(refname:short)', '--contains', tip, 'refs/heads/'], { allowFail: true }) || '').split('\n').filter((b) => b && b !== branch)
  if (!holders.length) return false
  return git(repo.top, ['branch', '-D', branch], { allowFail: true }) !== null
}

// remove: { target (id or path), force, deleteBranch, hook }
export function removeWorktree(ctx, opts) {
  const repo = repoPaths(ctx.cwd)
  const lanes = readLanes(repo.state).lanes
  let lane = lanes.find((l) => l.id === opts.target)
  let dir = lane ? lane.worktree : path.resolve(ctx.cwd, opts.target)
  const real = fs.existsSync(dir) ? fs.realpathSync(dir) : dir
  if (!lane) lane = lanes.find((l) => l.worktree && (l.worktree === real || l.worktree === dir))
  const wts = listWorktrees(repo)
  const wt = wts.find((w) => w.path === real || w.path === dir)
  if (wt && path.resolve(wt.path) === path.resolve(fs.realpathSync(repo.main))) throw new WbError('wt.main_checkout', { path: wt.path })
  const id = lane?.id || path.basename(real)
  const leaseKey = lane?.id || readLeases(portsFile(ctx.config, repo.state)).find((l) => l.worktree === real)?.lane || id

  if (wt && fs.existsSync(real)) {
    const procs = (ctx.procsIn || realProcsIn)(real)
    if (procs.length) throw new WbError('wt.busy', { path: real, procs, pids: procs.map((p) => p.pid).join(' ') }, 3)
    if (!opts.force) {
      // a codegraph index is not work; it is removed with the worktree
      const dirty = (git(real, ['status', '--porcelain'], { allowFail: true }) || '').split('\n').filter((l) => l && l.trim() !== `?? ${cg.EXCLUDE_LINE}`)
      if (dirty.length) throw new WbError('wt.dirty', { path: real, count: dirty.length }, 4)
    }
    cg.dropIndex(real)
    git(repo.top, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), real])
  } else if (!wt && fs.existsSync(real)) {
    // never delete a directory git does not know as a worktree of this repository
    throw new WbError('wt.not_worktree', { path: real })
  } else {
    git(repo.top, ['worktree', 'prune'], { allowFail: true })
  }

  try {
    cg.dequeue(real, ctx.env)
  } catch {}
  const released = releaseLane(portsFile(ctx.config, repo.state), leaseKey)
  const unregistered = removeLane(repo.state, (l) => l.id === lane?.id || l.worktree === real)
  let branchDeleted = null
  const branch = wt?.branch || lane?.branch
  if (branch && (opts.deleteBranch || (opts.hook && branch === `worktree-${path.basename(real)}`))) {
    branchDeleted = deleteBranchIfKept(repo, branch) ? branch : false
  }
  return { id, worktree: real, branch: branch || null, released, unregistered: unregistered.map((l) => l.id), branchDeleted }
}
