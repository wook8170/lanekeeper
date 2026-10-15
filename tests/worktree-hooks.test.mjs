// Opt-in Claude Code worktree hooks: off by default, written to the main
// checkout's .claude/settings.local.json only when project.worktree.hook is
// true, kept pointing at the current plugin root, removed when turned off.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { syncWorktreeHooks, status, settingsFile } from '../lib/worktree-hooks.mjs'
import { run as sessionSync } from '../hooks/scripts/worktree/session-sync.mjs'
import { initProject } from '../lib/init.mjs'

process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-wth-')))
  const repo = path.join(base, 'repo')
  fs.mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'i')
  const home = path.join(base, 'home')
  fs.mkdirSync(path.join(home, '.wb'), { recursive: true })
  const env = { PATH: process.env.PATH, HOME: home, WB_HOME: path.join(home, '.wb'), LANG: 'en_US.UTF-8', GIT_CONFIG_GLOBAL: '/dev/null' }
  const settings = path.join(repo, '.claude', 'settings.local.json')
  const read = () => JSON.parse(fs.readFileSync(settings, 'utf8'))
  const project = (obj) => {
    fs.mkdirSync(path.join(repo, '.wb'), { recursive: true })
    fs.writeFileSync(path.join(repo, '.wb', 'config.json'), JSON.stringify(obj))
  }
  return { base, repo, env, settings, read, project, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) }
}

const ROOT_A = '/opt/plugins/wb/0.1.0'
const ROOT_B = '/opt/plugins/wb/0.2.0'

test('off by default: a session start writes nothing', () => {
  const f = fixture()
  assert.equal(sessionSync({ cwd: f.repo }, f.env, ROOT_A), '')
  assert.equal(fs.existsSync(f.settings), false)
  assert.equal(status(f.repo, ROOT_A).state, 'off')
  f.cleanup()
})

test('turned on: both hooks are written to the main checkout settings.local.json and kept out of git', () => {
  const f = fixture()
  f.project({ worktree: { hook: true } })
  const msg = JSON.parse(sessionSync({ cwd: f.repo }, f.env, ROOT_A))
  assert.match(msg.systemMessage, /Registered the Claude Code worktree hooks/)
  const s = f.read()
  assert.equal(s.hooks.WorktreeCreate[0].hooks[0].command, `"${ROOT_A}/bin/wb-worktree" hook-create`)
  assert.equal(s.hooks.WorktreeRemove[0].hooks[0].command, `"${ROOT_A}/bin/wb-worktree" hook-remove`)
  assert.equal(status(f.repo, ROOT_A).state, 'on')
  // ignored either by an existing rule or by the line wb adds to .git/info/exclude
  assert.doesNotThrow(() => git(f.repo, 'check-ignore', '-q', '.claude/settings.local.json'))
  assert.equal(git(f.repo, 'status', '--porcelain'), '?? .wb/', 'settings.local.json is not shown as untracked')
  assert.equal(sessionSync({ cwd: f.repo }, f.env, ROOT_A), '', 'second start changes nothing')
  f.cleanup()
})

test('a plugin update moves the root: the next session start re-points the command', () => {
  const f = fixture()
  f.project({ worktree: { hook: true } })
  sessionSync({ cwd: f.repo }, f.env, ROOT_A)
  assert.equal(status(f.repo, ROOT_B).state, 'stale')
  sessionSync({ cwd: f.repo }, f.env, ROOT_B)
  const cmds = JSON.stringify(f.read().hooks)
  assert.ok(cmds.includes(ROOT_B) && !cmds.includes(ROOT_A))
  assert.equal(f.read().hooks.WorktreeCreate.length, 1)
  f.cleanup()
})

test('turned off again: only the wb entries are removed, other settings and hooks stay', () => {
  const f = fixture()
  fs.mkdirSync(path.dirname(f.settings), { recursive: true })
  fs.writeFileSync(f.settings, JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] } }))
  f.project({ worktree: { hook: true } })
  sessionSync({ cwd: f.repo }, f.env, ROOT_A)
  f.project({ worktree: { hook: false } })
  const msg = JSON.parse(sessionSync({ cwd: f.repo }, f.env, ROOT_A))
  assert.match(msg.systemMessage, /Removed the Claude Code worktree hooks/)
  assert.deepEqual(f.read(), { permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] } })
  f.cleanup()
})

test('another WorktreeCreate hook already present: wb does not add a second one', () => {
  const f = fixture()
  fs.mkdirSync(path.dirname(f.settings), { recursive: true })
  const other = { hooks: { WorktreeCreate: [{ hooks: [{ type: 'command', command: 'my-vcs-create' }] }] } }
  fs.writeFileSync(f.settings, JSON.stringify(other))
  const r = syncWorktreeHooks(f.repo, ROOT_A, true)
  assert.equal(r.state, 'conflict')
  assert.deepEqual(f.read(), other)
  f.cleanup()
})

test('from a linked worktree the settings file is the main checkout one', () => {
  const f = fixture()
  git(f.repo, 'worktree', 'add', '-q', '-b', 'x', path.join(f.base, 'wt-x'))
  assert.equal(settingsFile(path.join(f.base, 'wt-x')), f.settings)
  f.cleanup()
})

test('init: the worktree question is no by default; yes writes the setting and registers the hooks', () => {
  const f = fixture()
  initProject(f.repo, { kind: 'other', language: 'en' }, f.env, ROOT_A)
  assert.equal(fs.existsSync(f.settings), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.repo, '.wb', 'config.json'), 'utf8')).worktree, undefined)
  const g = fixture()
  const actions = initProject(g.repo, { kind: 'other', language: 'en', worktreeHook: true }, g.env, ROOT_A)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(g.repo, '.wb', 'config.json'), 'utf8')).worktree, { hook: true })
  assert.ok(actions.some((a) => a.type === 'worktreeHook'))
  assert.equal(status(g.repo, ROOT_A).state, 'on')
  f.cleanup()
  g.cleanup()
})

test('init keeps an existing config and says how to turn the hooks on', () => {
  const f = fixture()
  f.project({ version: 1 })
  const actions = initProject(f.repo, { kind: 'other', language: 'en', worktreeHook: true }, f.env, ROOT_A)
  assert.ok(actions.some((a) => a.type === 'worktreeHookKept'))
  assert.equal(fs.existsSync(f.settings), false)
  f.cleanup()
})

test('CLI: wb-config init --worktree-hook yes, then wb-worktree hooks status and sync', async () => {
  const { fileURLToPath } = await import('node:url')
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const f = fixture()
  const run = (bin, ...a) => execFileSync(process.execPath, [path.join(ROOT, 'bin', bin), ...a], { cwd: f.repo, env: f.env, encoding: 'utf8' })
  run('wb-config', 'init', '--kind', 'other', '--lang', 'en', '--worktree-hook', 'yes')
  const st = JSON.parse(run('wb-worktree', 'hooks', 'status', '--json'))
  assert.equal(st.setting, true)
  assert.equal(st.state, 'on')
  assert.ok(f.read().hooks.WorktreeCreate[0].hooks[0].command.includes(path.join(ROOT, 'bin', 'wb-worktree')))
  f.project({ version: 1, worktree: { hook: false } })
  assert.equal(JSON.parse(run('wb-worktree', 'hooks', 'sync', '--json')).state, 'off')
  assert.equal(f.read().hooks, undefined)
  f.cleanup()
})
