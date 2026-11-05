// Shared fixture for the safety hook tests: a throw-away repository with a
// main checkout and linked worktrees for the integration, lane and feature
// branches, plus an isolated LANEKEEPER_HOME and HOME.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { evaluate } from '../hooks/scripts/safety/pretool.mjs'

// keep the developer's own git settings (aliases, hooks) out of the tests
process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'
// a fixed identity for commits made in this process (checkpoint): without a
// global config, git on a CI runner cannot guess one
for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[k] ||= 't'
for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[k] ||= 't@example.com'

export const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

export function makeFixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lanekeeper-safety-')))
  const repo = path.join(base, 'repo')
  fs.mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  for (const b of ['lanekeeper/t/int', 'lanekeeper/t/l1', 'lanekeeper/t/l2', 'feature/x', 'release/1.0']) git(repo, 'branch', b)
  const wt = {}
  for (const [name, branch] of [['int', 'lanekeeper/t/int'], ['l1', 'lanekeeper/t/l1'], ['l2', 'lanekeeper/t/l2'], ['feat', 'feature/x']]) {
    wt[name] = path.join(base, `wt-${name}`)
    git(repo, 'worktree', 'add', '-q', wt[name], branch)
  }
  const state = path.join(repo, '.git', 'lanekeeper')
  fs.mkdirSync(state, { recursive: true })
  fs.writeFileSync(
    path.join(state, 'lanes.json'),
    JSON.stringify({ lanes: [{ id: 'l1', branch: 'lanekeeper/t/l1', worktree: wt.l1, integration: 'lanekeeper/t/int', agent_id: 'agent-l1' }, { id: 'l2', branch: 'lanekeeper/t/l2', worktree: wt.l2, integration: 'lanekeeper/t/int' }] }),
  )
  const home = path.join(base, 'home')
  const lanekeeperHome = path.join(home, '.lanekeeper')
  fs.mkdirSync(lanekeeperHome, { recursive: true })
  const env = { HOME: home, LANEKEEPER_ACTIVE: '1', LANEKEEPER_HOME: lanekeeperHome, LANG: 'en_US.UTF-8', PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  const sha = (ref, cwd = repo) => git(cwd, 'rev-parse', ref)
  const f = {
    base,
    repo,
    wt,
    state,
    home,
    lanekeeperHome,
    env,
    sha,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
    projectConfig(obj) {
      fs.mkdirSync(path.join(repo, '.lanekeeper'), { recursive: true })
      fs.writeFileSync(path.join(repo, '.lanekeeper', 'config.json'), typeof obj === 'string' ? obj : JSON.stringify(obj))
    },
    clearProjectConfig() {
      fs.rmSync(path.join(repo, '.lanekeeper'), { recursive: true, force: true })
    },
    machine(obj) {
      fs.writeFileSync(path.join(lanekeeperHome, 'machine.json'), JSON.stringify(obj))
    },
    grant(action, head, { minutes = 15, used = false } = {}) {
      const now = Date.now()
      fs.writeFileSync(
        path.join(state, 'owner-grant.json'),
        JSON.stringify({ version: 1, action, ref: '-', head, created: new Date(now).toISOString(), expires: new Date(now + minutes * 60000).toISOString(), used }),
      )
    },
    readGrant: () => JSON.parse(fs.readFileSync(path.join(state, 'owner-grant.json'), 'utf8')),
    clearGrant: () => fs.rmSync(path.join(state, 'owner-grant.json'), { force: true }),
    stamp(head) {
      fs.writeFileSync(path.join(state, 'lanekeeper-gate-pass.json'), JSON.stringify({ head, at: new Date().toISOString() }))
    },
    // Judge a tool call in process (grants are consumed as in the hook).
    // Returns { decision, codes }.
    judge(command, { cwd = repo, agent, tool = 'Bash', input, overrides = {} } = {}) {
      const payload = {
        hook_event_name: 'PreToolUse',
        cwd,
        tool_name: tool,
        tool_input: input || { command },
        ...(agent ? { agent_id: agent, agent_type: 'general-purpose' } : {}),
      }
      const r = evaluate(payload, env, overrides)
      return { decision: r.decision, codes: r.reasons.map((x) => x.code), reasons: r.reasons }
    },
  }
  return f
}
