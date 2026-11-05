// git-guard: actor x branch x action table (design 3.3).
//
// Actor
//   lane  the hook input carries agent_id (a subagent), or the target worktree
//         is registered in <git-common-dir>/lanekeeper/lanes.json
//   main  everything else
// Branch kind of the target worktree: protected · integration · lane · feature · detached
//
// Owner grants (/lanekeeper:approve) and gate stamps are read from the target
// repository's <git-common-dir>/lanekeeper/.
import path from 'node:path'
import { allow, ask, deny, matchAny, inside, readJsonSafe } from './common.mjs'
import { checkGrant, checkStamp, gateLocked } from './grant.mjs'
import { parse, tokenize } from './shell.mjs'
import { onlyUnder, resultsPrefix } from '../../../lib/testresults.mjs'
import { laneCommitPolicy } from '../../../lib/brief.mjs'

const GLOBAL_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])
const BUILTIN = new Set([
  'add', 'am', 'apply', 'archive', 'bisect', 'blame', 'branch', 'bundle', 'cat-file', 'check-ignore', 'checkout', 'cherry',
  'cherry-pick', 'clean', 'clone', 'commit', 'commit-tree', 'config', 'describe', 'diff', 'difftool', 'fetch', 'for-each-ref',
  'format-patch', 'fsck', 'gc', 'grep', 'help', 'init', 'log', 'ls-files', 'ls-remote', 'ls-tree', 'merge', 'merge-base',
  'mergetool', 'mv', 'notes', 'pull', 'push', 'range-diff', 'rebase', 'reflog', 'remote', 'replace', 'reset', 'restore',
  'rev-list', 'rev-parse', 'revert', 'rm', 'shortlog', 'show', 'show-ref', 'sparse-checkout', 'stash', 'status',
  'submodule', 'switch', 'symbolic-ref', 'tag', 'update-ref', 'version', 'worktree', 'var', 'write-tree', 'read-tree',
  'hash-object', 'name-rev', 'prune', 'repack', 'maintenance', 'lfs', 'filter-branch', 'fast-import', 'whatchanged',
])
const COMMIT_LIKE = new Set(['commit', 'cherry-pick', 'revert', 'am'])
const MERGE_LIKE = new Set(['merge', 'rebase', 'pull'])
const CONTROL = new Set(['--abort', '--quit', '--skip', '--continue', '--edit-todo', '--show-current-patch'])

// Split `git [global opts] <sub> [args]`.
export function splitGit(words) {
  const globalOpts = []
  const inlineConfig = {}
  let i = 0
  while (i < words.length) {
    const t = words[i].text
    if (!t.startsWith('-')) break
    const eq = t.indexOf('=')
    const name = eq === -1 ? t : t.slice(0, eq)
    if (GLOBAL_WITH_ARG.has(name) && eq === -1) {
      globalOpts.push(t, words[i + 1]?.text ?? '')
      if (name === '-c') addConfig(inlineConfig, words[i + 1]?.text ?? '')
      i += 2
    } else {
      globalOpts.push(t)
      if (name === '-c') addConfig(inlineConfig, t.slice(eq + 1))
      i++
    }
  }
  const sub = words[i]?.text ?? ''
  return { globalOpts, inlineConfig, sub, args: words.slice(i + 1), dynamic: words.slice(0, i + 1).some((w) => w.dynamic) }
}

function addConfig(map, kv) {
  const k = kv.indexOf('=')
  if (k > 0) map[kv.slice(0, k).toLowerCase()] = kv.slice(k + 1)
}

const opts = (args) => args.filter((a) => a.text.startsWith('-')).map((a) => a.text)
const positional = (args, withValue = new Set()) => {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text
    if (t === '--') {
      out.push(...args.slice(i + 1).map((a) => a.text))
      break
    }
    if (t.startsWith('-')) {
      if (withValue.has(t)) i++
      continue
    }
    out.push(t)
  }
  return out
}
const hasShort = (args, letter) => args.some((a) => /^-[A-Za-z]+$/.test(a.text) && a.text.includes(letter))

function targetOf(cmd, globalOpts) {
  const env = {}
  for (const [k, v] of Object.entries(cmd.env)) if (k.startsWith('GIT_')) env[k] = v
  let cwd = cmd.cwd
  let known = cmd.cwdKnown
  // -C is applied by git relative to the current directory, in order
  for (let i = 0; i < globalOpts.length; i++) {
    if (globalOpts[i] === '-C') {
      const p = globalOpts[i + 1] || ''
      if (p.includes('$')) known = false
      else if (p.startsWith('/')) {
        cwd = p
        known = true
      } else if (p.startsWith('~')) {
        cwd = (cmd.home || '') + p.slice(1)
        known = true
      } else cwd = path.resolve(cwd, p)
    }
  }
  const rest = []
  for (let i = 0; i < globalOpts.length; i++) {
    if (globalOpts[i] === '-C') {
      i++
      continue
    }
    rest.push(globalOpts[i])
  }
  return { cwd, cwdKnown: known, globalOpts: rest, env }
}

// Judge one parsed simple command whose name is git or gh.
export function judgeGit(cmd, ctx, depth = 0) {
  if (cmd.name === 'gh') return judgeGh(cmd, ctx)
  if (cmd.name !== 'git') return null
  const g = splitGit(cmd.args)
  let { sub, args } = g
  const target = targetOf(cmd, g.globalOpts)

  // aliases: inline -c alias.x=..., then git config
  if (sub && !BUILTIN.has(sub)) {
    let def = g.inlineConfig[`alias.${sub.toLowerCase()}`]
    if (def === undefined && target.cwdKnown) def = ctx.git.alias(target, sub)
    if (def === undefined && ctx.pendingAliases) def = ctx.pendingAliases.get(sub.toLowerCase())
    if (def !== undefined && def !== null && depth < 4) {
      if (def.startsWith('!')) {
        const inner = parse(def.slice(1), { cwd: target.cwd, home: ctx.home })
        return inner.map((c) => judgeGit(c, ctx, depth + 1)).filter(Boolean)
      }
      const expanded = tokenize(def).tokens.filter((t) => t.type === 'word')
      const again = { ...cmd, args: [...cmd.args.slice(0, cmd.args.length - args.length - 1), ...expanded, ...args] }
      return judgeGit(again, ctx, depth + 1)
    }
  }
  // remember `git config alias.x y` for later commands in the same line
  if (sub === 'config' && ctx.pendingAliases) {
    const pos = positional(args)
    if (pos[0] && /^alias\./i.test(pos[0]) && pos[1] !== undefined) ctx.pendingAliases.set(pos[0].slice(6).toLowerCase(), pos[1])
  }
  if (g.dynamic) return mutating(sub, args) ? deny('git.unresolved', { cmd: shortCmd(cmd) }) : null

  const kind = classify(sub, args)
  if (!kind) return null
  // xargs appends arguments only known at run time
  if (!target.cwdKnown || (cmd.xargs && kind !== 'control')) return deny('git.unresolved', { cmd: shortCmd(cmd) })
  const real = ctx.git.info(target)
  if (!real) return null // not a repository: git itself will refuse
  // an earlier checkout/switch in the same command line moved this worktree:
  // judge with the branch it will be on, not the one it is on now
  const moved = ctx.pendingBranches?.get(real.top)
  if (moved?.unknown && kind !== 'switch' && kind !== 'checkout?') return deny('git.unresolved', { cmd: shortCmd(cmd) })
  const info = moved && !moved.unknown ? { ...real, branch: moved.branch, head: moved.head } : real
  const facts = describe(info, ctx)
  const v = facts.actor === 'lane' ? judgeLane(kind, sub, args, target, info, facts, ctx) : judgeMain(kind, sub, args, target, info, facts, ctx, cmd)
  if (ctx.pendingBranches && (kind === 'switch' || kind === 'checkout?')) recordSwitch(sub, args, target, info, ctx)
  return v
}

const CREATE_OPTS = new Set(['-c', '-C', '--create', '--force-create', '-b', '-B', '--orphan'])

// Branch a checkout/switch leaves the worktree on, for the commands after it.
function recordSwitch(sub, args, target, info, ctx) {
  const o = opts(args)
  let branch = null
  let unknown = false
  let created = false
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text
    const eq = t.indexOf('=')
    const name = eq === -1 ? t : t.slice(0, eq)
    if (CREATE_OPTS.has(name)) {
      branch = eq === -1 ? args[i + 1]?.text : t.slice(eq + 1)
      created = true
      break
    }
  }
  if (!created) {
    if (sub === 'checkout' && !isSwitchTarget(args, target, ctx)) return
    const pos = positional(args)
    if (o.includes('--detach') || (sub === 'switch' && o.includes('-d'))) {
      ctx.pendingBranches.set(info.top, { branch: null, head: pos[0] ? ctx.git.revParse(target, pos[0]) : info.head })
      return
    }
    if (!pos[0] || pos[0] === '-' || pos[0].startsWith('@{')) unknown = true
    else if (ctx.git.revParse(target, `refs/heads/${pos[0]}`)) branch = pos[0]
    // switch (and checkout of a remote name) creates the local branch from origin/<name>
    else if (sub === 'switch' || ctx.git.revParse(target, `refs/remotes/origin/${pos[0]}`)) branch = pos[0]
    else {
      ctx.pendingBranches.set(info.top, { branch: null, head: ctx.git.revParse(target, pos[0]) }) // a commit: detached HEAD
      return
    }
  }
  if (unknown || (created && !branch)) {
    ctx.pendingBranches.set(info.top, { unknown: true })
    return
  }
  const head = created ? info.head : ctx.git.revParse(target, branch) || info.head
  ctx.pendingBranches.set(info.top, { branch, head })
}

function mutating(sub, args) {
  return !!classify(sub, args) || !BUILTIN.has(sub)
}

const shortCmd = (cmd) => ['git', ...cmd.args.map((a) => a.text)].join(' ').slice(0, 120)

// Which table row a git command belongs to (null = not guarded).
export function classify(sub, args) {
  const o = opts(args)
  if (COMMIT_LIKE.has(sub)) return o.some((x) => CONTROL.has(x)) && sub !== 'commit' ? 'control' : 'commit'
  if (MERGE_LIKE.has(sub)) {
    if (o.some((x) => CONTROL.has(x))) return 'control'
    return sub === 'pull' ? 'pull' : sub
  }
  if (sub === 'push') return 'push'
  if (sub === 'switch') return 'switch'
  if (sub === 'checkout') {
    if (args.some((a) => a.text === '--')) return 'restore'
    if (o.some((x) => ['-b', '-B', '--orphan', '--detach', '-t', '--track'].includes(x))) return 'switch'
    return positional(args).length ? 'checkout?' : null
  }
  if (sub === 'stash') {
    const pos = positional(args)
    const verb = pos[0] || 'push'
    if (verb === 'list' || verb === 'show' || verb === 'create' || verb === 'store') return null
    if (verb === 'push' || verb === 'save') return args.some((a) => ['-m', '--message'].includes(a.text) || a.text.startsWith('--message=')) || verb === 'save' && pos.length > 1 ? null : 'stash'
    if (verb === 'clear') return 'stash'
    return pos.length > 1 ? null : 'stash' // pop/apply/drop without a named entry
  }
  if (sub === 'reset') return o.includes('--hard') || o.includes('--merge') || o.includes('--keep') ? 'reset-hard' : null
  if (sub === 'clean') return o.some((x) => x === '--force' || /^-[A-Za-z]*f/.test(x)) ? 'clean' : null
  if (sub === 'branch') {
    if (o.some((x) => ['-d', '-D', '--delete', '-f', '--force', '-m', '-M', '--move', '-c', '-C', '--copy'].includes(x) || /^-[a-zA-Z]*[dDfmMcC]/.test(x))) return 'branch'
    return null
  }
  if (sub === 'update-ref' || sub === 'symbolic-ref') return positional(args).length > 1 || o.includes('-d') ? 'ref' : null
  return null
}

function describe(info, ctx) {
  const gitCfg = ctx.config.project?.git || {}
  const protectedGlobs = gitCfg.protected_branches || []
  const ledger = readJsonSafe(path.join(info.stateDir, 'lanes.json'))
  const lanes = Array.isArray(ledger?.lanes) ? ledger.lanes : []
  const byAgent = ctx.agentId ? lanes.find((l) => l && l.agent_id === ctx.agentId) : null
  const byPath = lanes.find((l) => l && typeof l.worktree === 'string' && sameDir(l.worktree, info.top))
  const actor = ctx.agentId || byPath ? 'lane' : 'main'
  let ownBranch = null
  if (byAgent) ownBranch = byAgent.branch
  else if (byPath && !(byPath.agent_id && ctx.agentId && byPath.agent_id !== ctx.agentId)) ownBranch = byPath.branch
  else if (!byAgent && !byPath && info.linked && matchAny(info.branch, [gitCfg.lane_branch_pattern || 'lanekeeper/*/l*'])) ownBranch = info.branch
  const integrations = new Set(lanes.map((l) => l?.integration).filter(Boolean))
  if (ledger && typeof ledger.integration === 'string') integrations.add(ledger.integration)
  const isIntegration = (b) => !!b && (integrations.has(b) || matchAny(b, [gitCfg.integration_branch_pattern || 'lanekeeper/*/int']))
  const isProtected = (b) => matchAny(b, protectedGlobs, { wide: true })
  const kindOf = (b) =>
    !b ? 'detached' : isProtected(b) ? 'protected' : isIntegration(b) ? 'integration' : lanes.some((l) => l?.branch === b) || matchAny(b, [gitCfg.lane_branch_pattern || 'lanekeeper/*/l*']) ? 'lane' : 'feature'
  return {
    actor,
    lane: byAgent || byPath || null,
    own: !!ownBranch && info.branch === ownBranch && info.linked,
    ownBranch,
    branchKind: kindOf(info.branch),
    isProtected,
    isIntegration,
    kindOf,
    gitCfg,
  }
}

function sameDir(a, b) {
  return inside(path.resolve(a), path.resolve(b)) && inside(path.resolve(b), path.resolve(a))
}

// strip remote prefix / refs/heads/
function branchName(ref, remotes = ['origin', 'upstream']) {
  let r = ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '')
  for (const rm of remotes) if (r.startsWith(`${rm}/`)) return r.slice(rm.length + 1)
  return r
}

const PULL_WITH_VALUE = new Set(['-s', '--strategy', '-X', '--strategy-option', '--depth', '--deepen', '--shallow-since', '-j', '--jobs', '--upload-pack', '-o', '--server-option', '--recurse-submodules'])
const MERGE_WITH_VALUE = new Set(['-m', '-F', '--file', '-s', '--strategy', '-X', '--strategy-option', '--into-name', '--cleanup', '-S', '--gpg-sign'])
const REBASE_WITH_VALUE = new Set(['--onto', '-s', '--strategy', '-X', '--strategy-option', '-x', '--exec', '-C', '--whitespace', '-S', '--gpg-sign'])

// Sources a merge/rebase/pull takes in. null = the branch's own upstream.
function mergeSources(kind, args) {
  if (kind === 'pull') {
    const pos = positional(args, PULL_WITH_VALUE)
    return pos.length <= 1 ? null : pos.slice(1).map((r) => r.split(':')[0])
  }
  if (kind === 'merge') {
    const pos = positional(args, MERGE_WITH_VALUE)
    return pos.length ? pos : null
  }
  // rebase: upstream positional + --onto value
  const pos = positional(args, REBASE_WITH_VALUE)
  const onto = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].text === '--onto') onto.push(args[i + 1]?.text)
    else if (args[i].text.startsWith('--onto=')) onto.push(args[i].text.slice(7))
  }
  const ups = pos.slice(0, 1)
  const all = [...ups, ...onto].filter(Boolean)
  return all.length ? all : null
}

function judgeLane(kind, sub, args, target, info, f, ctx) {
  const vars = { branch: info.branch || 'HEAD', own: f.ownBranch || '-' }
  switch (kind) {
    case 'commit':
    case 'control': {
      if (!f.own) return deny('git.lane_commit', vars)
      // project.lanes.commit = on-instruction: the brief has to allow commits
      const cp = laneCommitPolicy(ctx.config, info.stateDir, f.lane?.id)
      return cp.allowed ? allow() : ask('git.lane_commit_instruction', { ...vars, lane: f.lane?.id || '-' })
    }
    case 'merge':
    case 'rebase':
    case 'pull': {
      if (!f.own) return deny('git.lane_merge', vars)
      const srcs = mergeSources(kind, args)
      const list = srcs || [ctx.git.upstream(target)].filter(Boolean)
      if (list.length && list.every((s) => f.isIntegration(branchName(s)))) return allow()
      return deny('git.lane_merge', vars)
    }
    case 'push':
      return deny('git.lane_push', vars)
    case 'switch':
      return deny('git.lane_switch', vars)
    case 'checkout?':
      return isSwitchTarget(args, target, ctx) ? deny('git.lane_switch', vars) : null
    case 'restore':
      return null
    case 'stash':
      return ask('git.stash', vars)
    case 'reset-hard':
      return ask('git.reset_hard', vars)
    case 'clean':
      return ask('git.clean', vars)
    case 'branch':
      return judgeBranch(args, f, vars)
    case 'ref':
      return deny('git.ref', vars)
    default:
      return null
  }
}

function isSwitchTarget(args, target, ctx) {
  const pos = positional(args)
  return pos.length === 1 && ctx.git.isRev(target, pos[0])
}

function judgeBranch(args, f, vars) {
  const pos = positional(args)
  if (pos.some((b) => f.isProtected(b))) return deny('git.branch_protected', { ...vars, target: pos.find((b) => f.isProtected(b)) })
  return ask('git.branch_delete', { ...vars, target: pos.join(' ') || '-' })
}

function judgeMain(kind, sub, args, target, info, f, ctx, cmd) {
  const vars = { branch: info.branch || 'HEAD' }
  const onProtected = f.branchKind === 'protected'
  switch (kind) {
    case 'commit':
      if (!onProtected) return allow()
      return withGrant(ctx, info, 'commit-main', info.head, false, vars, cmd)
    case 'control':
      return allow()
    case 'merge':
    case 'rebase':
    case 'pull': {
      const srcs = mergeSources(kind, args)
      if (!onProtected) {
        if (gateLocked(info.stateDir)) return deny('git.gate_locked', vars)
        return allow()
      }
      // syncing a protected branch with its own upstream is not a merge of new work
      const up = ctx.git.upstream(target)
      if (!srcs) return allow()
      if (srcs.every((s) => s === '@{u}' || s === '@{upstream}' || (up && s === up) || (/^(origin|upstream)\//.test(s) && branchName(s) === info.branch))) return allow()
      if (srcs.length !== 1) return deny('git.main_merge', vars)
      const sha = ctx.git.revParse(target, srcs[0])
      return withGrant(ctx, info, 'merge-main', sha, true, { ...vars, source: srcs[0] }, cmd)
    }
    case 'push':
      return judgePush(args, target, info, f, ctx, vars, cmd)
    case 'switch': {
      const o = opts(args)
      if (o.some((x) => x === '-B' || x === '-C' || x === '--force-create')) {
        const pos = positional(args)
        if (pos[0] && f.isProtected(pos[0])) return deny('git.branch_protected', { ...vars, target: pos[0] })
      }
      return allow()
    }
    case 'checkout?':
    case 'restore':
      return null
    case 'stash':
      return ask('git.stash', vars)
    case 'reset-hard':
      return ask('git.reset_hard', vars)
    case 'clean':
      return ask('git.clean', vars)
    case 'branch':
      return judgeBranch(args, f, vars)
    case 'ref': {
      const pos = positional(args)
      const ref = pos[0] || ''
      if (f.isProtected(branchName(ref)) || ref === 'HEAD' && onProtected) return deny('git.branch_protected', { ...vars, target: ref })
      return ask('git.ref', vars)
    }
    default:
      return null
  }
}

const PUSH_WITH_VALUE = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec'])

export function parsePush(args) {
  const o = opts(args)
  const force =
    o.some((x) => x === '--force' || x.startsWith('--force-with-lease') || x === '--force-if-includes' || /^-[A-Za-z]*f/.test(x)) ||
    positional(args, PUSH_WITH_VALUE).slice(1).some((r) => r.startsWith('+'))
  const dry = o.some((x) => x === '--dry-run' || x === '-n' || /^-[A-Za-z]*n/.test(x))
  const all = o.some((x) => x === '--all' || x === '--mirror' || x === '--branches')
  const del = o.some((x) => x === '--delete' || x === '-d' || /^-[A-Za-z]*d/.test(x))
  const tagsOnly = o.includes('--tags')
  const pos = positional(args, PUSH_WITH_VALUE)
  const remote = pos[0] || null
  const refspecs = pos.slice(1)
  return { force, dry, all, del, tagsOnly, remote, refspecs }
}

function judgePush(args, target, info, f, ctx, vars, cmd) {
  const p = parsePush(args)
  if (p.dry) return allow()
  if (p.force) return deny('git.force_push', vars)
  if (p.all) return deny('git.push_all', vars)
  // destinations
  const dests = []
  if (!p.refspecs.length) {
    if (p.tagsOnly) return pushFeature(f, vars)
    const up = ctx.git.upstream(target)
    dests.push({ src: 'HEAD', dst: up ? branchName(up) : info.branch })
  } else {
    for (const r of p.refspecs) {
      if (p.del) {
        dests.push({ src: null, dst: branchName(r), delete: true })
        continue
      }
      const k = r.indexOf(':')
      if (k === 0) dests.push({ src: null, dst: branchName(r.slice(1)), delete: true })
      else if (k > 0) dests.push({ src: r.slice(0, k), dst: branchName(r.slice(k + 1)) })
      else dests.push({ src: r, dst: r === 'HEAD' ? info.branch : branchName(r) })
    }
  }
  const out = []
  for (const d of dests) {
    if (!d.dst || d.dst.startsWith('refs/tags/')) {
      out.push(pushFeature(f, vars))
      continue
    }
    if (f.isProtected(d.dst)) {
      if (d.delete) {
        out.push(deny('git.branch_protected', { ...vars, target: d.dst }))
        continue
      }
      const sha = ctx.git.revParse(target, d.src || 'HEAD')
      out.push(withGrant(ctx, info, 'push-main', sha, true, { ...vars, branch: d.dst, target: d.dst }, cmd))
    } else out.push(pushFeature(f, vars))
  }
  return out
}

function pushFeature(f, vars) {
  const mode = f.gitCfg.feature_push || 'ask'
  if (mode === 'allow') return allow()
  if (mode === 'deny') return deny('git.push_feature_denied', vars)
  return ask('git.push_feature', vars)
}

// Allowed only with a matching unused owner grant (and gate stamp when a gate
// command is configured). The grant is consumed when the whole command passes.
function withGrant(ctx, info, action, sha, needStamp, vars, cmd) {
  const short = sha ? sha.slice(0, 9) : '?'
  const g = checkGrant(info.stateDir, action, sha, ctx.now)
  if (!g.ok) return deny(`grant.${g.why}`, { ...vars, action, head: short, granted: g.grant?.head?.slice(0, 9) || '-' })
  const gateCmd = ctx.config.project?.gate?.command
  if (needStamp && gateCmd) {
    const t = { cwd: info.top, globalOpts: [], env: {} }
    const resultsOnly = (from) => !!sha && !!ctx.git.changedSince && onlyUnder(resultsPrefix(ctx.config), ctx.git.changedSince(t, from, sha))
    const s = checkStamp(info.stateDir, ctx.config.project?.git?.gate_stamp, sha, resultsOnly)
    if (!s.ok) return deny(`stamp.${s.why}`, { ...vars, action, head: short, stamped: s.stamp?.head?.slice(0, 9) || '-' })
  }
  return allow({ consume: { stateDir: info.stateDir, by: shortCmd(cmd) } })
}

// gh pr merge / gh api .../merge
function judgeGh(cmd, ctx) {
  const words = cmd.args.map((a) => a.text)
  const isPrMerge = words[0] === 'pr' && words[1] === 'merge'
  const isApiMerge = words[0] === 'api' && words.some((w) => /\/pulls\/[^/]+\/merge$/.test(w)) && words.some((w, i) => (w === '-X' || w === '--method') && /^put$/i.test(words[i + 1] || ''))
  if (!isPrMerge && !isApiMerge) return null
  const target = { cwd: cmd.cwd, cwdKnown: cmd.cwdKnown, globalOpts: [], env: {} }
  const info = cmd.cwdKnown ? ctx.git.info(target) : null
  if (ctx.agentId) return deny('gh.lane_merge', {})
  if (isApiMerge) return deny('gh.unresolved', {})
  const pr = ctx.pr(target, words.slice(2))
  if (!pr || !pr.base) return deny('gh.unresolved', {})
  const protectedGlobs = ctx.config.project?.git?.protected_branches || []
  if (!matchAny(pr.base, protectedGlobs, { wide: true })) return allow()
  if (!info) return deny('gh.unresolved', {})
  return withGrant(ctx, info, 'merge-main', pr.headOid, false, { branch: pr.base, source: `PR` }, cmd)
}
