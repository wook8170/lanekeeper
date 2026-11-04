// L5 dispatch guard (PreToolUse Agent|Task): brief, model, wait-notify, lanes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { handle, evaluate } from '../hooks/scripts/dispatch/dispatch-guard.mjs'
import { recordLimit } from '../lib/limits.mjs'
import { ROOT, makeEnv, runScript, FABLE_ROUTING } from './l3-fixture.mjs'

const tpl = (kind, lang = 'ko') => fs.readFileSync(path.join(ROOT, 'templates', 'briefs', lang, `${kind}.md`), 'utf8')
const fill = (text, lane = 'l9') =>
  text
    .replace(/\{\{\s*lane\s*\}\}/g, lane)
    .replace(/\{\{\s*base_sha\s*\}\}/g, '1a2b3c4d')
    .replace(/\{\{\s*implementer\s*\}\}/g, 'opus')
    .replace(/\{\{\s*([\w.-]+)\s*\}\}/g, 'x-$1')
const FUTURE_S = Math.floor(Date.now() / 1000) + 7200

function setup({ denied = [], project = null } = {}) {
  const fx = makeEnv()
  fs.writeFileSync(path.join(fx.env.WB_HOME, 'routing.json'), JSON.stringify({ version: 1, ...FABLE_ROUTING, denied }))
  if (project) {
    fs.mkdirSync(path.join(fx.repo, '.wb'), { recursive: true })
    fs.writeFileSync(path.join(fx.repo, '.wb', 'config.json'), JSON.stringify({ version: 1, ...project }))
  }
  const notes = []
  const stateDir = path.join(fx.base, 'state')
  fs.mkdirSync(stateDir)
  const run = (tool_input, tool_name = 'Agent') =>
    handle({ tool_name, tool_input, cwd: fx.repo }, fx.env, { stateDir, notify: (title, body) => notes.push(body) })
  return { fx, run, notes, stateDir, limits: path.join(fx.env.CLAUDE_PLUGIN_DATA, 'limits.json') }
}
const decision = (out) => out?.hookSpecificOutput?.permissionDecision || (out ? 'context' : 'none')
const reason = (out) => out?.hookSpecificOutput?.permissionDecisionReason || out?.hookSpecificOutput?.additionalContext || ''

test('other tools are ignored', () => {
  const s = setup()
  try {
    assert.equal(s.run({ command: 'ls' }, 'Bash'), null)
  } finally {
    s.fx.cleanup()
  }
})

test('complete brief + routed model passes silently; Task is handled like Agent', () => {
  const s = setup()
  try {
    const prompt = fill(tpl('impl'))
    assert.equal(s.run({ prompt, model: 'opus', description: 'impl' }), null)
    assert.equal(s.run({ prompt, model: 'opus', description: 'impl' }, 'Task'), null)
  } finally {
    s.fx.cleanup()
  }
})

test('missing brief marker blocks; warn mode only adds context; off skips', () => {
  const s = setup()
  try {
    const out = s.run({ prompt: 'just do it', model: 'opus', description: 'implement x' })
    assert.equal(decision(out), 'deny')
    assert.match(reason(out), /wb-brief/)
  } finally {
    s.fx.cleanup()
  }
  const w = setup({ project: { dispatch: { brief: 'warn' } } })
  try {
    const out = w.run({ prompt: 'just do it', model: 'opus', description: 'implement x' })
    assert.equal(decision(out), 'context')
  } finally {
    w.fx.cleanup()
  }
  const o = setup({ project: { dispatch: { brief: 'off' } } })
  try {
    assert.equal(o.run({ prompt: 'just do it', model: 'opus', description: 'implement x' }), null)
  } finally {
    o.fx.cleanup()
  }
})

test('incomplete brief lists the missing items in the block message', () => {
  const s = setup()
  try {
    const prompt = fill(tpl('impl', 'en')).replace('## Test rules', '## Notes').replace(/headless/gi, 'windowless')
    const r = evaluate({ tool_name: 'Agent', tool_input: { prompt, model: 'opus' }, cwd: s.fx.repo }, s.fx.env, { stateDir: s.stateDir })
    const v = r.verdicts.find((x) => x.code === 'brief_incomplete')
    assert.deepEqual(v.vars.items, ['tests', 'headless'])
    const out = s.run({ prompt, model: 'opus' })
    assert.equal(decision(out), 'deny')
    assert.match(reason(out), /Test rules section, headless statement/)
  } finally {
    s.fx.cleanup()
  }
})

test('unfilled placeholder blocks', () => {
  const s = setup()
  try {
    const out = s.run({ prompt: fill(tpl('impl')).replace('x-goal', '{{goal}}'), model: 'opus' })
    assert.equal(decision(out), 'deny')
    assert.match(reason(out), /\{\{goal\}\}/)
  } finally {
    s.fx.cleanup()
  }
})

test('model missing blocks with the routed model; denied model blocks with the next one', () => {
  const s = setup({ denied: ['fable'] })
  try {
    const prompt = fill(tpl('review'))
    let out = s.run({ prompt })
    assert.equal(decision(out), 'deny')
    assert.match(reason(out), /model: "opus"/)
    out = s.run({ prompt, model: 'fable' })
    assert.equal(decision(out), 'deny')
    assert.match(reason(out), /routing\.denied/)
    assert.equal(s.run({ prompt, model: 'opus' }), null)
  } finally {
    s.fx.cleanup()
  }
})

test('declared task floor binds: sonnet for review is blocked', () => {
  const s = setup()
  try {
    const out = s.run({ prompt: fill(tpl('review')), model: 'sonnet' })
    assert.equal(decision(out), 'deny')
    assert.match(reason(out), /floor|바닥선/)
  } finally {
    s.fx.cleanup()
  }
})

test('allowed but not the first choice gives advice, not a block', () => {
  const s = setup()
  try {
    const out = s.run({ prompt: fill(tpl('docs')), model: 'opus' })
    assert.equal(decision(out), 'context')
    assert.match(reason(out), /sonnet/)
  } finally {
    s.fx.cleanup()
  }
})

test('quota: exhausted model is blocked with the next one; "*" blocks, notifies and waits', () => {
  const s = setup()
  try {
    recordLimit(s.limits, { model: 'opus', untilEpoch: FUTURE_S, scope: '5h' })
    let out = s.run({ prompt: fill(tpl('impl')), model: 'opus' })
    assert.equal(decision(out), 'deny')
    assert.match(reason(out), /sonnet/)
    assert.equal(s.run({ prompt: fill(tpl('impl')), model: 'sonnet' }), null)
    recordLimit(s.limits, { model: '*', untilEpoch: FUTURE_S })
    out = s.run({ prompt: fill(tpl('impl')), model: 'sonnet' })
    assert.equal(decision(out), 'deny')
    assert.match(reason(out), /\/model/)
    assert.equal(s.notes.length, 1)
  } finally {
    s.fx.cleanup()
  }
})

test('floor reached: design with fable denied and opus exhausted waits, never sonnet', () => {
  const s = setup({ denied: ['fable'] })
  try {
    recordLimit(s.limits, { model: 'opus', untilEpoch: FUTURE_S, scope: '5h' })
    const prompt = fill(tpl('research')).replace('type=research', 'type=design')
    for (const model of [undefined, 'sonnet', 'opus']) {
      const out = s.run({ prompt, model })
      assert.equal(decision(out), 'deny', String(model))
    }
    assert.ok(s.notes.length >= 2)
    assert.match(s.notes[0], /opus/)
  } finally {
    s.fx.cleanup()
  }
})

test('differ_from: adversarial brief with implementer=opus routes to fable, same model when fable is denied', () => {
  const s = setup()
  try {
    const prompt = fill(tpl('review')).replace('type=review', 'type=adversarial')
    assert.equal(decision(s.run({ prompt, model: 'opus' })), 'deny')
    assert.equal(s.run({ prompt, model: 'fable' }), null)
  } finally {
    s.fx.cleanup()
  }
  const d = setup({ denied: ['fable'] })
  try {
    const prompt = fill(tpl('review')).replace('type=review', 'type=adversarial')
    const out = d.run({ prompt, model: 'opus' })
    assert.equal(decision(out), 'context')
    assert.match(reason(out), /fresh context|새 문맥/)
  } finally {
    d.fx.cleanup()
  }
})

test('exempt agents skip the brief; fork skips the model check; denied still applies', () => {
  const s = setup({ denied: ['fable'] })
  try {
    assert.equal(s.run({ prompt: 'how do hooks work?', subagent_type: 'claude-code-guide' }), null)
    assert.equal(s.run({ prompt: 'side task', subagent_type: 'fork', model: 'fable' }), null)
    assert.equal(decision(s.run({ prompt: 'q', subagent_type: 'claude-code-guide', model: 'fable' })), 'deny')
  } finally {
    s.fx.cleanup()
  }
})

test('unknown task type in the marker blocks', () => {
  const s = setup()
  try {
    const out = s.run({ prompt: fill(tpl('impl')).replace('type=impl-multi', 'type=bogus'), model: 'opus' })
    assert.equal(decision(out), 'deny')
    assert.match(reason(out), /bogus/)
  } finally {
    s.fx.cleanup()
  }
})

test('lane cap: a new lane is blocked when lanes.json is full; a known lane passes', () => {
  const s = setup()
  try {
    const lanes = ['l1', 'l2', 'l3'].map((id) => ({ id, branch: `wb/mvp/${id}`, worktree: `/w/${id}` }))
    fs.writeFileSync(path.join(s.stateDir, 'lanes.json'), JSON.stringify({ lanes }))
    let out = s.run({ prompt: fill(tpl('impl'), 'l9'), model: 'opus' })
    assert.equal(decision(out), 'deny')
    assert.match(reason(out), /machine\.lanes\.max/)
    out = s.run({ prompt: fill(tpl('impl'), 'l2'), model: 'opus' })
    assert.equal(out, null)
  } finally {
    s.fx.cleanup()
  }
})

test('the hook script runs as a process and answers in the configured language', () => {
  const fx = makeEnv()
  try {
    fs.writeFileSync(path.join(fx.env.WB_HOME, 'personal.json'), JSON.stringify({ version: 1, language: 'ko' }))
    const r = runScript('hooks/scripts/dispatch/dispatch-guard.mjs', { tool_name: 'Agent', tool_input: { prompt: 'x', model: 'opus' }, cwd: fx.repo }, fx.env)
    assert.equal(r.status, 0, r.err)
    assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /지시서 표지/)
  } finally {
    fx.cleanup()
  }
})

test('hooks.json registers the guard for Agent|Task', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
  const e = h.hooks.PreToolUse.find((x) => x.matcher === 'Agent|Task')
  assert.ok(e && /dispatch-guard\.mjs/.test(e.hooks[0].command))
})

test('every dispatch code used in source has ko and en messages', () => {
  const src = ['lib/route.mjs', 'hooks/scripts/dispatch/dispatch-guard.mjs'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
  const codes = new Set([...src.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]))
  assert.ok(codes.size >= 15)
  for (const lang of ['ko', 'en']) {
    const msgs = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${lang}.json`), 'utf8'))
    for (const c of codes) {
      assert.ok(msgs[`dispatch.${c}.why`], `${lang} dispatch.${c}.why`)
      assert.ok(msgs[`dispatch.${c}.fix`], `${lang} dispatch.${c}.fix`)
    }
  }
})
