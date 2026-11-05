#!/usr/bin/env node
// PreToolUse safety hook (Bash · Write · Edit · MultiEdit · NotebookEdit · Skill).
// Guards: git, kill, rm, browser, protected paths, protected data (data-guard).
//
// Runs every guard on the tool call and answers with the strictest verdict:
//   deny  -> permissionDecision "deny" with a three-part message
//   ask   -> permissionDecision "ask"
//   allow -> no output (the normal permission flow continues)
// Fail-closed: a settings error blocks guarded commands, and any internal
// error blocks the call.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig, projectRoot, stateDir, lanekeeperHome } from '../../../lib/config.mjs'
import { ALLOW, DENY, combine, deny, formatReasons } from './common.mjs'
import { parse } from './shell.mjs'
import { judgeGit } from './git-guard.mjs'
import { judgeKill } from './kill-guard.mjs'
import { judgeRm } from './destructive.mjs'
import { judgeBrowser } from './browser-guard.mjs'
import { judgeBashPaths, judgeFileTool } from './paths.mjs'
import { judgeData, judgeDataFile } from './data-guard.mjs'
import { consumeGrant } from './grant.mjs'
import { realGit, realListenPorts, realPr } from './context.mjs'

const GUARDED_WORDS = /\b(push|merge|rebase|commit|reset|stash|clean|checkout|switch|cherry-pick|revert|update-ref|kill|pkill|killall|fuser|rm|chrome|chromium|playwright|headed|open)\b/

export function buildContext(input, env = process.env, overrides = {}) {
  const cwd = input.cwd || process.cwd()
  const root = projectRoot(cwd, env)
  const resolved = resolveConfig({ projectDir: root, env })
  const sd = stateDir(root)
  return {
    cwd,
    home: env.HOME || os.homedir(),
    env,
    projectRoot: root,
    lanekeeperHome: lanekeeperHome(env),
    stateDirs: sd ? [sd] : [],
    config: resolved.config,
    configErrors: resolved.errors,
    language: resolved.effective.language,
    agentId: input.agent_id || null,
    now: Date.now(),
    git: realGit,
    listenPorts: realListenPorts,
    pr: realPr,
    pendingAliases: new Map(),
    // worktree top -> branch after a checkout/switch earlier in the same command line
    pendingBranches: new Map(),
    ...overrides,
  }
}

export function judgeCommand(command, ctx) {
  const cmds = parse(command, { cwd: ctx.cwd, home: ctx.home })
  const verdicts = []
  for (const cmd of cmds) {
    cmd.home = ctx.home
    const vs = []
    if (cmd.dynamicName) {
      const text = cmd.words.map((w) => w.text).join(' ')
      if (GUARDED_WORDS.test(text)) vs.push(deny('shell.unresolved', { cmd: text.slice(0, 120) }))
    }
    vs.push(judgeGit(cmd, ctx), judgeKill(cmd, ctx), judgeRm(cmd, ctx), judgeBrowser(cmd), judgeBashPaths(cmd, ctx), judgeData(cmd, ctx))
    const flat = vs.flat(Infinity).filter(Boolean)
    if (ctx.configErrors?.length && flat.length) {
      verdicts.push(deny('config.broken', { file: ctx.configErrors[0].file, key: ctx.configErrors[0].path, msg: ctx.configErrors[0].msg }))
      continue
    }
    verdicts.push(...flat)
  }
  return combine(verdicts)
}

export function judgeTool(input, ctx) {
  const tool = input.tool_name
  const ti = input.tool_input || {}
  if (tool === 'Bash') return judgeCommand(String(ti.command || ''), ctx)
  if (tool === 'Skill') {
    const s = String(ti.skill || '').replace(/^\//, '')
    return combine([s === 'lanekeeper:approve' || s === 'approve' ? deny('approve.model', {}) : null])
  }
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const file = ti.file_path || ti.notebook_path
    const v = judgeFileTool(file, ctx)
    const d = judgeDataFile(file, ctx)
    if (ctx.configErrors?.length && ((v && v.code !== 'paths.config') || d)) return combine([deny('config.broken', { file: ctx.configErrors[0].file, key: ctx.configErrors[0].path, msg: ctx.configErrors[0].msg })])
    return combine([v, d])
  }
  return combine([])
}

function output(decision, reason) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } })
}

// Judge one hook input and consume any owner grant the verdict relies on.
export function evaluate(input, env = process.env, overrides = {}) {
  const ctx = buildContext(input, env, overrides)
  const r = judgeTool(input, ctx)
  if (r.decision !== DENY) for (const c of r.consume) consumeGrant(c.stateDir, c.by, ctx.now)
  return { ...r, language: ctx.language }
}

export function runHook(raw, env = process.env, overrides = {}) {
  let lang = /^ko/i.test(env.LC_ALL || env.LC_MESSAGES || env.LANG || '') ? 'ko' : 'en'
  try {
    const r = evaluate(JSON.parse(raw || '{}'), env, overrides)
    lang = r.language
    if (r.decision === ALLOW) return ''
    return output(r.decision, formatReasons(lang, r.reasons))
  } catch (e) {
    return output(DENY, formatReasons(lang, [{ decision: DENY, code: 'internal', vars: { msg: String(e?.message || e).slice(0, 200) } }]))
  }
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (raw += c))
  process.stdin.on('end', () => {
    const out = runHook(raw)
    if (out) process.stdout.write(`${out}\n`)
    process.exit(0)
  })
}
