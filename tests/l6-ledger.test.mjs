// L6: lane ledger, hooks, board, resume, number reservation, case and defect ledgers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, makeEnv, runScript, bin, git } from './l3-fixture.mjs'
import * as W from '../lib/waves.mjs'
import { boardRows, renderBoard, statusLine } from '../lib/board.mjs'
import { buildResume, resumePrompt } from '../lib/resume.mjs'
import * as N from '../lib/numbers.mjs'
import * as C from '../lib/cases.mjs'
import { upsertLane, readLanes } from '../lib/ledger.mjs'
import { translator } from '../lib/i18n.mjs'
import { handle as dispatch } from '../hooks/scripts/dispatch/dispatch-guard.mjs'

const t = translator('en')
const tko = translator('ko')
const tmp = () => {
  const fx = makeEnv()
  const sd = path.join(fx.base, 'state')
  fs.mkdirSync(sd)
  return { ...fx, sd }
}
const T0 = Date.parse('2026-10-16T01:00:00Z')

test('wave and lane ledger: create, status, todo, verify, return; ids validated', () => {
  const { sd } = tmp()
  W.initWave(sd, { id: 'w1', title: 'Wave one', base_ref: 'main' })
  assert.throws(() => W.initWave(sd, { id: 'w1' }), (e) => e.code === 'waves.wave_exists')
  assert.throws(() => W.initWave(sd, { id: 'bad id' }), (e) => e.code === 'waves.bad_id')
  W.addLane(sd, 'w1', { lane: 'l1', task: 'implement', model: 'opus', todos: ['a', 'b'] })
  assert.throws(() => W.addLane(sd, 'w1', { lane: 'l1' }), (e) => e.code === 'waves.lane_exists')
  assert.throws(() => W.addLane(sd, 'nope', { lane: 'x' }), (e) => e.code === 'waves.no_wave')
  W.setTodo(sd, 'w1', 'l1', 1, true)
  W.addTodo(sd, 'w1', 'l1', 'c')
  W.addVerification(sd, 'w1', 'l1', 'unit', 'pass')
  assert.throws(() => W.addVerification(sd, 'w1', 'l1', 'x', 'maybe'), (e) => e.code === 'waves.bad_result')
  W.setStatus(sd, 'w1', 'l1', 'running', 'go')
  assert.throws(() => W.setStatus(sd, 'w1', 'l1', 'weird'), (e) => e.code === 'waves.bad_status')
  const l = W.readWaves(sd).waves[0].lanes[0]
  assert.equal(l.todos.length, 3)
  assert.equal(l.todos[0].done, true)
  assert.equal(l.status, 'running')
  const r = W.addReturn(sd, 'w1', 'l1', 'fix lint')
  assert.equal(r.returns, 1)
  assert.equal(r.status, 'pending')
  assert.ok(W.readMetrics(sd).some((m) => m.event === 'return' && m.returns === 1))
})

test('concurrent writers do not lose lane updates (lock)', async () => {
  const { sd } = tmp()
  W.initWave(sd, { id: 'w', title: 'w' })
  for (let i = 0; i < 4; i++) W.addLane(sd, 'w', { lane: `l${i}` })
  const { spawn } = await import('node:child_process')
  const run = (i) => new Promise((res) => spawn(process.execPath, ['--input-type=module', '-e', `import * as W from ${JSON.stringify(path.join(ROOT, 'lib/waves.mjs'))}; for (let k=0;k<5;k++) W.addNote(${JSON.stringify(sd)}, 'w', 'l${i}', 'n'+k)`]).on('exit', res))
  await Promise.all([0, 1, 2, 3].map(run))
  for (const l of W.readWaves(sd).waves[0].lanes) assert.equal(l.notes.length, 5)
})

function transcript(file, rows) {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

test('dispatch -> SubagentStart -> SubagentStop: binds agent, counts rounds/returns/tokens, writes metrics and lanes.json agent_id', () => {
  const { sd, base } = tmp()
  W.initWave(sd, { id: 'w', title: 'w' })
  W.addLane(sd, 'w', { lane: 'l1' })
  upsertLane(sd, { id: 'l1', branch: 'lanekeeper/x/l1', worktree: base, integration: 'lanekeeper/x/int' })
  W.recordDispatch(sd, { agent_type: 'general-purpose', lane: 'l1', task: 'implement', model: 'opus', source: 'marker', files: [] }, T0)
  const s = W.onSubagentStart(sd, { agent_id: 'a1', agent_type: 'general-purpose' }, T0 + 1000)
  assert.deepEqual(s, { lane: 'l1', wave: 'w' })
  assert.equal(readLanes(sd).lanes[0].agent_id, 'a1')
  assert.equal(W.readWaves(sd).waves[0].lanes[0].status, 'running')
  const tr = path.join(base, 'a1.jsonl')
  transcript(tr, [
    { type: 'user', message: {} },
    { type: 'assistant', message: { id: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 } } },
    { type: 'assistant', message: { id: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 9, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 } } },
    { type: 'assistant', message: { id: 'm2', model: 'claude-opus-4-8', usage: { input_tokens: 1, output_tokens: 2 } } },
  ])
  const e = W.onSubagentStop(sd, { agent_id: 'a1', agent_type: 'general-purpose', agent_transcript_path: tr }, T0 + 60000)
  assert.deepEqual(e.tokens, { input: 11, output: 11, cache_read: 100, cache_creation: 7 })
  let l = W.readWaves(sd).waves[0].lanes[0]
  assert.equal(l.status, 'review')
  assert.equal(l.rounds, 1)
  assert.equal(l.returns, 0)
  assert.equal(l.model, 'opus')
  // re-dispatch after review counts one return
  W.recordDispatch(sd, { agent_type: 'general-purpose', lane: 'l1', task: 'fix', model: 'opus' }, T0 + 120000)
  W.onSubagentStart(sd, { agent_id: 'a2', agent_type: 'general-purpose' }, T0 + 121000)
  l = W.readWaves(sd).waves[0].lanes[0]
  assert.equal(l.returns, 1)
  assert.equal(l.rounds, 2)
  const m = W.readMetrics(sd).filter((x) => x.event === 'start' || x.event === 'stop')
  assert.deepEqual(m.map((x) => x.event), ['start', 'stop', 'start'])
  assert.equal(m[0].task, 'implement')
  assert.equal(m[0].classification, 'marker')
  assert.equal(m[1].actual_model, 'claude-opus-4-8')
  assert.equal(m[1].tokens.output, 11)
})

test('unmatched agent is logged without a lane; stale pending dispatch is dropped; unreadable transcript gives zero tokens', () => {
  const { sd } = tmp()
  W.recordDispatch(sd, { agent_type: 'Explore', lane: 'l9' }, T0)
  const s = W.onSubagentStart(sd, { agent_id: 'x', agent_type: 'general-purpose' }, T0 + W.PENDING_TTL_MS + 1)
  assert.equal(s.lane, null)
  const e = W.onSubagentStop(sd, { agent_id: 'x', agent_type: 'general-purpose', agent_transcript_path: '/nonexistent' }, T0 + W.PENDING_TTL_MS + 2)
  assert.deepEqual(e.tokens, { input: 0, output: 0, cache_read: 0, cache_creation: 0 })
  assert.equal(W.readDispatch(sd).pending.length, 0)
  assert.equal(W.readMetrics(sd).filter((m) => m.event === 'stop')[0].tracked, true)
  assert.equal(W.onSubagentStop(sd, { agent_id: 'never' }, T0).lane, null)
})

test('dispatch guard remembers an allowed dispatch and hands it to the SubagentStart hook process', () => {
  const { sd, env, repo, base } = tmp()
  const brief = '<!-- lanekeeper:brief type=implement lane=l1 -->\n'
  const r = dispatch({ tool_name: 'Agent', tool_input: { prompt: brief, subagent_type: 'general-purpose', model: 'opus' }, cwd: repo }, env, { stateDir: sd, notify() {} })
  // the brief is incomplete (denied) so nothing is remembered
  assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(W.readDispatch(sd).pending.length, 0)
  const ok = dispatch({ tool_name: 'Agent', tool_input: { prompt: 'x', subagent_type: 'Explore' }, cwd: repo }, env, { stateDir: sd, notify() {}, resolved: undefined })
  assert.ok(ok === null || ok.hookSpecificOutput)
  // hook process: SubagentStart then SubagentStop with state in the repo's git dir
  W.initWave(path.join(repo, '.git', 'lanekeeper'), { id: 'w' })
  W.addLane(path.join(repo, '.git', 'lanekeeper'), 'w', { lane: 'l1' })
  W.recordDispatch(path.join(repo, '.git', 'lanekeeper'), { agent_type: 'general-purpose', lane: 'l1', task: 'implement', model: 'opus' })
  const a = runScript('hooks/scripts/ledger/subagent.mjs', { hook_event_name: 'SubagentStart', agent_id: 'p1', agent_type: 'general-purpose', cwd: repo }, env)
  assert.equal(a.status, 0)
  const tr = path.join(base, 'p1.jsonl')
  transcript(tr, [{ type: 'assistant', message: { id: 'z', model: 'm', usage: { input_tokens: 3, output_tokens: 4 } } }])
  const b = runScript('hooks/scripts/ledger/subagent.mjs', { hook_event_name: 'SubagentStop', agent_id: 'p1', agent_type: 'general-purpose', agent_transcript_path: tr, cwd: repo }, env)
  assert.equal(b.status, 0)
  const l = W.readWaves(path.join(repo, '.git', 'lanekeeper')).waves[0].lanes[0]
  assert.equal(l.status, 'review')
  assert.equal(l.tokens.output, 4)
})

test('dispatch guard stores the brief file hash with the dispatch', () => {
  const { sd, env, repo } = tmp()
  const briefs = path.join(repo, '.lanekeeper', 'briefs')
  fs.mkdirSync(briefs, { recursive: true })
  const tpl = fs.readFileSync(path.join(ROOT, 'templates', 'briefs', 'en', 'impl.md'), 'utf8')
    .replace(/\{\{\s*lane\s*\}\}/g, 'l1').replace(/\{\{\s*base_sha\s*\}\}/g, '1a2b3c4d').replace(/\{\{\s*implementer\s*\}\}/g, 'opus').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, 'x-$1')
  fs.writeFileSync(path.join(briefs, 'l1.md'), tpl)
  dispatch({ tool_name: 'Agent', tool_input: { prompt: `Read ${path.join(briefs, 'l1.md')} and do it.`, subagent_type: 'general-purpose', model: 'opus' }, cwd: repo }, env, { stateDir: sd, notify() {} })
  const p = W.readDispatch(sd).pending
  assert.equal(p.length, 1)
  assert.equal(p[0].lane, 'l1')
  assert.equal(p[0].task, 'impl-multi')
  assert.equal(p[0].source, 'marker')
  assert.match(p[0].briefs[0].sha256, /^[0-9a-f]{64}$/)
})

function threeLanes(sd, base) {
  W.initWave(sd, { id: 'w4', title: 'Wave four' })
  for (const [l, o] of [['l6', { task: 'implement', model: 'sonnet', todos: ['x', 'y'] }], ['l12', { task: 'implement', model: 'opus', todos: ['z'] }], ['l7', { task: 'review', model: 'opus' }]]) W.addLane(sd, 'w4', { lane: l, ...o })
  upsertLane(sd, { id: 'l6', branch: 'lanekeeper/x/l6', worktree: path.join(base, 'gone'), integration: 'lanekeeper/x/int' })
  W.setStatus(sd, 'w4', 'l6', 'running')
  W.setTodo(sd, 'w4', 'l6', 1, true)
  W.recordDispatch(sd, { agent_type: 'general-purpose', lane: 'l12', task: 'implement', model: 'opus' })
  W.onSubagentStart(sd, { agent_id: 'a12', agent_type: 'general-purpose' })
  W.addVerification(sd, 'w4', 'l12', 'unit', 'pass')
  W.addVerification(sd, 'w4', 'l12', 'lint', 'fail')
  W.setStatus(sd, 'w4', 'l7', 'blocked')
}

test('board: three virtual lanes render a table with status, runs/returns, to-do, checks and a live marker (ko and en)', () => {
  const { sd, base } = tmp()
  threeLanes(sd, base)
  const rows = boardRows(sd)
  assert.equal(rows.length, 3)
  assert.equal(rows.find((r) => r.lane === 'l12').agent_live, true)
  assert.equal(rows.find((r) => r.lane === 'l6').worktree_exists, false)
  const en = renderBoard(rows, t)
  const lines = en.split('\n')
  assert.match(lines[0], /^wave\/lane\s+Status\s+Model\s+Task\s+Runs\/returns/)
  assert.match(lines.find((l) => l.startsWith('w4/l12')), /running\*\s+opus\s+implement\s+1\/0\s+0\/1\s+1\/1/)
  assert.match(lines.find((l) => l.startsWith('w4/l6')), /running\s+sonnet\s+implement\s+0\/0\s+1\/2/)
  assert.match(lines.find((l) => l.startsWith('w4/l7')), /blocked/)
  assert.match(en, /running 2/)
  const ko = renderBoard(rows, tko)
  assert.match(ko, /상태/)
  assert.match(ko, /진행\*/)
  assert.match(ko, /막힘/)
  assert.equal(renderBoard([], t), t('board.empty'))
})

test('status line is one line with live/max and open lanes', () => {
  const { sd, base } = tmp()
  threeLanes(sd, base)
  const line = statusLine(boardRows(sd), t, 3)
  assert.equal(line.includes('\n'), false)
  assert.match(line, /^lanekeeper 1\/3 running · /)
  assert.match(line, /l12:running/)
  assert.equal(statusLine([], t), t('board.statusline.none'))
})

test('resume report: progress, git, lane verdicts, stale items, re-dispatch prompt', () => {
  const { sd, repo, base } = tmp()
  fs.writeFileSync(path.join(repo, 'progress.md'), '# progress\n\n## newest\nnext: do x\n\n## older\nold\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'add progress')
  threeLanes(sd, base)
  const stray = path.join(base, 'stray')
  git(repo, 'worktree', 'add', '-q', '-b', 'stray', stray)
  const rep = buildResume({ cwd: repo, state: sd, now: Date.now() + 3600_000 })
  assert.match(rep.progress.excerpt, /next: do x/)
  assert.match(rep.progress.excerpt, /^old$/m, 'a current-state file is shown whole')
  assert.deepEqual([rep.progress.lines, rep.progress.max, rep.progress.over, rep.progress.archive], [7, 300, false, 'docs/progress-archive'])
  assert.ok(!rep.stale.some((s) => s.code === 'progress_oversize'))
  assert.equal(rep.git.log[0].subject, 'add progress')
  assert.ok(rep.git.worktrees.length >= 2)
  const v = Object.fromEntries(rep.lanes.map((l) => [l.lane, l.verdict]))
  assert.equal(v.l6, 'dead') // running, idle for an hour, no agent
  assert.equal(v.l12, 'live')
  assert.equal(v.l7, 'blocked')
  const codes = rep.stale.map((s) => s.code)
  assert.ok(codes.includes('lane_dead'))
  assert.ok(codes.includes('worktree_missing'))
  assert.ok(codes.includes('worktree_unregistered'))
  assert.ok(rep.next.some((n) => n.lane === 'l6' && n.action === 'redispatch'))
  const l6 = rep.lanes.find((l) => l.lane === 'l6')
  assert.deepEqual(l6.remaining, ['y'])
  const p = resumePrompt(l6, t)
  assert.match(p, /lane l6 of wave w4/)
  assert.match(p, /- y/)
  // fresh activity is "recent", not stale
  const fresh = buildResume({ cwd: repo, state: sd })
  assert.equal(fresh.lanes.find((l) => l.lane === 'l6').verdict, 'recent')
  assert.ok(!fresh.stale.some((s) => s.code === 'lane_dead'))
})

test('resume reports a stale progress.md and works without a ledger', () => {
  const { repo } = tmp()
  fs.writeFileSync(path.join(repo, 'progress.md'), '# p\n')
  const old = new Date(Date.now() - 86400_000)
  fs.utimesSync(path.join(repo, 'progress.md'), old, old)
  const rep = buildResume({ cwd: repo, state: null })
  assert.ok(rep.stale.some((s) => s.code === 'progress_stale'))
  assert.equal(buildResume({ cwd: repo, state: null, progressFile: 'none.md' }).stale[0].code, 'progress_missing')
})

test('resume: an oversized progress.md is a stale item and shows only its newest section; the CLI names the archive', () => {
  const { repo, env } = tmp()
  const body = '# progress\n\n## newest\nnext: do x\n\n## older\nold\n' + Array.from({ length: 30 }, (_, i) => `- ${i}`).join('\n') + '\n'
  fs.writeFileSync(path.join(repo, 'progress.md'), body)
  const rep = buildResume({ cwd: repo, state: null, maxLines: 20, archiveDir: 'docs/hist' })
  assert.equal(rep.progress.over, true)
  assert.doesNotMatch(rep.progress.excerpt, /^old$/m)
  const s = rep.stale.find((x) => x.code === 'progress_oversize')
  assert.deepEqual(s.vars, { file: 'progress.md', lines: 37, max: 20, archive: 'docs/hist' })
  assert.match(t('resume.stale.progress_oversize', s.vars), /lanekeeper-waves handoff migrate/)
  fs.mkdirSync(path.join(env.LANEKEEPER_HOME), { recursive: true })
  fs.writeFileSync(path.join(env.LANEKEEPER_HOME, 'personal.json'), JSON.stringify({ version: 1, handoff: { max_lines: 20 } }))
  const out = bin('lanekeeper-waves', ['resume'], env, repo).stdout
  assert.match(out, /37\/20 lines\. Past history is in `docs\/progress-archive\/`/)
  assert.match(out, /grep -n '<keyword>' docs\/progress-archive\/\*\.md/)
  assert.match(out, /has 37 lines, over the 20-line target/)
})

test('lanekeeper-waves CLI: create, status, todo, board, metrics, resume --prompt (ko)', () => {
  const { env, repo } = tmp()
  env.LANG = 'ko_KR.UTF-8'
  const run = (...a) => bin('lanekeeper-waves', a, env, repo)
  assert.equal(run('init-wave', 'w1', '--title', 'T').status, 0)
  assert.equal(run('lane', 'w1', 'l1', '--task', 'implement', '--model', 'opus', '--todo', 'one', '--todo', 'two').status, 0)
  assert.equal(run('status', 'w1', 'l1', 'running').status, 0)
  assert.equal(run('todo', 'w1', 'l1', 'done', '1').status, 0)
  assert.equal(run('verify', 'w1', 'l1', 'unit', 'pass').status, 0)
  const board = run('board')
  assert.equal(board.status, 0)
  assert.match(board.stdout, /w1\/l1\s+진행\s+opus\s+implement\s+0\/0\s+1\/2\s+1\/0/)
  const j = JSON.parse(run('board', '--json').stdout)
  assert.equal(j[0].lane, 'l1')
  assert.match(run('metrics').stdout, /끝난 실행 기록이 없습니다/)
  assert.match(run('resume', '--prompt', 'w1/l1').stdout, /two/)
  assert.match(run('statusline').stdout, /^lanekeeper 0\/3 /)
  const bad = run('status', 'w1', 'zz', 'running')
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /레인 "zz" 이 없습니다/)
  assert.equal(run('nope').status, 2)
})

test('hooks.json registers SubagentStart and SubagentStop for the ledger; plugin settings set the status line', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8')).hooks
  const cmds = (ev) => h[ev].flatMap((e) => e.hooks.map((x) => x.command))
  assert.ok(cmds('SubagentStart').some((c) => c.includes('ledger/subagent.mjs')))
  assert.ok(cmds('SubagentStop').some((c) => c.includes('ledger/subagent.mjs')))
  assert.ok(cmds('SubagentStop').some((c) => c.includes('checkpoint.mjs')), 'checkpoint kept')
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'))
  assert.match(s.subagentStatusLine.command, /lanekeeper-waves statusline/)
})

// ---------------------------------------------------------------- numbers

function numberRepo() {
  const fx = tmp()
  fs.mkdirSync(path.join(fx.repo, '.lanekeeper'), { recursive: true })
  fs.writeFileSync(path.join(fx.repo, '.lanekeeper', 'config.json'), JSON.stringify({ version: 1, numbers: { migration: { dir: 'db/migrations', pattern: '^(\\d+)_', width: 3 } } }))
  fs.mkdirSync(path.join(fx.repo, 'db/migrations'), { recursive: true })
  for (const f of ['001_a.sql', '002_b.sql', '007_c.sql']) fs.writeFileSync(path.join(fx.repo, 'db/migrations', f), '-- x\n')
  return fx
}

test('numbers: next number is above files and reservations; parallel lanes never collide', () => {
  const { sd, repo } = numberRepo()
  const cfg = N.seriesConfig({ project: { numbers: { migration: { dir: 'db/migrations', pattern: '^(\\d+)_', width: 3 } } } }, 'migration')
  assert.deepEqual(N.reserve(sd, 'migration', cfg, [repo], { lane: 'l1' }).map((r) => r.n), [8])
  assert.deepEqual(N.reserve(sd, 'migration', cfg, [repo], { lane: 'l2', count: 2 }).map((r) => r.n), [9, 10])
  N.release(sd, 'migration', 10)
  assert.deepEqual(N.reserve(sd, 'migration', cfg, [repo], { lane: 'l3' }).map((r) => r.n), [10]) // 10 was released, 9 is still held
  assert.throws(() => N.release(sd, 'migration', 99), (e) => e.code === 'numbers.not_reserved')
  assert.throws(() => N.seriesConfig({ project: {} }, 'nope'), (e) => e.code === 'numbers.no_series')
  assert.equal(N.format(cfg, 8), '008')
})

test('numbers: a second root (main checkout) is scanned; check finds duplicates and marks used reservations', () => {
  const { sd, repo, base } = numberRepo()
  const other = path.join(base, 'lane')
  fs.mkdirSync(path.join(other, 'db/migrations'), { recursive: true })
  fs.writeFileSync(path.join(other, 'db/migrations/012_z.sql'), '')
  const cfg = N.seriesConfig({ project: { numbers: { m: { dir: 'db/migrations', pattern: '^(\\d+)_' } } } }, 'm')
  assert.equal(N.reserve(sd, 'm', cfg, [repo, other], {})[0].n, 13)
  fs.writeFileSync(path.join(repo, 'db/migrations/013_q.sql'), '')
  assert.deepEqual(N.check(sd, 'm', cfg, [repo, other]).used, [13])
  assert.equal(N.readNumbers(sd).series.m[0].status, 'used')
  fs.writeFileSync(path.join(other, 'db/migrations/013_other.sql'), '')
  const r = N.check(sd, 'm', cfg, [repo, other])
  assert.ok(r.problems.some((p) => p.code === 'duplicate_file' && p.vars.n === '013'))
})

test('lanekeeper-number CLI: reserve prints the padded number, list, check exit code, release', () => {
  const { env, repo } = numberRepo()
  env.LANG = 'en_US.UTF-8'
  const run = (...a) => bin('lanekeeper-number', a, env, repo)
  assert.equal(run('reserve', 'migration', '--lane', 'l1').stdout.trim(), '008')
  assert.equal(run('reserve', 'migration', '--lane', 'l2').stdout.trim(), '009')
  assert.match(run('list').stdout, /migration\s+008\s+reserved\s+l1/)
  assert.equal(run('check', 'migration').status, 0)
  fs.writeFileSync(path.join(repo, 'db/migrations/008_x.sql'), '')
  fs.writeFileSync(path.join(repo, 'db/migrations/008_y.sql'), '')
  const bad = run('check', 'migration')
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /Number 008 is used by more than one file/)
  assert.equal(run('release', 'migration', '9').status, 0)
  const none = run('reserve', 'unknown')
  assert.equal(none.status, 1)
  assert.match(none.stderr, /No number series "unknown"/)
})

// ---------------------------------------------------------------- cases and defects

test('cases: init, add with sequential ids, retire never reuses an id, set fixme needs a defect', () => {
  const dir = path.join(tmp().base, 'e2e')
  const { prefix } = C.initCases(dir, 'orders')
  assert.equal(prefix, 'ORDERS')
  assert.throws(() => C.initCases(dir, 'orders'), (e) => e.code === 'cases.exists')
  assert.throws(() => C.initCases(dir, 'Bad Name'), (e) => e.code === 'cases.bad_module')
  const a = C.addCase(dir, 'orders', { title: 'create', expected: 'saved', steps: ['open', 'save'], priority: 'P1', role: 'editor' })
  const b = C.addCase(dir, 'orders', { title: 'delete', expected: 'gone' })
  assert.deepEqual([a.id, b.id], ['ORDERS-001', 'ORDERS-002'])
  C.retireCase(dir, 'orders', 'ORDERS-002')
  assert.equal(C.addCase(dir, 'orders', { title: 'x', expected: 'y' }).id, 'ORDERS-003')
  assert.throws(() => C.addCase(dir, 'orders', { title: 'x' }), (e) => e.code === 'cases.missing_field')
  assert.throws(() => C.addCase(dir, 'orders', { title: 'x', expected: 'y', priority: 'P9' }), (e) => e.code === 'cases.bad_priority')
  assert.deepEqual(C.checkLedger(dir), [])
  C.setCase(dir, 'orders', 'ORDERS-001', { status: 'fixme' })
  assert.ok(C.checkLedger(dir).some((p) => p.code === 'fixme_no_defect'))
  const d = C.addDefect(dir, { title: 'save fails', severity: 'high', cases: ['ORDERS-001'] })
  assert.equal(d.id, 'D-001')
  C.setCase(dir, 'orders', 'ORDERS-001', { defect: d.id })
  assert.deepEqual(C.checkLedger(dir), [])
  C.resolveDefect(dir, d.id, { status: 'fixed', note: 'done' })
  assert.ok(C.checkLedger(dir).some((p) => p.code === 'fixme_defect_closed'))
  C.setCase(dir, 'orders', 'ORDERS-001', { status: 'active' })
  assert.deepEqual(C.checkLedger(dir), [])
  assert.equal(C.addDefect(dir, { title: 'next' }).id, 'D-002')
})

test('cases check catches reused retired ids, duplicate ids, unknown defects and bad fields', () => {
  const dir = path.join(tmp().base, 'e2e')
  C.initCases(dir, 'a', { prefix: 'AA' })
  C.initCases(dir, 'b', { prefix: 'AA' })
  const f = C.casesFile(dir, 'a')
  const d = JSON.parse(fs.readFileSync(f, 'utf8'))
  d.retired_ids = ['AA-001']
  d.cases = [
    { id: 'AA-001', title: 't', priority: 'P0', steps: [], expected: 'e', status: 'active' },
    { id: 'AA-002', title: 't', priority: 'P0', steps: [], expected: 'e', status: 'fixme', defect: 'D-404' },
    { id: 'AA-002', title: '', priority: 'PX', steps: [], expected: 'e', status: 'weird' },
    { id: 'ZZ-1', title: 't', priority: 'P0', steps: [], expected: 'e', status: 'active' },
  ]
  fs.writeFileSync(f, JSON.stringify(d))
  const codes = C.checkLedger(dir).map((p) => p.code)
  for (const c of ['reused_id', 'duplicate_id', 'defect_unknown', 'missing_field', 'bad_priority', 'bad_status', 'bad_id', 'prefix_shared']) assert.ok(codes.includes(c), c)
  assert.throws(() => C.readCases(dir, 'none'), (e) => e.code === 'cases.no_module')
  assert.throws(() => C.addDefect(dir, { title: 'x', severity: 'huge' }), (e) => e.code === 'defects.bad_severity')
})

test('lanekeeper-cases and lanekeeper-defects CLI use paths.e2e_ledger; check exits 1 on problems', () => {
  const { env, repo } = tmp()
  env.LANG = 'en_US.UTF-8'
  const cases = (...a) => bin('lanekeeper-cases', a, env, repo)
  const defects = (...a) => bin('lanekeeper-defects', a, env, repo)
  assert.match(cases('init', 'orders').stdout, /docs\/e2e\/orders\.cases\.json/)
  assert.equal(cases('add', 'orders', '--title', 'create', '--expected', 'saved', '--step', 'open', '--step', 'save', '--priority', 'P1').status, 0)
  const file = JSON.parse(fs.readFileSync(path.join(repo, 'docs/e2e/orders.cases.json'), 'utf8'))
  assert.deepEqual(file.cases[0].steps, ['open', 'save'])
  assert.match(cases('list').stdout, /ORDERS-001\s+P1\s+active\s+create/)
  assert.equal(cases('check').status, 0)
  assert.match(defects('add', '--title', 'broken', '--severity', 'high', '--case', 'ORDERS-001').stdout, /D-001/)
  assert.equal(cases('set', 'orders', 'ORDERS-001', '--status', 'fixme', '--defect', 'D-001').status, 0)
  assert.equal(cases('check').status, 0)
  assert.match(defects('list', '--status', 'open').stdout, /D-001\s+high\s+open\s+ORDERS-001\s+broken/)
  assert.equal(defects('resolve', 'D-001').status, 0)
  const bad = cases('check')
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /defect D-001 is closed/)
  assert.equal(cases('retire', 'orders', 'ORDERS-001').status, 0)
  const e = cases('add', 'missing', '--title', 'x', '--expected', 'y')
  assert.equal(e.status, 1)
  assert.match(e.stderr, /No case file for module "missing"/)
})

test('templates and defaults: case templates parse; project.waves.stale_min and numbers are valid settings', () => {
  for (const f of ['cases.json', 'defect-register.json']) JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/test-cases', f), 'utf8'))
  const r = bin('lanekeeper-config', ['validate'], { ...process.env }, ROOT)
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('every static message key used by the L6 files exists in both locales', () => {
  const ko = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/ko.json'), 'utf8'))
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/en.json'), 'utf8'))
  const files = ['bin/lanekeeper-waves', 'bin/lanekeeper-number', 'bin/lanekeeper-cases', 'bin/lanekeeper-defects', 'lib/board.mjs', 'lib/resume.mjs', 'lib/ledger-cli.mjs']
  const keys = new Set()
  for (const f of files) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8')
    for (const m of s.matchAll(/\bt\('([a-z_.]+)'/g)) keys.add(m[1])
    for (const m of s.matchAll(/\bfail\('([a-z_.]+)'/g)) keys.add(`ledger.err.${m[1]}`)
  }
  for (const f of ['lib/waves.mjs', 'lib/numbers.mjs', 'lib/cases.mjs']) {
    for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/LedgerError\('([a-z_.]+)'/g)) keys.add(`ledger.err.${m[1]}`)
  }
  for (const f of ['lib/resume.mjs', 'lib/cases.mjs', 'lib/numbers.mjs']) {
    for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/code: '([a-z_]+)'/g)) {
      const ns = f.includes('resume') ? 'resume.stale' : f.includes('cases') ? 'cases.problem' : 'numbers.problem'
      keys.add(`${ns}.${m[1]}`)
    }
  }
  for (const s of ['pending', 'running', 'review', 'blocked', 'failed', 'done']) keys.add(`board.status.${s}`)
  for (const s of ['done', 'live', 'review', 'dead', 'pending', 'blocked', 'failed', 'recent']) keys.add(`resume.verdict.${s}`)
  assert.ok(keys.size > 80)
  const missing = [...keys].filter((k) => !(k in ko) || !(k in en))
  assert.deepEqual(missing, [])
})
