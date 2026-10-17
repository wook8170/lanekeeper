// L14: security review — input checks on paths and URLs, the gate lock, hook
// behaviour on bad input, and static checks on how the plugin runs commands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { makeEnv, bin, git, ROOT } from './l3-fixture.mjs'
import { isLoopbackUrl, writeReturnBrief } from '../lib/review.mjs'
import { slugOk, artPath } from '../lib/art.mjs'
import { sqliteArgOk } from '../lib/codegraph.mjs'
import { acquireGateLock } from '../lib/testresults.mjs'
import { gateLocked } from '../hooks/scripts/safety/grant.mjs'

// ---- input checks ----------------------------------------------------------

test('serving check: only loopback addresses are fetched', () => {
  for (const u of ['http://localhost:3000/x', 'http://127.0.0.1:41000/', 'https://127.1.2.3/a', 'http://[::1]:8080/']) assert.ok(isLoopbackUrl(u), u)
  for (const u of ['http://example.com/', 'http://203.0.113.5/', 'http://localhost.example.com/', 'file:///etc/passwd', 'ftp://127.0.0.1/', 'not a url', '']) assert.ok(!isLoopbackUrl(u), u)
})

test('wb-art: a slug cannot leave the artifact folder', () => {
  for (const s of ['2026-10-17', 'list-search', '목록_검색.v2']) assert.ok(slugOk(s), s)
  for (const s of ['../x', 'a/b', '..', 'a..b', '/abs', '', '.hidden', 'a\\b']) assert.ok(!slugOk(s), s)
  assert.throws(() => artPath('/tmp/r', {}, 'artifacts_keep', '../../etc'), /bad slug/)
  const fx = makeEnv()
  try {
    const png = path.join(fx.base, 'a.png')
    fs.writeFileSync(png, 'x')
    const r = bin('wb-art', ['keep', png, '--slug', '../../outside'], fx.env, fx.repo)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /slug/)
    assert.ok(!fs.existsSync(path.join(fx.base, 'outside')))
  } finally {
    fx.cleanup()
  }
})

test('return brief: the lane id must be a plain id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-l14-'))
  try {
    assert.throws(() => writeReturnBrief({ root, config: {}, lang: 'en', lane: '../../x', title: 't', findings: [] }), /bad lane id/)
    const file = writeReturnBrief({ root, config: {}, lang: 'en', lane: 'l3', title: 't', findings: ['a'] })
    assert.ok(file.startsWith(path.join(root, '.wb', 'briefs')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('wb-check lane: a lane id with a path separator is refused', () => {
  const fx = makeEnv()
  try {
    const r = bin('wb-check', ['lane', '../x'], fx.env, fx.repo)
    assert.equal(r.status, 2)
  } finally {
    fx.cleanup()
  }
})

test('codegraph index copy: sqlite3 is used only for paths it reads literally', () => {
  assert.ok(sqliteArgOk('/tmp/wt-a/.codegraph/codegraph.db'))
  assert.ok(sqliteArgOk('/tmp/한글 폴더/.codegraph/codegraph.db'))
  for (const p of ["/tmp/a'b/codegraph.db", '/tmp/a\nb/codegraph.db', '/tmp/a\rb', '/tmp/\x00']) assert.ok(!sqliteArgOk(p), JSON.stringify(p))
})

// ---- gate lock -------------------------------------------------------------

test('gate lock: held during a run, refused while a live run holds it, stale locks replaced', () => {
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-l14-sd-'))
  try {
    const a = acquireGateLock(sd, { command: 'x' })
    assert.ok(a.ok)
    assert.ok(gateLocked(sd))
    assert.equal(JSON.parse(fs.readFileSync(a.file, 'utf8')).pid, process.pid)
    a.release()
    assert.ok(!gateLocked(sd))
    // a live process (our parent) holds it
    fs.writeFileSync(path.join(sd, 'gate.lock'), JSON.stringify({ pid: process.ppid }))
    const b = acquireGateLock(sd)
    assert.equal(b.ok, false)
    assert.equal(b.pid, process.ppid)
    // a dead pid is replaced; release removes only our own lock
    fs.writeFileSync(path.join(sd, 'gate.lock'), JSON.stringify({ pid: 2 ** 22 + 12345 }))
    const c = acquireGateLock(sd)
    assert.ok(c.ok)
    fs.writeFileSync(c.file, JSON.stringify({ pid: process.ppid }))
    c.release()
    assert.ok(gateLocked(sd), 'someone else took it over; not removed')
  } finally {
    fs.rmSync(sd, { recursive: true, force: true })
  }
})

test('wb-test-report gate: takes the lock while running and removes it after', () => {
  const fx = makeEnv()
  try {
    const sd = path.join(fx.repo, '.git', 'wb')
    const probe = path.join(fx.base, 'seen.txt')
    const script = path.join(fx.base, 'probe.mjs')
    fs.writeFileSync(script, `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(probe)}, String(fs.existsSync(${JSON.stringify(path.join(sd, 'gate.lock'))})))\n`)
    fs.mkdirSync(path.join(fx.repo, '.wb'), { recursive: true })
    fs.writeFileSync(path.join(fx.repo, '.wb', 'verify.config.json'), JSON.stringify({ version: 1, gate: { steps: [{ name: 'probe', cmd: `node ${script}` }], slot: 'none' }, stages: [] }))
    const r = bin('wb-test-report', ['gate', '--results-dir', path.join(fx.base, 'res')], fx.env, fx.repo)
    assert.equal(r.status, 0, r.stderr + r.stdout)
    assert.equal(fs.readFileSync(probe, 'utf8'), 'true')
    assert.ok(!fs.existsSync(path.join(sd, 'gate.lock')))
    fs.mkdirSync(sd, { recursive: true })
    fs.writeFileSync(path.join(sd, 'gate.lock'), JSON.stringify({ pid: process.pid }))
    const busy = bin('wb-test-report', ['gate', '--results-dir', path.join(fx.base, 'res2')], fx.env, fx.repo)
    assert.equal(busy.status, 3)
    assert.match(busy.stderr, /wb-reap --gate-lock/)
  } finally {
    fx.cleanup()
  }
})

// ---- hooks on bad input ------------------------------------------------------

const hooksJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
const hookCommands = Object.entries(hooksJson.hooks).flatMap(([event, list]) => list.flatMap((m) => m.hooks.map((h) => ({ event, command: h.command }))))
const scriptOf = (c) => /hooks\/scripts\/[\w./-]+\.mjs/.exec(c)[0]
// Safety hooks fail closed: the tool call is denied, or the /wb:approve prompt is blocked
// (no grant is made). Every other hook fails open.
const SAFETY = new Map([
  ['hooks/scripts/safety/pretool.mjs', /"permissionDecision":"deny"/],
  ['hooks/scripts/safety/approve.mjs', /"decision":"block"/],
])

test('hooks.json: every command runs a node script of this plugin through a quoted plugin root', () => {
  assert.ok(hookCommands.length >= 20)
  for (const { command } of hookCommands) {
    assert.match(command, /^"\$\{CLAUDE_PLUGIN_ROOT\}"\/hooks\/scripts\/[\w./-]+\.mjs$/, command)
    assert.ok(fs.statSync(path.join(ROOT, scriptOf(command))).mode & 0o111, `${command} executable`)
  }
  const shellScripts = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(sh|bash|zsh)$/.test(e.name)) shellScripts.push(path.relative(ROOT, p))
    }
  }
  walk(ROOT)
  assert.deepEqual(shellScripts, [], 'shell scripts need shellcheck in CI before they are added')
})

function hookEnv() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-l14-hook-')))
  const home = path.join(base, 'home')
  fs.mkdirSync(path.join(home, '.wb'), { recursive: true })
  const broken = path.join(base, 'broken')
  fs.mkdirSync(path.join(broken, '.wb'), { recursive: true })
  git(broken, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(broken, 'a.txt'), 'a\n')
  git(broken, 'add', '.')
  git(broken, 'commit', '-q', '-m', 'init')
  fs.writeFileSync(path.join(broken, '.wb', 'config.json'), '{ not json')
  const env = {
    HOME: home,
    WB_HOME: path.join(home, '.wb'),
    CLAUDE_PLUGIN_DATA: path.join(base, 'data'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    WB_NO_NOTIFY: '1',
    WB_CODEGRAPH: 'off',
    LANG: 'en_US.UTF-8',
    PATH: process.env.PATH,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  }
  return { base, broken, env }
}

test('hooks on bad input: the safety hook blocks; every other hook exits 0 and lets the call through', () => {
  const h = hookEnv()
  try {
    const scripts = [...new Set(hookCommands.map((c) => scriptOf(c.command)))]
    const inputs = [
      { name: 'garbage stdin', raw: 'not json {', cwd: h.base },
      { name: 'broken project config', raw: JSON.stringify({ cwd: h.broken, session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin main' }, command_name: 'wb:approve', command_args: 'push-main' }), cwd: h.broken },
    ]
    for (const s of scripts) {
      for (const inp of inputs) {
        const r = spawnSync(process.execPath, [path.join(ROOT, s)], { input: inp.raw, cwd: inp.cwd, env: h.env, encoding: 'utf8', timeout: 15_000 })
        const label = `${s} / ${inp.name}`
        assert.equal(r.status, 0, `${label}: exit ${r.status} ${r.stderr}`)
        const out = r.stdout
        if (SAFETY.has(s)) assert.match(out, SAFETY.get(s), label)
        else {
          assert.doesNotMatch(out, /"decision"\s*:\s*"block"/, label)
          assert.doesNotMatch(out, /"permissionDecision"\s*:\s*"deny"/, label)
        }
      }
    }
    // the approve hook made no grant from these inputs
    assert.ok(!fs.existsSync(path.join(h.broken, '.git', 'wb', 'owner-grant.json')))
  } finally {
    fs.rmSync(h.base, { recursive: true, force: true })
  }
})

// ---- static checks -----------------------------------------------------------

function sources() {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(mjs|js)$/.test(e.name) || (d.endsWith(`${path.sep}bin`) && !e.name.includes('.'))) out.push(p)
    }
  }
  for (const d of ['lib', 'bin', 'hooks', 'templates']) walk(path.join(ROOT, d))
  return out.map((p) => ({ rel: path.relative(ROOT, p), body: fs.readFileSync(p, 'utf8') }))
}

test('commands through a shell only where the user or project supplies the command', () => {
  // Each place runs a command string written by the user or the project config, the same
  // trust as running it by hand. Adding a new place needs a security review.
  const allowed = new Map([
    ['bin/wb-slot', 'the command the user wraps'],
    ['bin/wb-test-report', 'project.gate.command (gate-pass)'],
    ['lib/review.mjs', 'project.review.guards'],
    ['lib/worktree.mjs', 'project.worktree.setup'],
    ['templates/test-results/project/run-gate.mjs', 'gate steps in .wb/verify.config.json'],
    ['templates/test-results/project/verify-all.mjs', 'fixed git queries'],
  ])
  const found = new Set()
  for (const { rel, body } of sources()) {
    if (/\b(eval|new Function)\s*\(/.test(body)) assert.fail(`${rel}: eval`)
    if (/spawn(Sync)?\(\s*'sh'\s*,\s*\['-c'|shell:\s*true|\bexecSync\(/.test(body)) found.add(rel)
  }
  assert.deepEqual([...found].sort(), [...allowed.keys()].sort())
})

test('network: only the serving check makes a request, and only to loopback', () => {
  const users = []
  for (const { rel, body } of sources()) {
    if (/\bfetch\(|from 'node:(https?|net|http2|dgram|tls)'|require\('(https?|net)'\)/.test(body)) users.push(rel)
  }
  assert.deepEqual(users, ['lib/review.mjs'])
})

test('no source prints the environment', () => {
  for (const { rel, body } of sources()) assert.doesNotMatch(body, /JSON\.stringify\((process\.)?env\b/, rel)
})
