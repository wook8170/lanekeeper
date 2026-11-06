// Raises a confirmation dialog when the main session's agent runs an owner decision as a plain
// one-line command: `lanekeeper-quality accept <kind> --reason <why>` or `lanekeeper-reap --gate-lock`.
//
// Every condition below serves one promise: a person sees the dialog, and what they allow is what
// runs. Anything else is refused and points at the slash command. Measured on Claude Code 2.1.319:
// - `ask` raises the dialog in default, acceptEdits and auto.
// - dontAsk and plan raised it too, but that contradicts the documented meaning of dontAsk and the
//   purpose of plan, so they are refused. Interactive bypassPermissions was not tried and is refused.
// - `-p` refuses `ask` with no dialog.
// - `updatedInput` shows the changed command in the dialog and runs it, while the model's record
//   keeps the original. A declined call leaves no ticket in the transcript.
// - No hook event fires when a dialog is declined, so only decisions carried out are recorded.
import path from 'node:path'
import { PLUGIN_ROOT } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import * as OD from '../../../lib/owner-decisions.mjs'
import * as Q from '../../../lib/quality.mjs'
import { slotSettings } from '../../../lib/slots.mjs'
import { ask, deny } from './common.mjs'
import { READ_ONLY } from './paths.mjs'
import { base } from './shell.mjs'

const ASK_MODES = ['default', 'acceptEdits', 'auto']
const MAX_REASON = 500
// Terminal controls and invisible format characters could make the dialog differ from the record.
const UNSHOWABLE = /[\p{Cc}\p{Cf}]/u
const PLAIN_WORD = /^[\p{L}\p{N}_.,:/+@%=-]+$/u

function singleWord(s) {
  let m
  if ((m = /^'([^']*)'$/.exec(s))) return m[1]
  if ((m = /^"([^"\\$`!]*)"$/.exec(s))) return m[1]
  return PLAIN_WORD.test(s) && !s.startsWith('-') ? s : null
}

// The one line that may raise a dialog -> { action, kind?, reason? }, or null.
export function parseOwnerCall(command) {
  const line = String(command).trim()
  if (/^lanekeeper-reap[ \t]+--gate-lock$/.test(line)) return { action: 'clear-gate-lock' }
  const m = /^lanekeeper-quality[ \t]+accept[ \t]+([A-Za-z0-9][\w.-]*)[ \t]+--reason(?:[ \t]+|=)(.+)$/su.exec(line)
  if (!m) return null
  const reason = singleWord(m[2])?.trim()
  if (!reason || reason.length > MAX_REASON || UNSHOWABLE.test(reason)) return null
  return { action: 'accept-quality', kind: m[1], reason }
}

// Which owner decision a parsed command line tries to reach, in any form (wrapped, chained, by path).
// This only chooses the message: the commands themselves refuse without a ticket.
export function reachedDecision(cmds) {
  for (const cmd of cmds) {
    const words = cmd.words.map((w) => w.text)
    const i = words.findIndex((w) => ['lanekeeper-reap', 'lanekeeper-quality'].includes(base(w)))
    if (i < 0 || (i > 0 && READ_ONLY.has(cmd.name))) continue
    const rest = words.slice(i + 1)
    if (base(words[i]) === 'lanekeeper-reap') {
      if (rest.some((w) => /^--(gate-lock|dialog-ticket)(=|$)/.test(w))) return 'clear-gate-lock'
    } else if (rest.find((w) => !w.startsWith('-')) === 'accept') return 'accept-quality'
  }
  return null
}

const SLASH = { 'clear-gate-lock': '/lanekeeper:approve clear-gate-lock', 'accept-quality': '/lanekeeper:approve accept-quality <kind> --reason why' }
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`
const cliPath = (name) => shq(path.join(PLUGIN_ROOT, 'bin', name))
// What is shown comes from files an agent may have touched, so strip what a terminal would act on.
const shown = (s, max = 200) => String(s ?? '-').replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, max)

function judgeAccept(call, ctx, t) {
  const settings = Q.qualitySettings(ctx.config)
  const idx = Q.buildIndex(ctx.projectRoot, settings)
  const entry = Q.latestOf(idx.entries, call.kind)
  if (!entry) return deny('owner.none', { kind: call.kind })
  const reasons = Q.weakenedReasons(ctx.projectRoot, settings, idx, entry)
  const c = entry.counts || {}
  const v = ask('owner.accept', {
    kind: call.kind,
    commit: entry.commit.slice(0, 9),
    verdict: t(`q.verdict.${entry.verdict}`),
    counts: `${c.passed ?? '-'}/${c.total ?? '-'}`,
    weakened: shown(reasons.map((r) => t(`q.why.${r.code}`, r.vars)).join(' · ') || t('safety.owner.accept.no_weakening'), 400),
    reason: call.reason,
  })
  v.dialog = {
    action: call.action,
    content: OD.acceptContent({ kind: call.kind, reason: call.reason, entry }),
    command: (nonce) => `${cliPath('lanekeeper-quality')} accept ${call.kind} --reason=${shq(call.reason)} --dialog-ticket ${nonce}`,
  }
  return v
}

function judgeGateLock(call, ctx, sd) {
  const lock = OD.readGateLock(sd, slotSettings({ config: ctx.config, effective: {} }, (p) => p).staleMs, ctx.now)
  if (!lock) return deny('owner.lock_none', {})
  if (!lock.stale) return deny('owner.lock_active', { ageMin: lock.ageMin })
  const v = ask('owner.gate', { ageMin: lock.ageMin, pid: shown(lock.pid, 20), command: shown(lock.command) })
  v.dialog = {
    action: call.action,
    content: OD.gateLockContent(lock),
    command: (nonce) => `${cliPath('lanekeeper-reap')} --gate-lock --dialog-ticket ${nonce}`,
  }
  return v
}

// -> null when the command is not an owner decision; otherwise deny, or ask with a `dialog` field.
export function judgeOwnerCall(command, cmds, ctx) {
  const action = reachedDecision(cmds)
  if (!action) return null
  const slash = SLASH[action]
  if (ctx.agentId) return deny('owner.subagent', { slash })
  if (ctx.env.CLAUDE_CODE_ENTRYPOINT !== 'cli') return deny('owner.headless', { slash })
  if (!ASK_MODES.includes(ctx.permissionMode)) return deny('owner.mode', { mode: ctx.permissionMode ?? '?', slash })
  const call = parseOwnerCall(command)
  if (!call) return deny('owner.variant', { slash })
  const rule = OD.ownerAllowRule(ctx.projectRoot, ctx.env)
  if (rule) return deny('owner.allow_rule', { rule: rule.rule, file: rule.file, slash })
  if (ctx.configErrors?.length) return deny('config.broken', { file: ctx.configErrors[0].file, key: ctx.configErrors[0].path, msg: ctx.configErrors[0].msg })
  const sd = ctx.stateDirs[0]
  if (!sd) return deny('owner.not_git', {})
  return call.action === 'clear-gate-lock' ? judgeGateLock(call, ctx, sd) : judgeAccept(call, ctx, translator(ctx.language))
}
