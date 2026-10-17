// kill-guard, destructive (rm), browser-guard, paths, Skill tool, fail-closed
// settings, union of safety keys across layers, messages.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeFixture } from './safety-fixture.mjs'
import { runHook } from '../hooks/scripts/safety/pretool.mjs'
import { resolveConfig } from '../lib/config.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let f
before(() => {
  f = makeFixture()
})
after(() => f.cleanup())
beforeEach(() => {
  f.clearProjectConfig()
  fs.rmSync(path.join(f.wbHome, 'machine.json'), { force: true })
})

const d = (cmd, opts = {}) => f.judge(cmd, { cwd: f.repo, ...opts })
const expect = (r, decision, code) => {
  assert.equal(r.decision, decision, JSON.stringify(r.codes))
  if (code) assert.ok(r.codes.includes(code), `expected ${code}, got ${JSON.stringify(r.codes)}`)
}
const PROTECTED = { ports: { protected: [{ name: 'owner-api', port: 8080 }] } }
// fake lsof: pid 111 listens on 8080, pid 222 on 3000, pid 333 nothing
const lsof = { listenPorts: (pid) => ({ 111: [8080], 222: [3000], 333: [] })[pid] ?? [] }

// ── kill ─────────────────────────────────────────────────────────────
test('kill: pattern kills are always blocked', () => {
  for (const c of ['pkill node', 'pkill -f vite', 'killall node', 'kill $(pgrep node)', 'kill `pgrep -f esbuild`', 'pgrep node | xargs kill', 'ps aux | grep vite | awk \'{print $2}\' | xargs kill -9']) {
    expect(d(c), 'deny', 'kill.pattern')
  }
})
test('kill: a PID listening on a protected port is blocked, others pass', () => {
  f.machine(PROTECTED)
  expect(d('kill 111', { overrides: lsof }), 'deny', 'kill.protected_port')
  expect(d('kill -9 222 111', { overrides: lsof }), 'deny', 'kill.protected_port')
  expect(d('kill -TERM 222', { overrides: lsof }), 'allow')
  expect(d('kill 333', { overrides: lsof }), 'allow')
  expect(d('kill -0 111', { overrides: lsof }), 'allow')
})
test('kill: port-addressed kills are checked against the protected list', () => {
  f.machine(PROTECTED)
  expect(d('lsof -ti :8080 | xargs kill -9'), 'deny', 'kill.protected_port')
  expect(d('lsof -ti tcp:8080 | xargs kill'), 'deny', 'kill.protected_port')
  expect(d('kill $(lsof -ti :8080)'), 'deny', 'kill.protected_port')
  expect(d('fuser -k 8080/tcp'), 'deny', 'kill.protected_port')
  expect(d('npx kill-port 8080'), 'deny', 'kill.protected_port')
  expect(d('lsof -ti :7010 | xargs kill'), 'allow')
  expect(d('fuser -k 7010/tcp'), 'allow')
})
test('kill: unknown targets ask when protected ports exist, pass when none are set', () => {
  expect(d('kill $PID'), 'allow')
  f.machine(PROTECTED)
  expect(d('kill $PID'), 'ask', 'kill.unresolved')
  expect(d('kill 111', { overrides: { listenPorts: () => null } }), 'ask', 'kill.unresolved')
})
test('kill: protected ports set in a lower layer cannot be removed by a higher one', () => {
  f.projectConfig({ machine: { ports: { protected: [{ name: 'owner-web', port: 3000 }] } } })
  f.machine({ ports: { protected: [] } })
  expect(d('kill 222', { overrides: lsof }), 'deny', 'kill.protected_port')
})

// ── rm ───────────────────────────────────────────────────────────────
test('rm: broad recursive deletes are blocked', () => {
  for (const c of ['rm -rf /', 'rm -rf ~', 'rm -rf $HOME', 'rm -rf ~/', 'rm -rf .', 'rm -rf ./*', 'rm -rf *', 'rm -rf ..', `rm -rf ${f.repo}`, 'rm -rf /usr', 'rm -fr /Applications', 'rm -r -f /etc', 'sudo rm -rf /']) {
    expect(d(c), 'deny', 'rm.broad')
  }
  expect(d('rm -rf .git'), 'deny', 'rm.git')
})
test('rm: inside the project or a temp folder passes; outside asks; variables ask', () => {
  expect(d('rm -rf node_modules dist'), 'allow')
  expect(d('rm -rf ./build/'), 'allow')
  expect(d('rm -rf /tmp/wb-test-dir'), 'allow')
  expect(d('rm file.txt'), 'allow')
  expect(d('rm -rf /opt/wb-none/x'), 'ask', 'rm.outside')
  expect(d(`rm -rf ${path.join(f.base, 'elsewhere', 'x')}`), 'allow') // temp folder
  expect(d('rm -rf "$OUT"/'), 'ask', 'rm.dynamic')
  expect(d('cd "$X" && rm -rf build'), 'ask', 'rm.dynamic')
})

// ── browser ──────────────────────────────────────────────────────────
test('browser: window-opening runs are blocked', () => {
  for (const [c, code] of [
    ['google-chrome --remote-debugging-port=9222', 'browser.headed'],
    ['"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir=/tmp/p https://example.com', 'browser.headed'],
    ['chromium --app=http://localhost:3000', 'browser.headed'],
    ['npx playwright test --headed', 'browser.headed'],
    ['pnpm test:e2e -- --headed', 'browser.headed'],
    ['PWDEBUG=1 npx playwright test', 'browser.headed'],
    ['npx playwright test --ui', 'browser.playwright_window'],
    ['npx playwright codegen http://localhost:3000', 'browser.playwright_window'],
    ['npx playwright show-report', 'browser.playwright_window'],
    ['open https://example.com', 'browser.open'],
    ['open -a "Google Chrome" index.html', 'browser.open'],
    ['open report.html', 'browser.open'],
    ['node -e "require(\'playwright\').chromium.launch({ headless: false })"', 'browser.headed'],
    ['node <<EOF\nconst b = await chromium.launch({headless:false})\nEOF', 'browser.headed'],
  ]) expect(d(c), 'deny', code)
})
test('browser: headless runs pass', () => {
  for (const c of [
    '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/p',
    'google-chrome --headless --screenshot https://example.com',
    'npx playwright test',
    'npx playwright test e2e/a.spec.ts --reporter=line',
    'npx playwright install chromium',
    'open .',
  ]) expect(d(c), 'allow')
})

// ── paths, Skill ─────────────────────────────────────────────────────
test('paths: wb state files cannot be written by tools or shell', () => {
  const grant = path.join(f.state, 'owner-grant.json')
  expect(d('', { tool: 'Write', input: { file_path: grant, content: '{}' } }), 'deny', 'paths.state')
  expect(d('', { tool: 'Edit', input: { file_path: path.join(f.state, 'lanes.json'), old_string: 'a', new_string: 'b' } }), 'deny', 'paths.state')
  expect(d(`echo '{}' > ${grant}`), 'deny', 'paths.state')
  expect(d(`cp /tmp/g.json ${grant}`), 'deny', 'paths.state')
  expect(d(`python3 -c "open('.git/wb/owner-grant.json','w').write('x')"`), 'deny', 'paths.state')
  expect(d(`tee .git/wb/wb-gate-pass.json < /tmp/x`), 'deny', 'paths.state')
  expect(d(`cat ${grant}`), 'allow')
})
test('paths: protected_paths block writes; a wb settings file asks', () => {
  f.projectConfig({ protected_paths: ['secrets/**', 'LICENSE'] })
  expect(d('', { tool: 'Write', input: { file_path: path.join(f.repo, 'secrets', 'k.txt'), content: 'x' } }), 'deny', 'paths.protected')
  expect(d('', { tool: 'Edit', input: { file_path: 'LICENSE', old_string: 'a', new_string: 'b' } }), 'deny', 'paths.protected')
  expect(d('echo x > secrets/k.txt'), 'deny', 'paths.protected')
  expect(d('sed -i "" s/a/b/ LICENSE'), 'deny', 'paths.protected')
  expect(d('', { tool: 'Write', input: { file_path: path.join(f.repo, 'src', 'a.ts'), content: 'x' } }), 'allow')
  expect(d('', { tool: 'Write', input: { file_path: path.join(f.repo, '.wb', 'config.json'), content: '{}' } }), 'ask', 'paths.config')
  expect(d('', { tool: 'Edit', input: { file_path: path.join(f.wbHome, 'machine.json'), old_string: 'a', new_string: 'b' } }), 'ask', 'paths.config')
})
test('Skill: the model cannot call /wb:approve', () => {
  expect(d('', { tool: 'Skill', input: { skill: 'wb:approve', args: 'merge-main' } }), 'deny', 'approve.model')
  expect(d('', { tool: 'Skill', input: { skill: 'wb:doctor' } }), 'allow')
})

// ── fail-closed ──────────────────────────────────────────────────────
test('fail-closed: a settings error blocks guarded commands and leaves the rest alone', () => {
  f.projectConfig({ git: { feature_push: 'sometimes' } })
  for (const c of ['git push origin feature/x', 'git commit -m x', 'kill 1234', 'rm -rf build', 'google-chrome']) expect(d(c, { cwd: f.repo }), 'deny', 'config.broken')
  for (const c of ['git status', 'ls -la', 'npm test', 'wb-config validate']) expect(d(c), 'allow')
  f.projectConfig('{ not json')
  expect(d('git commit -m x'), 'deny', 'config.broken')
  // the settings file itself can still be fixed (with confirmation)
  expect(d('', { tool: 'Write', input: { file_path: path.join(f.repo, '.wb', 'config.json'), content: '{}' } }), 'ask', 'paths.config')
})
test('fail-closed: an internal error blocks the call', () => {
  const out = runHook(JSON.stringify({ cwd: f.repo, tool_name: 'Bash', tool_input: { command: 'git push' } }), f.env, {
    git: { info: () => { throw new Error('boom') } },
  })
  const j = JSON.parse(out).hookSpecificOutput
  assert.equal(j.permissionDecision, 'deny')
  assert.match(j.permissionDecisionReason, /boom/)
  const bad = JSON.parse(runHook('{ not json', f.env)).hookSpecificOutput
  assert.equal(bad.permissionDecision, 'deny')
})

// ── union of safety keys ─────────────────────────────────────────────
test('union: no layer can drop protected branches, paths, ports or denied models set by another', () => {
  f.projectConfig({ git: { protected_branches: [] }, protected_paths: [], machine: { ports: { protected: [{ name: 'p', port: 3000 }] } }, routing: { denied: [] } })
  f.machine({ ports: { protected: [] } })
  fs.writeFileSync(path.join(f.wbHome, 'routing.json'), JSON.stringify({ denied: ['fable'] }))
  const r = resolveConfig({ projectDir: f.repo, env: f.env })
  assert.deepEqual(r.errors, [])
  assert.ok(r.config.project.git.protected_branches.includes('main'))
  assert.deepEqual(r.config.machine.ports.protected.map((p) => p.port), [3000])
  assert.deepEqual(r.config.routing.denied, ['fable'])
  // and the guard uses the merged list
  expect(d('git commit -m x'), 'deny', 'grant.missing')
  fs.rmSync(path.join(f.wbHome, 'routing.json'))
})
test('union: a project can add protected branches', () => {
  f.projectConfig({ git: { protected_branches: ['feature/*'] } })
  expect(d(`git -C ${f.wt.feat} commit -m x`), 'deny', 'grant.missing')
})

// ── messages ─────────────────────────────────────────────────────────
test('messages: three parts in ko and en', () => {
  const run = (lang) => JSON.parse(runHook(JSON.stringify({ cwd: f.repo, tool_name: 'Bash', tool_input: { command: 'pkill node' } }), { ...f.env, LANG: lang })).hookSpecificOutput.permissionDecisionReason
  const ko = run('ko_KR.UTF-8')
  assert.match(ko, /막았습니다: .*\n이렇게 고치세요: .*\n물어볼 곳: /)
  const en = run('en_US.UTF-8')
  assert.match(en, /Blocked: .*\nHow to fix: .*\nWhere to ask: /)
})
test('messages: every verdict code has why and fix in both locales', () => {
  const dir = path.join(ROOT, 'hooks', 'scripts', 'safety')
  const codes = new Set(['internal', 'grant.missing', 'grant.action', 'grant.used', 'grant.expired', 'grant.head', 'stamp.missing', 'stamp.head'])
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const m of src.matchAll(/\b(?:deny|ask)\('([a-z_.]+)'/g)) codes.add(m[1])
  }
  for (const lang of ['ko', 'en']) {
    const msgs = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${lang}.json`), 'utf8'))
    for (const c of codes) for (const part of ['why', 'fix']) assert.ok(msgs[`safety.${c}.${part}`], `${lang}: safety.${c}.${part}`)
  }
})

// ── the real hook process ────────────────────────────────────────────
test('hook process: prints a deny decision as JSON and exits 0; prints nothing to allow', () => {
  const script = path.join(ROOT, 'hooks', 'scripts', 'safety', 'pretool.mjs')
  const run = (command) => spawnSync(script, [], { input: JSON.stringify({ cwd: f.repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }), env: f.env, encoding: 'utf8' })
  const r = run('git push --force origin main')
  assert.equal(r.status, 0)
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny')
  const ok = run('git status')
  assert.equal(ok.status, 0)
  assert.equal(ok.stdout, '')
})
