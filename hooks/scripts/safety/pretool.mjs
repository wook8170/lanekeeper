#!/usr/bin/env node
// PreToolUse safety hook (Bash · Write · Edit · MultiEdit · NotebookEdit · Skill).
// Guards: git, kill, rm, browser, protected paths, protected data (data-guard), owner decisions.
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
import { issueTicket } from '../../../lib/owner-decisions.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { ALLOW, ASK, DENY, combine, deny, formatReasons } from './common.mjs'
import { parse } from './shell.mjs'
import { judgeGit, quietCommand } from './git-guard.mjs'
import { judgeKill } from './kill-guard.mjs'
import { judgeRm } from './destructive.mjs'
import { judgeBrowser } from './browser-guard.mjs'
import { judgeBashPaths, judgeFileTool } from './paths.mjs'
import { judgeData, judgeDataFile } from './data-guard.mjs'
import { judgeOwnerCall } from './owner-dialog.mjs'
import { consumeGrant, ownerDir } from './grant.mjs'
import { realGit, realListenPorts, realPr } from './context.mjs'

const GUARDED_WORDS = /\b(push|merge|rebase|commit|reset|stash|clean|checkout|switch|cherry-pick|revert|update-ref|kill|pkill|killall|fuser|rm|chrome|chromium|playwright|headed|open)\b/

const NESTED_OWNER = /lanekeeper:approve|lanekeeper-reap\b[\s\S]*--gate-lock|lanekeeper-quality\b[\s\S]*\baccept\b|lanekeeper-grant\b[\s\S]*\b(?:(?:merge|push|commit)-main|merge-pr)\b/

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
    ownerDir: ownerDir(lanekeeperHome(env)),
    stateDirs: sd ? [sd] : [],
    config: resolved.config,
    configErrors: resolved.errors,
    language: resolved.effective.language,
    agentId: input.agent_id || null,
    permissionMode: input.permission_mode,
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
  // A headless `claude -p "/lanekeeper:approve …"` would count as a typed command in that session, and
  // a nested session must not be the one to raise or answer a dialog.
  if (NESTED_OWNER.test(command) && cmds.some((c) => path.basename(c.name || '') === 'claude')) verdicts.push(deny('approve.model', {}))
  const owner = judgeOwnerCall(command, cmds, ctx)
  if (owner) verdicts.push(owner)
  ctx.landings = 0
  ctx.landedCmds = []
  ctx.aliasCmds = []
  const landed = []
  for (const cmd of cmds) {
    cmd.home = ctx.home
    const before = ctx.landings
    const vs = []
    const text = cmd.words.map((w) => w.text).join(' ')
    if (cmd.opaque === 'always' || ((cmd.dynamicName || cmd.opaque === 'guarded') && GUARDED_WORDS.test(text))) vs.push(deny('shell.unresolved', { cmd: text.slice(0, 120) }))
    vs.push(judgeGit(cmd, ctx), judgeKill(cmd, ctx), judgeRm(cmd, ctx), judgeBrowser(cmd), judgeBashPaths(cmd, ctx), judgeData(cmd, ctx))
    const flat = vs.flat(Infinity).filter(Boolean)
    if (ctx.landings > before) landed.push(cmd)
    if (ctx.configErrors?.length && flat.length) {
      verdicts.push(deny('config.broken', { file: ctx.configErrors[0].file, key: ctx.configErrors[0].path, msg: ctx.configErrors[0].msg }))
      continue
    }
    verdicts.push(...flat)
  }
  const everything = [...cmds, ...ctx.aliasCmds]
  // A grant is one change. Several on a line, or one repeated, would run under one use.
  const repeated = everything.some((c) => c.name === 'done' || c.repeats) || everything.filter((c) => c.functionCall).length > 1
  if (ctx.landings > 1 || (ctx.landings && repeated)) verdicts.push(deny('grant.once', {}))
  // The staged content was compared just now, so nothing beside the commit may change it first.
  if (verdicts.some((v) => v?.stagedBound)) {
    const other = everything.find((c) => !landed.includes(c) && !ctx.landedCmds.includes(c) && !quietCommand(c))
    if (other) verdicts.push(deny('grant.commit_alone', { cmd: other.words.map((w) => w.text).join(' ').slice(0, 120) }))
  }
  return { ...combine(verdicts), dialog: owner?.dialog }
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
    const v = judgeFileTool(file, ctx, ti)
    const d = judgeDataFile(file, ctx)
    if (ctx.configErrors?.length && ((v && v.code !== 'paths.config') || d)) return combine([deny('config.broken', { file: ctx.configErrors[0].file, key: ctx.configErrors[0].path, msg: ctx.configErrors[0].msg })])
    return combine([v, d])
  }
  return combine([])
}

function output(decision, reason, updatedInput) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason, ...(updatedInput ? { updatedInput } : {}) } })
}

// What a person reads in the dialog: the question and what each answer does, with no repair advice.
function dialogText(lang, reasons) {
  const t = translator(lang)
  return `[lanekeeper] ${reasons.flatMap((r) => [t(`safety.${r.code}.why`, r.vars), t(`safety.${r.code}.fix`, r.vars)]).join('\n')}`
}

// Judge one hook input and consume any owner grant the verdict relies on.
export function evaluate(input, env = process.env, overrides = {}) {
  const ctx = buildContext(input, env, overrides)
  const r = judgeTool(input, ctx)
  if (r.decision !== DENY) for (const c of r.consume) consumeGrant(c.stateDir, c.by, ctx.now)
  // The ticket goes out only with the dialog that carries it.
  const updatedInput = r.decision === ASK && r.dialog ? { ...input.tool_input, command: r.dialog.command(issueTicket(r.dialog.stateDir ?? ctx.stateDirs[0], r.dialog.action, r.dialog.content, ctx.now, input.session_id)) } : undefined
  return { ...r, updatedInput, language: ctx.language }
}

export function runHook(raw, env = process.env, overrides = {}) {
  let lang = /^ko/i.test(env.LC_ALL || env.LC_MESSAGES || env.LANG || '') ? 'ko' : 'en'
  try {
    const r = evaluate(JSON.parse(raw || '{}'), env, overrides)
    lang = r.language
    if (r.decision === ALLOW) return ''
    return output(r.decision, r.updatedInput ? dialogText(lang, r.reasons) : formatReasons(lang, r.reasons), r.updatedInput)
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
