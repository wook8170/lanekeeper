// Session rules (rules/language · remote-viewer · conduct), the codegraph
// install guidance when codegraph is missing, and the rg hint on recursive grep.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, ROOT } from './l3-fixture.mjs'
import { handle as rulesStart, sessionRuleParts } from '../hooks/scripts/rules/session-start.mjs'
import { handle as cgStart } from '../hooks/scripts/codegraph/session-start.mjs'
import { handle as nudge } from '../hooks/scripts/codegraph/nudge.mjs'
import { isRecursiveGrep } from '../lib/search.mjs'
import { resolveConfig } from '../lib/config.mjs'
import { parse } from '../hooks/scripts/safety/shell.mjs'

const personal = (f, obj) => fs.writeFileSync(path.join(f.env.WB_HOME, 'personal.json'), JSON.stringify({ version: 1, ...obj }))
const ctx = (out) => out?.hookSpecificOutput?.additionalContext || ''

test('session rules: conduct by default; language only when set to ko or en; remote only for a remote viewer', () => {
  const f = makeEnv()
  try {
    assert.deepEqual(sessionRuleParts(resolveConfig({ projectDir: f.repo, env: f.env })), ['conduct'])
    personal(f, { language: 'ko', report: { viewer: 'remote' } })
    assert.deepEqual(sessionRuleParts(resolveConfig({ projectDir: f.repo, env: f.env })), ['language', 'remote-viewer', 'conduct'])
    const text = ctx(rulesStart({ cwd: f.repo, source: 'startup' }, f.env))
    assert.match(text, /한국어로 쓴다/)
    assert.match(text, /「보고는 한국어」/)
    assert.match(text, /localhost/)
    assert.match(text, /base64/)
    assert.match(text, /2배율/)
    assert.match(text, /병합·배포 완료/)
    assert.match(text, /한 번 되묻는다/)
    assert.match(text, /근본 원인/)
    assert.match(text, /이모지/)
  } finally {
    f.cleanup()
  }
})

test('session rules: every part can be turned off; resume adds nothing; compact adds them again', () => {
  const f = makeEnv()
  try {
    personal(f, { language: 'en', report: { viewer: 'remote' }, session_rules: { language: false, remote: false, conduct: false } })
    assert.equal(rulesStart({ cwd: f.repo, source: 'startup' }, f.env), null)
    personal(f, { language: 'en' })
    assert.equal(rulesStart({ cwd: f.repo, source: 'resume' }, f.env), null)
    const text = ctx(rulesStart({ cwd: f.repo, source: 'compact' }, f.env))
    assert.match(text, /report in English/)
    assert.match(text, /root cause/)
    personal(f, { session_rules: { conduct: 'yes' } })
    assert.ok(resolveConfig({ projectDir: f.repo, env: f.env }).errors.some((e) => e.path === 'personal.session_rules.conduct'))
  } finally {
    f.cleanup()
  }
})

test('session rule files: ko and en exist for every part with the same headings count', () => {
  for (const name of ['language', 'remote-viewer', 'conduct', 'codegraph-install']) {
    const ko = fs.readFileSync(path.join(ROOT, 'rules', `${name}.ko.md`), 'utf8')
    const en = fs.readFileSync(path.join(ROOT, 'rules', `${name}.en.md`), 'utf8')
    const heads = (t) => t.split('\n').filter((l) => l.startsWith('#')).length
    assert.equal(heads(ko), heads(en), name)
    assert.doesNotMatch(en, /[가-힣]/, `${name}.en.md has no Korean`)
  }
})

test('codegraph session start: missing codegraph gives the install-and-go-on guidance; off stays silent', () => {
  const f = makeEnv({ WB_CODEGRAPH: 'off' })
  try {
    const text = ctx(cgStart({ cwd: f.repo, source: 'startup' }, f.env))
    assert.match(text, /codegraph init \./)
    assert.match(text, /projectPath/)
    assert.match(text, /do not stop to ask/)
    fs.mkdirSync(path.join(f.repo, '.wb'), { recursive: true })
    fs.writeFileSync(path.join(f.repo, '.wb', 'config.json'), JSON.stringify({ version: 1, codegraph: { nudge: 'off' } }))
    assert.equal(cgStart({ cwd: f.repo, source: 'startup' }, f.env), null)
  } finally {
    f.cleanup()
  }
})

test('rg hint (in the codegraph nudge process): recursive grep gets a note (rg -a for Korean sources); other commands and rg itself do not', () => {
  const f = makeEnv()
  try {
    let sid = 0
    // a fresh session per call: the note shows once per session
    const run = (command, env = f.env) => nudge({ tool_name: 'Bash', tool_input: { command }, cwd: f.repo, session_id: `s${++sid}` }, { WB_CODEGRAPH: 'off', ...env })
    const binDir = path.join(f.base, 'bin')
    fs.mkdirSync(binDir)
    fs.writeFileSync(path.join(binDir, 'rg'), '#!/bin/sh\n')
    fs.chmodSync(path.join(binDir, 'rg'), 0o755)
    const withRg = { ...f.env, PATH: binDir }
    assert.match(ctx(run('grep -rn foo src', withRg)), /rg -a/)
    assert.match(ctx(run('cd src && grep -R --include=*.ts foo .', withRg)), /rg/)
    assert.match(ctx(run('grep --recursive foo .', withRg)), /rg/)
    assert.equal(run('grep foo file.txt', withRg), null)
    // the same session gets the note once
    const once = (c) => nudge({ tool_name: 'Bash', tool_input: { command: c }, cwd: f.repo, session_id: 'same' }, { ...withRg, WB_CODEGRAPH: 'off' })
    assert.match(ctx(once('grep -r a .')), /rg/)
    assert.equal(once('grep -r b .'), null)
    assert.equal(run('rg foo', withRg), null)
    assert.equal(run('ls -la', withRg), null)
    // no rg on PATH: the note says how to install it
    assert.match(ctx(run('grep -r foo .', { ...f.env, PATH: path.join(f.base, 'empty') })), /brew install ripgrep/)
    // off by setting
    personal(f, { search: { rg_hint: false } })
    assert.equal(run('grep -r foo .', withRg), null)
  } finally {
    f.cleanup()
  }
})

test('isRecursiveGrep reads flags, not file names', () => {
  const first = (c) => parse(c, { cwd: '/', home: '/' })[0]
  assert.equal(isRecursiveGrep(first('grep -ri foo .')), true)
  assert.equal(isRecursiveGrep(first('egrep -R x .')), true)
  assert.equal(isRecursiveGrep(first('grep -n r.txt')), false)
  assert.equal(isRecursiveGrep(first('grep -e -r file')), false)
})
