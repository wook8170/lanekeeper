// Shared fixture for the L3 tests: isolated HOME, WB_HOME, plugin data and
// Claude config folders, a throw-away git repository and a hook runner.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'

export const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export function makeEnv(extra = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-l3-')))
  const home = path.join(base, 'home')
  const env = {
    HOME: home,
    WB_HOME: path.join(home, '.wb'),
    CLAUDE_PLUGIN_DATA: path.join(base, 'data'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    WB_NO_NOTIFY: '1',
    LANG: 'en_US.UTF-8',
    PATH: process.env.PATH,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra,
  }
  fs.mkdirSync(env.WB_HOME, { recursive: true })
  const repo = path.join(base, 'repo')
  fs.mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  return {
    base,
    env,
    repo,
    personal: (obj) => fs.writeFileSync(path.join(env.WB_HOME, 'personal.json'), JSON.stringify({ version: 1, ...obj })),
    readPersonal: () => JSON.parse(fs.readFileSync(path.join(env.WB_HOME, 'personal.json'), 'utf8')),
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  }
}

// Run a hook script as a process; returns { status, out (parsed JSON or null), raw }.
export function runScript(rel, input, env, args = []) {
  const r = spawnSync(path.join(ROOT, rel), args, { input: JSON.stringify(input), env, encoding: 'utf8' })
  let out = null
  try {
    out = r.stdout.trim() ? JSON.parse(r.stdout) : null
  } catch {
    /* not JSON */
  }
  return { status: r.status, out, raw: r.stdout, err: r.stderr }
}

export const bin = (name, args, env, cwd) => spawnSync(path.join(ROOT, 'bin', name), args, { env, cwd, encoding: 'utf8' })
