// L12: codegraph layer — index queue (copy then sync), worktree hook-up,
// grep nudge once per session, blocking a second call for a path with no
// index, recording every response in four classes (+ other errors), doctor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as cg from '../lib/codegraph.mjs'
import * as wt from '../lib/worktree.mjs'
import { resolveConfig } from '../lib/config.mjs'
import { doctor } from '../lib/init.mjs'
import { messages } from '../lib/i18n.mjs'
import { loadCatalog } from '../lib/rules.mjs'
import { parse } from '../hooks/scripts/safety/shell.mjs'
import { judgeNudge } from '../hooks/scripts/codegraph/nudge.mjs'
import { judgeDead, handle as deadHandle } from '../hooks/scripts/codegraph/deadpath.mjs'
import { recordCall, handle as recordHandle } from '../hooks/scripts/codegraph/record.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// A stand-in codegraph: init/sync/status on <dir>/.codegraph, every call logged.
const FAKE = `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const [cmd, ...rest] = process.argv.slice(2)
const dir = path.resolve(rest.filter((a) => !a.startsWith('-')).pop() || '.')
const db = path.join(dir, '.codegraph', 'codegraph.db')
if (process.env.FAKE_CG_LOG) fs.appendFileSync(process.env.FAKE_CG_LOG, cmd + ' ' + dir + '\\n')
if (cmd === 'init') {
  if (process.env.FAKE_CG_FAIL_INIT) { console.error('boom'); process.exit(1) }
  fs.mkdirSync(path.dirname(db), { recursive: true }); fs.writeFileSync(db, 'fake:' + dir)
  fs.writeFileSync(path.join(dir, '.codegraph', '.gitignore'), '*.db\\n'); process.exit(0)
}
if (cmd === 'sync') process.exit(fs.existsSync(db) ? 0 : 1)
if (cmd === 'status') { console.log(JSON.stringify({ initialized: fs.existsSync(db) })); process.exit(0) }
process.exit(2)
`

function fixture({ project = {}, fake = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cg-')))
  const repo = path.join(base, 'repo')
  fs.mkdirSync(path.join(repo, 'lib'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'lib', 'a.mjs'), 'export function createWorktree() { return 1 }\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const home = path.join(base, 'home')
  fs.mkdirSync(path.join(home, '.wb'), { recursive: true })
  fs.writeFileSync(path.join(home, '.wb', 'machine.json'), JSON.stringify({ load: { max: 100000 }, slots: { lease_dir: path.join(base, 'slots') } }))
  fs.mkdirSync(path.join(repo, '.wb'))
  fs.writeFileSync(path.join(repo, '.wb', 'config.json'), JSON.stringify(project))
  const fakeBin = path.join(base, 'fakebin')
  fs.mkdirSync(fakeBin)
  fs.writeFileSync(path.join(fakeBin, 'codegraph'), FAKE, { mode: 0o755 })
  const log = path.join(base, 'cg.log')
  const env = {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    WB_HOME: path.join(home, '.wb'),
    CLAUDE_PLUGIN_DATA: path.join(base, 'data'),
    LANG: 'en_US.UTF-8',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    FAKE_CG_LOG: log,
    ...(fake ? { WB_CODEGRAPH: path.join(fakeBin, 'codegraph') } : { WB_CODEGRAPH: 'off' }),
  }
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
  const config = () => resolveConfig({ projectDir: repo, env }).config
  const worktree = (name) => {
    const p = path.join(base, name)
    git(repo, 'worktree', 'add', '-q', '-b', name, p)
    return fs.realpathSync(p)
  }
  const index = (dir) => {
    fs.mkdirSync(path.join(dir, '.codegraph'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.codegraph', 'codegraph.db'), 'fake')
  }
  return { base, repo, env, calls, config, worktree, index, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) }
}

const noStart = (target, opts) => cg.autoQueue(target, { ...opts, start: () => false })
const fail = (repo, sid, extra = {}) => ({ hook_event_name: 'PostToolUseFailure', session_id: sid, cwd: repo, tool_name: 'mcp__codegraph__codegraph_explore', tool_input: { query: 'x', projectPath: repo }, error: `Error: Tool execution failed: CodeGraph not initialized in ${repo}. Run 'codegraph init' in that project first.`, ...extra })
const call = (repo, sid, tool = 'codegraph_explore') => ({ hook_event_name: 'PreToolUse', session_id: sid, cwd: repo, tool_name: `mcp__codegraph__${tool}`, tool_input: { query: 'x', projectPath: repo } })
const bash = (cwd, sid, command) => ({ hook_event_name: 'PreToolUse', session_id: sid, cwd, tool_name: 'Bash', tool_input: { command } })

// ---- parsing ------------------------------------------------------------

test('grepCall: pattern and paths of grep/rg; piped greps and other commands are ignored', () => {
  const one = (s) => cg.grepCall(parse(s, { cwd: '/r', home: '/h' }).find((c) => ['grep', 'rg', 'egrep'].includes(c.name)) || { name: 'x', args: [] })
  assert.deepEqual(one("grep -rn -w 'createWorktree' lib bin"), { patterns: ['createWorktree'], pattern: 'createWorktree', paths: ['lib', 'bin'] })
  assert.deepEqual(one('rg -e foo -g "*.ts" src'), { patterns: ['foo'], pattern: 'foo', paths: ['src'] })
  assert.deepEqual(one('grep -rn --include=*.ts -A 3 useThing .'), { patterns: ['useThing'], pattern: 'useThing', paths: ['.'] })
  assert.equal(one('grep -e a -e b x').pattern, null)
  assert.equal(one('git log | grep fixThing'), null)
  assert.equal(one('ls lib'), null)
  assert.deepEqual(one('LC_ALL=C grep -a -rn makeThing -- lib').paths, ['lib'])
})

test('identifierOf: one function, type or constant name; words, phrases and regexes are not', () => {
  for (const [p, want] of [
    ['createWorktree', 'createWorktree'],
    ['\\bcreateWorktree\\b', 'createWorktree'],
    ['createWorktree\\(', 'createWorktree'],
    ['WorktreeError', 'WorktreeError'],
    ['PLUGIN_ROOT', 'PLUGIN_ROOT'],
    ['make_thing', 'make_thing'],
    ['import', null],
    ['TODO', null],
    ['ERROR', null],
    ['ab', null],
    ['foo bar', null],
    ['create.*Tree', null],
    ['"quoted string"', null],
    [null, null],
  ]) assert.equal(cg.identifierOf(p), want, String(p))
})

test('classify: ok · empty · not initialized · not loaded · other error, with the stale flag', () => {
  assert.deepEqual(cg.classify('## file.ts\nfunction a'), { cls: 'ok', stale: false })
  assert.deepEqual(cg.classify('⚠️ Some files referenced below were edited since the last index sync'), { cls: 'ok', stale: true })
  assert.equal(cg.classify('No results found for "x"').cls, 'empty')
  assert.equal(cg.classify('Callers of x (0 found)').cls, 'empty')
  assert.equal(cg.classify("CodeGraph not initialized in /a. Run 'codegraph init'", true).cls, 'not_initialized')
  assert.equal(cg.classify('No CodeGraph project is loaded. Pass projectPath', true).cls, 'no_project')
  assert.equal(cg.classify('Error: timeout', true).cls, 'error')
  assert.equal(cg.responseText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(cg.responseText({ content: [{ type: 'text', text: 'c' }] }), 'c')
  assert.equal(cg.callPath({ tool_input: {} }, "CodeGraph not initialized in /x/y. Run 'codegraph init'"), '/x/y')
  assert.equal(cg.callPath({ cwd: '/w', tool_input: { projectPath: 'sub' } }), '/w/sub')
  assert.equal(cg.callPath({ tool_input: {} }), '')
  assert.ok(cg.isCodegraphTool('mcp__codegraph__codegraph_callers'))
  assert.ok(cg.isCodegraphTool('mcp__plugin_x_codegraph__codegraph_search'))
  assert.ok(!cg.isCodegraphTool('mcp__other__search'))
})

// ---- deadpath: the second call for a path with no index is blocked ------

test('deadpath: first call goes through, a not-initialized response marks the path, the second call is blocked', () => {
  const f = fixture()
  const sid = 's1'
  assert.equal(judgeDead(call(f.repo, sid), f.env), null)
  const r = recordCall(fail(f.repo, sid), f.env, { queue: noStart })
  assert.equal(r.row.class, 'not_initialized')
  assert.deepEqual(r.notice, { path: f.repo, queued: true })
  const d = judgeDead(call(f.repo, sid, 'codegraph_callers'), f.env)
  assert.equal(d.code, 'codegraph.no_index')
  const out = deadHandle(call(f.repo, sid), f.env)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  const reason = out.hookSpecificOutput.permissionDecisionReason
  assert.match(reason, /has no codegraph index/)
  assert.match(reason, /How to fix: .*index queue.*grep/)
  assert.match(reason, /Where to ask/)
  // another session and another path are not affected
  assert.equal(judgeDead(call(f.repo, 's2'), f.env), null)
  assert.equal(judgeDead(call(f.base, sid), f.env), null)
  // the queue finished the index: the mark is dropped and the call goes through
  f.index(f.repo)
  assert.equal(judgeDead(call(f.repo, sid), f.env), null)
  assert.deepEqual(cg.loadSession(sid, f.env).dead, {})
  f.cleanup()
})

test('deadpath: "not loaded" without projectPath blocks the next call without projectPath; manual fix text when nothing is queued', () => {
  const f = fixture({ project: { codegraph: { auto_index: false } } })
  const input = { hook_event_name: 'PostToolUseFailure', session_id: 's', cwd: f.repo, tool_name: 'mcp__codegraph__codegraph_search', tool_input: { query: 'x' }, error: 'No CodeGraph project is loaded' }
  const r = recordCall(input, f.env, { queue: noStart })
  assert.equal(r.row.class, 'no_project')
  assert.equal(r.notice.queued, false)
  const d = judgeDead({ ...input, hook_event_name: 'PreToolUse' }, f.env)
  assert.equal(d.code, 'codegraph.no_index_manual')
  assert.equal(d.vars.path, f.repo)
  // with projectPath the call is a different path and goes through
  assert.equal(judgeDead(call(f.repo, 's'), f.env), null)
  f.cleanup()
})

test('deadpath hook process: blocks the second call (ko text), passes when codegraph is not involved or input is broken', () => {
  const f = fixture()
  const env = { ...f.env, LANG: 'ko_KR.UTF-8', WB_HOME: f.env.WB_HOME }
  fs.writeFileSync(path.join(env.WB_HOME, 'personal.json'), JSON.stringify({ version: 1, language: 'ko' }))
  const run = (script, input) => spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'scripts', 'codegraph', script)], { input: typeof input === 'string' ? input : JSON.stringify(input), env, encoding: 'utf8' })
  const first = run('deadpath.mjs', call(f.repo, 'p'))
  assert.equal(first.status, 0)
  assert.equal(first.stdout, '')
  // record without starting a real worker: queue is off for this check
  fs.writeFileSync(path.join(f.repo, '.wb', 'config.json'), JSON.stringify({ codegraph: { auto_index: false } }))
  const rec = run('record.mjs', fail(f.repo, 'p'))
  assert.equal(rec.status, 0)
  assert.match(JSON.parse(rec.stdout).hookSpecificOutput.additionalContext, /색인이 없어요/)
  assert.equal(JSON.parse(rec.stdout).hookSpecificOutput.hookEventName, 'PostToolUseFailure')
  const second = run('deadpath.mjs', call(f.repo, 'p'))
  const out = JSON.parse(second.stdout).hookSpecificOutput
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /막았습니다: .*색인이 없어요/)
  assert.match(out.permissionDecisionReason, /grep 과 Read/)
  for (const s of ['deadpath.mjs', 'record.mjs', 'nudge.mjs', 'session-start.mjs']) {
    const bad = run(s, 'not json')
    assert.equal(bad.status, 0, s)
    assert.equal(bad.stdout, '', s)
    const other = run(s, { tool_name: 'Read', tool_input: {}, cwd: f.repo })
    assert.equal(other.status, 0, s)
  }
  f.cleanup()
})

// ---- record: four classes in the metrics file ----------------------------

test('record: every response lands in <main checkout>/.wb/metrics/codegraph.jsonl with its class, also from a worktree', () => {
  const f = fixture()
  const lane = f.worktree('lane1')
  const ok = { hook_event_name: 'PostToolUse', session_id: 'm', cwd: lane, agent_id: 'a1', tool_name: 'mcp__codegraph__codegraph_callers', tool_input: { symbol: 'x', projectPath: lane }, tool_response: [{ type: 'text', text: '## lib/a.mjs\ncreateWorktree' }] }
  recordCall(ok, f.env, { queue: noStart })
  recordCall({ ...ok, tool_response: [{ type: 'text', text: 'No results found for "x"' }] }, f.env, { queue: noStart })
  recordCall(fail(lane, 'm', { cwd: lane, tool_input: { query: 'x', projectPath: lane } }), f.env, { queue: noStart })
  recordCall({ ...ok, hook_event_name: 'PostToolUseFailure', tool_input: { query: 'x' }, tool_response: undefined, error: 'No CodeGraph project is loaded' }, f.env, { queue: noStart })
  recordCall({ ...ok, hook_event_name: 'PostToolUseFailure', tool_response: undefined, error: 'Error: socket closed' }, f.env, { queue: noStart })
  recordCall({ ...ok, tool_response: { content: [{ type: 'text', text: '⚠️ Some files referenced below were edited since the last index sync\nx' }] } }, f.env, { queue: noStart })
  const file = path.join(f.repo, '.wb', 'metrics', 'codegraph.jsonl')
  assert.ok(fs.existsSync(file))
  assert.ok(!fs.existsSync(path.join(lane, '.wb', 'metrics')))
  const rows = cg.readMetrics(file)
  assert.deepEqual(rows.map((r) => r.class), ['ok', 'empty', 'not_initialized', 'no_project', 'error', 'ok'])
  assert.deepEqual(rows.map((r) => r.stale), [false, false, false, false, false, true])
  assert.deepEqual(Object.keys(rows[0]).sort(), ['agent', 'class', 'path', 'project_path', 'session', 'stale', 'tool', 'ts'])
  assert.equal(rows[0].agent, 'a1')
  assert.equal(rows[0].tool, 'codegraph_callers')
  assert.equal(rows[3].project_path, false)
  const s = cg.summarize(rows)
  assert.deepEqual(s.counts, { ok: 2, empty: 1, not_initialized: 1, no_project: 1, error: 1 })
  assert.equal(s.error_rate, 0.5)
  // the metrics folder stays out of git status
  assert.match(fs.readFileSync(path.join(f.repo, '.git', 'info', 'exclude'), 'utf8'), /^\.wb\/metrics\/$/m)
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'wb-index'), 'metrics', '--json'], { cwd: lane, env: f.env, encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).total, 6)
  f.cleanup()
})

test('record: a later ok response for a marked path clears the mark', () => {
  const f = fixture()
  recordCall(fail(f.repo, 'c'), f.env, { queue: noStart })
  assert.ok(Object.hasOwn(cg.loadSession('c', f.env).dead, f.repo))
  recordCall({ hook_event_name: 'PostToolUse', session_id: 'c', cwd: f.repo, tool_name: 'mcp__codegraph__codegraph_status', tool_input: { projectPath: f.repo }, tool_response: 'Files indexed: 3' }, f.env, { queue: noStart })
  assert.deepEqual(cg.loadSession('c', f.env).dead, {})
  f.cleanup()
})

// ---- nudge: once per session, only for an identifier in an indexed checkout --

test('nudge: an identifier grep in an indexed checkout gets one note per session', () => {
  const f = fixture()
  f.index(f.repo)
  const q = []
  const deps = { queue: (t) => (q.push(t), { queued: true }) }
  const first = judgeNudge(bash(f.repo, 'n1', 'grep -rn createWorktree lib'), f.env, deps)
  assert.equal(first.ident, 'createWorktree')
  assert.equal(first.root, f.repo)
  assert.equal(judgeNudge(bash(f.repo, 'n1', 'grep -rn createWorktree lib'), f.env, deps), null)
  assert.equal(judgeNudge(bash(f.repo, 'n1', "rg -w 'OtherThing' ."), f.env, deps), null)
  // a new session gets it again; the Grep tool counts too
  assert.equal(judgeNudge({ session_id: 'n2', cwd: f.repo, tool_name: 'Grep', tool_input: { pattern: '\\bmakeThing\\b', path: 'lib' } }, f.env, deps).ident, 'makeThing')
  // no note for words, phrases, regexes, piped greps and non-search commands
  for (const c of ['grep -rn import lib', 'grep -rn "two words" lib', 'grep -rn "a.*b" lib', 'git log | grep fixThing', 'ls lib', 'cat lib/a.mjs']) {
    assert.equal(judgeNudge(bash(f.repo, `w-${c}`, c), f.env, deps), null, c)
  }
  assert.deepEqual(q, [])
  f.cleanup()
})

test('nudge: off by setting, silent without codegraph; an unindexed checkout is queued once instead', () => {
  const f = fixture({ project: { codegraph: { nudge: 'off' } } })
  f.index(f.repo)
  assert.equal(judgeNudge(bash(f.repo, 'o', 'grep -rn createWorktree lib'), f.env), null)
  const g = fixture({ fake: false })
  g.index(g.repo)
  assert.equal(judgeNudge(bash(g.repo, 'o', 'grep -rn createWorktree lib'), g.env), null)
  const h = fixture()
  const q = []
  const deps = { queue: (t, o) => (q.push([t, o.reason]), { queued: true }) }
  assert.equal(judgeNudge(bash(h.repo, 'u', 'grep -rn createWorktree lib'), h.env, deps), null)
  assert.equal(judgeNudge(bash(h.repo, 'u', 'grep -rn otherThing .'), h.env, deps), null)
  assert.deepEqual(q, [[h.repo, 'grep']])
  // outside any git checkout nothing happens
  assert.equal(judgeNudge(bash(h.base, 'u', 'grep -rn createWorktree .'), h.env, deps), null)
  assert.equal(q.length, 1)
  for (const x of [f, g, h]) x.cleanup()
})

test('nudge hook process: prints the note once as additionalContext', () => {
  const f = fixture()
  f.index(f.repo)
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'scripts', 'codegraph', 'nudge.mjs')], { input: JSON.stringify(bash(f.repo, 'proc', 'grep -rn createWorktree lib')), env: f.env, encoding: 'utf8' })
  const a = run()
  assert.equal(a.status, 0)
  const ctx = JSON.parse(a.stdout).hookSpecificOutput
  assert.equal(ctx.hookEventName, 'PreToolUse')
  assert.equal(ctx.permissionDecision, undefined)
  assert.match(ctx.additionalContext, /codegraph_callers/)
  assert.equal(run().stdout, '')
  f.cleanup()
})

// ---- queue and worker ----------------------------------------------------

test('queue: one entry per checkout, nothing without codegraph or outside git', () => {
  const f = fixture()
  const r = cg.enqueue(path.join(f.repo, 'lib'), { env: f.env })
  assert.deepEqual(r, { queued: true, path: f.repo })
  assert.equal(cg.enqueue(f.repo, { env: f.env }).skipped, 'already')
  assert.equal(cg.enqueue(f.base, { env: f.env }).skipped, 'not-git')
  assert.equal(cg.enqueue(f.repo, { env: { ...f.env, WB_CODEGRAPH: 'off' } }).skipped, 'missing')
  assert.equal(cg.autoQueue(f.repo, { config: { project: { codegraph: { auto_index: false } } }, env: f.env }).skipped, 'disabled')
  assert.equal(cg.readQueue(f.env).items.length, 1)
  assert.ok(cg.dequeue(f.repo, f.env))
  assert.equal(cg.readQueue(f.env).items.length, 0)
  f.cleanup()
})

test('worker: init where nothing can be copied, copy + sync for a second worktree, sync when indexed, one job at a time in a heavy slot', async () => {
  const f = fixture()
  const lane = f.worktree('lane2')
  cg.enqueue(f.repo, { env: f.env })
  cg.enqueue(lane, { env: f.env })
  const waits = []
  const r = await cg.runWorker({ env: f.env, pollMs: 5, log: (k, v) => k === 'wait' && waits.push(v) })
  assert.equal(r.busy, false)
  assert.deepEqual(r.done.map((d) => [d.path, d.method]), [[f.repo, 'init'], [lane, 'copy']])
  assert.equal(r.done[1].seed, f.repo)
  // the copied index is the main one; only sync ran in the worktree (no init there)
  assert.deepEqual(f.calls(), [`init ${f.repo}`, `status ${lane}`, `sync ${lane}`])
  assert.equal(fs.readFileSync(path.join(lane, '.codegraph', 'codegraph.db'), 'utf8'), `fake:${f.repo}`)
  assert.ok(!fs.existsSync(path.join(lane, '.codegraph', 'daemon.pid')))
  // the index never makes a worktree dirty
  assert.equal(git(lane, 'status', '--porcelain'), '')
  assert.match(fs.readFileSync(path.join(f.repo, '.git', 'info', 'exclude'), 'utf8'), /^\.codegraph\/$/m)
  // queue empty, history kept, slots released
  const q = cg.readQueue(f.env)
  assert.deepEqual(q.items, [])
  assert.deepEqual(q.history.map((h) => h.method), ['init', 'copy'])
  assert.deepEqual(fs.readdirSync(path.join(f.base, 'slots', 'heavy')), [])
  // indexed already → sync; a folder that disappeared → gone
  cg.enqueue(lane, { env: f.env })
  const gone = f.worktree('lane3')
  cg.enqueue(gone, { env: f.env })
  fs.rmSync(gone, { recursive: true, force: true })
  const r2 = await cg.runWorker({ env: f.env, pollMs: 5 })
  assert.deepEqual(r2.done.map((d) => d.method), ['sync', 'gone'])
  f.cleanup()
})

test('worker: a broken copy falls back to init; a failing init is recorded; a second worker does not start', async () => {
  const f = fixture()
  const lane = f.worktree('lane4')
  // seed exists but "status" will say the copy is not initialized (empty db file name mismatch)
  f.index(f.repo)
  fs.rmSync(path.join(f.repo, '.codegraph', 'codegraph.db'))
  fs.mkdirSync(path.join(f.repo, '.codegraph', 'codegraph.db'))
  const r = cg.indexOne(lane, { env: f.env })
  assert.equal(r.method, 'init')
  const fails = cg.indexOne(f.worktree('lane5'), { env: { ...f.env, FAKE_CG_FAIL_INIT: '1' }, run: (bin, args, o) => cg.defaultRun(bin, args, { ...o, env: { ...f.env, FAKE_CG_FAIL_INIT: '1' } }) })
  assert.equal(fails.method, 'failed')
  assert.match(fails.error, /boom/)
  // a live worker holds the lock
  const dir = cg.queueDir(f.env)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'worker.pid'), String(process.ppid))
  cg.enqueue(f.repo, { env: f.env })
  const busy = await cg.runWorker({ env: f.env, pollMs: 5 })
  assert.equal(busy.busy, true)
  assert.equal(cg.workerPid(f.env), process.ppid)
  assert.equal(cg.startWorker(f.env), false)
  f.cleanup()
})

test('worker waits for the load threshold through the heavy slot', async () => {
  const f = fixture()
  cg.enqueue(f.repo, { env: f.env })
  fs.writeFileSync(path.join(f.env.WB_HOME, 'machine.json'), JSON.stringify({ load: { max: 20 }, slots: { lease_dir: path.join(f.base, 'slots') } }))
  const loads = [30, 25, 10]
  const waits = []
  const r = await cg.runWorker({ env: f.env, pollMs: 1, log: (k, v) => k === 'wait' && waits.push(v.reason), slotDeps: { now: () => Date.now(), loadavg: () => loads.shift() ?? 10, pidAlive: () => true, sleep: async () => {} } })
  assert.deepEqual(waits, ['load', 'load'])
  assert.deepEqual(r.done.map((d) => d.method), ['init'])
  f.cleanup()
})

// ---- worktree hook-up ----------------------------------------------------

test('worktree create queues the new checkout; remove drops the index and the queue entry', async () => {
  const f = fixture()
  const resolved = resolveConfig({ projectDir: f.repo, env: f.env })
  const queued = []
  const ctx = { cwd: f.repo, env: f.env, resolved, config: resolved.config, portDeps: { listening: () => new Set() }, pollMs: 5, log: () => {} }
  const r = await wt.createWorktree({ ...ctx, queueIndex: (p, o) => (queued.push([p, o.reason]), noStart(p, o)) }, { id: 'l1' })
  assert.deepEqual(queued, [[r.worktree, 'worktree']])
  assert.deepEqual(r.index, { queued: true, path: r.worktree })
  const h = await wt.createWorktree({ ...ctx, queueIndex: (p, o) => (queued.push([p, o.reason]), { skipped: 'x' }) }, { id: 'h1', hookStyle: true, register: false })
  assert.equal(queued[1][1], 'worktree-hook')
  assert.equal(h.index.skipped, 'x')
  // an index the exclude file does not know about still does not block removal
  f.index(r.worktree)
  fs.writeFileSync(path.join(r.worktree, '.codegraph', '.gitignore'), '*.db\n')
  assert.match(git(r.worktree, 'status', '--porcelain'), /\?\? \.codegraph\//)
  const rm = wt.removeWorktree({ ...ctx, procsIn: () => [] }, { target: 'l1' })
  assert.equal(rm.worktree, r.worktree)
  assert.ok(!fs.existsSync(r.worktree))
  assert.ok(!cg.readQueue(f.env).items.some((i) => i.path === r.worktree))
  // real uncommitted work still blocks
  const l2 = await wt.createWorktree({ ...ctx, queueIndex: () => ({ skipped: 'x' }) }, { id: 'l2' })
  f.index(l2.worktree)
  fs.writeFileSync(path.join(l2.worktree, 'work.txt'), 'x')
  assert.throws(() => wt.removeWorktree({ ...ctx, procsIn: () => [] }, { target: 'l2' }), (e) => e.code === 'wt.dirty' && e.vars.count === 1)
  // auto_index off and codegraph missing both skip quietly
  const off = await wt.createWorktree({ ...ctx, config: { ...ctx.config, project: { ...ctx.config.project, codegraph: { auto_index: false } } } }, { id: 'l3' })
  assert.equal(off.index.skipped, 'disabled')
  const missing = await wt.createWorktree({ ...ctx, env: { ...f.env, WB_CODEGRAPH: 'off' } }, { id: 'l4' })
  assert.equal(missing.index.skipped, 'missing')
  f.cleanup()
})

// ---- leftovers and doctor -------------------------------------------------

test('orphans: an index in a folder that is no longer a worktree is listed with its size and removed alone with --apply', () => {
  const f = fixture()
  const left = path.join(f.base, 'wt-old')
  fs.mkdirSync(path.join(left, 'src'), { recursive: true })
  f.index(left)
  const live = f.worktree('wt-live')
  f.index(live)
  const s = cg.scanIndexes(f.repo, f.config(), f.env)
  assert.deepEqual(s.orphans.map((o) => o.path), [left])
  assert.equal(s.orphans[0].bytes, 4)
  assert.deepEqual(s.indexed.map((i) => i.path), [live])
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'wb-index'), 'orphans', '--apply', '--json'], { cwd: f.repo, env: f.env, encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).orphans[0].removed, true)
  assert.ok(!fs.existsSync(path.join(left, '.codegraph')))
  assert.ok(fs.existsSync(path.join(left, 'src')))
  assert.ok(fs.existsSync(path.join(live, '.codegraph')))
  f.cleanup()
})

test('doctor: index, queue and leftover checks appear only when codegraph is installed', () => {
  const f = fixture()
  const ids = (env) => doctor(f.repo, env).checks.map((c) => `${c.id}:${c.status}`)
  assert.deepEqual(ids(f.env).filter((x) => x.startsWith('codegraph')), ['codegraph:ok', 'codegraphIndex:warn', 'codegraphQueue:ok', 'codegraphOrphans:ok'])
  f.index(f.repo)
  assert.ok(ids(f.env).includes('codegraphIndex:ok'))
  assert.deepEqual(ids({ ...f.env, WB_CODEGRAPH: 'off' }).filter((x) => x.startsWith('codegraph')), ['codegraph:warn'])
  const out = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'wb-config'), 'doctor'], { cwd: f.repo, env: f.env, encoding: 'utf8' })
  assert.match(out.stdout, /codegraph index of this checkout: ok/)
  assert.match(out.stdout, /index queue: ok — waiting 0/)
  f.cleanup()
})

test('wb-index CLI: without codegraph it explains how to install and queues nothing; add/status/drop round trip', () => {
  const f = fixture()
  const run = (env, ...a) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'wb-index'), ...a], { cwd: f.repo, env, encoding: 'utf8' })
  const missing = run({ ...f.env, WB_CODEGRAPH: path.join(f.base, 'nope') }, 'add')
  assert.equal(missing.status, 3)
  assert.match(missing.stderr, /not installed/)
  assert.equal(run({ ...f.env, WB_CODEGRAPH: 'off' }, 'add').status, 0)
  assert.equal(cg.readQueue(f.env).items.length, 0)
  const add = run(f.env, 'add', '--no-start', '--json')
  assert.equal(add.status, 0, add.stderr)
  assert.equal(JSON.parse(add.stdout).queued, true)
  assert.equal(JSON.parse(run(f.env, 'status', '--json').stdout).items[0].path, f.repo)
  f.index(f.repo)
  assert.match(run(f.env, 'drop', f.repo).stdout, /1 queue entries removed, 1 indexes deleted/)
  assert.ok(!fs.existsSync(path.join(f.repo, '.codegraph')))
  const done = run(f.env, 'add', '--no-start')
  assert.match(done.stdout, /Added to the index queue/)
  const work = run(f.env, 'run')
  assert.equal(work.status, 0, work.stderr)
  assert.match(work.stdout, /Indexed: .* \(init, /)
  f.cleanup()
})

// ---- wiring --------------------------------------------------------------

test('wiring: hooks.json events and matchers, executables, catalog rules and messages', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks
  const find = (ev, script) => (h[ev] || []).find((e) => e.hooks.some((x) => x.command.endsWith(`codegraph/${script}`)))
  assert.equal(find('PreToolUse', 'nudge.mjs').matcher, 'Bash|Grep')
  for (const [ev, s] of [['PreToolUse', 'deadpath.mjs'], ['PostToolUse', 'record.mjs'], ['PostToolUseFailure', 'record.mjs']]) {
    const m = new RegExp(`^(?:${find(ev, s).matcher})$`)
    assert.ok(m.test('mcp__codegraph__codegraph_explore'), `${ev} ${s}`)
    assert.ok(!m.test('Bash'), `${ev} ${s}`)
  }
  assert.ok(find('SessionStart', 'session-start.mjs'))
  for (const p of ['bin/wb-index', ...['nudge', 'deadpath', 'record', 'session-start'].map((s) => `hooks/scripts/codegraph/${s}.mjs`)]) {
    assert.ok(fs.statSync(path.join(ROOT, p)).mode & 0o111, p)
  }
  const rules = loadCatalog()
  for (const id of ['codegraph-first', 'codegraph-index-first']) {
    const r = rules.find((x) => x.id === id)
    assert.notEqual(r.group, 'planned', id)
    assert.ok(r.enforced.every((e) => e.kind !== 'planned'), id)
  }
  const ko = messages('ko')
  const en = messages('en')
  for (const k of Object.keys(en).filter((k) => /^(cg\.|safety\.codegraph\.|doctor\.codegraph|wt\.index)/.test(k))) assert.ok(ko[k], k)
  for (const lang of ['ko', 'en']) {
    const md = fs.readFileSync(path.join(ROOT, 'rules', `codegraph.${lang}.md`), 'utf8')
    assert.match(md, /grep/)
    assert.match(md, /projectPath/)
    assert.ok(md.length < 2000)
  }
})

// ---- the real tool: copying an index between worktrees -------------------

const realBin = cg.findBin({ PATH: process.env.PATH })
test('real codegraph: an index copied from the main checkout opens in a new worktree and sync adds only the changes', { skip: !realBin && 'codegraph not installed' }, async () => {
  const f = fixture()
  const env = { ...f.env, WB_CODEGRAPH: realBin, PATH: process.env.PATH }
  const lane = f.worktree('lane-real')
  fs.writeFileSync(path.join(lane, 'lib', 'b.mjs'), 'export function laneOnlyThing() { return 2 }\n')
  cg.enqueue(f.repo, { env })
  cg.enqueue(lane, { env })
  const r = await cg.runWorker({ env, pollMs: 5 })
  assert.deepEqual(r.done.map((d) => d.method), ['init', 'copy'])
  const q = (dir, s) => spawnSync(realBin, ['query', s, '-p', dir], { encoding: 'utf8', env }).stdout
  assert.match(q(lane, 'laneOnlyThing'), /lib\/b\.mjs/)
  assert.match(q(lane, 'createWorktree'), /lib\/a\.mjs/)
  assert.doesNotMatch(q(f.repo, 'laneOnlyThing'), /lib\/b\.mjs/)
  const status = JSON.parse(spawnSync(realBin, ['status', '--json', lane], { encoding: 'utf8', env }).stdout)
  assert.equal(status.initialized, true)
  assert.equal(status.fileCount, 2)
  assert.equal(git(lane, 'status', '--porcelain'), '?? lib/b.mjs')
  f.cleanup()
})
