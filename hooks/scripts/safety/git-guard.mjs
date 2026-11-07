// git-guard: actor x branch x action table (design 3.3).
//
// Actor
//   lane  the hook input carries agent_id (a subagent), or the target worktree
//         is registered in <git-common-dir>/lanekeeper/lanes.json
//   main  everything else
// Branch kind of the target worktree: protected · integration · lane · feature · detached
//
// Owner grants (/lanekeeper:approve or lanekeeper-grant) and gate stamps are read from the target
// repository's <git-common-dir>/lanekeeper/.
import fs from 'node:fs'
import path from 'node:path'
import { ALLOW, allow, ask, deny, matchAny, inside, readJsonSafe } from './common.mjs'
import { checkGrant, checkStamp, gateLocked, grantNeeded, prKey, prMergeLine, repoOfKey, shortHead, unbornHead } from './grant.mjs'
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
const COMMIT_WITH_VALUE = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--template', '--author', '--date', '--cleanup', '--fixup', '--squash', '--trailer'])
// Forms that build the commit from something else than the staged content a grant was given for.
// Git accepts a shortened long option, so any prefix of these counts.
const COMMIT_REBUILDS = ['--all', '--include', '--only', '--interactive', '--patch', '--pathspec-from-file']
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
  // git reads a key with no value as true
  else if (k === -1 && kv) map[kv.toLowerCase()] = 'true'
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
    // it names a variable set for the real command, so a lookup here would fail where the command would not
    if (globalOpts[i].startsWith('--config-env')) {
      if (globalOpts[i] === '--config-env') i++
      continue
    }
    rest.push(globalOpts[i])
  }
  return { cwd, cwdKnown: known, globalOpts: rest, env }
}

// Judge one parsed simple command whose name is git or gh.
export function judgeGit(cmd, ctx, depth = 0) {
  if (cmd.name === 'gh') return judgeGh(cmd, ctx)
  if (cmd.name === 'curl') return judgeCurl(cmd)
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
        // git hands -c settings and the environment on to the alias
        const parentConfig = { ...cmd.parentConfig, ...g.inlineConfig }
        for (const c of inner) Object.assign(c, { parentConfig, env: { ...cmd.env, ...c.env } })
        ctx.aliasCmds?.push(...inner)
        if (inner.some((c) => c.opaque === 'always')) return deny('shell.unresolved', { cmd: shortCmd(cmd) })
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
  if (sub === 'config') {
    const key = configWrite(args)
    if (key) return ask('git.config_content', { key })
  }
  if (sub === 'remote' && positional(args)[0] === 'add' && args.some((a) => a.text.split('=')[0].length > 3 && '--mirror'.startsWith(a.text.split('=')[0]))) {
    return ask('git.config_content', { key: 'remote add --mirror' })
  }
  if (sub === 'init') {
    const template = initTemplate(args, cmd, target)
    if (template) return ask('paths.git_control', { path: template })
  }

  const kind = classify(sub, args)
  if (!kind) return null
  // xargs appends arguments only known at run time
  if (!target.cwdKnown || (cmd.xargs && kind !== 'control')) return deny('git.unresolved', { cmd: shortCmd(cmd) })
  const real = ctx.git.info(target)
  // Not a repository: git itself will refuse. With settings or variables on the line the lookup can
  // fail for another reason, and then nothing is known about what the command would do.
  if (!real) return target.globalOpts.length || Object.keys(target.env).length ? deny('git.unresolved', { cmd: shortCmd(cmd) }) : null
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

// Why a commit under a commit-main grant may not be the content or the kind of change that was
// allowed -> 'other'|'amend'|'rebuild'|'paths', or null for a plain new commit of the staged content.
export function commitForm(sub, args) {
  if (sub !== 'commit') return 'other'
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text
    if (t === '--') return i + 1 < args.length ? 'paths' : null
    if (t.startsWith('--')) {
      const name = t.split('=')[0]
      if (name.length > 2 && '--amend'.startsWith(name)) return 'amend'
      if (name.length > 2 && COMMIT_REBUILDS.some((o) => o.startsWith(name))) return 'rebuild'
      if (COMMIT_WITH_VALUE.has(name) && !t.includes('=')) i++
    } else if (t.startsWith('-') && t.length > 1) {
      // a short cluster ends at the first letter that takes a value: -am x, -qm x, -mall
      const value = /[mFCct]/.exec(t.slice(1))
      const flags = value ? t.slice(1, 1 + value.index) : t.slice(1)
      if (/[aiop]/.test(flags)) return 'rebuild'
      if (value && 1 + value.index === t.length - 1) i++
    } else return 'paths'
  }
  return null
}

// Settings that can change what a commit contains, by running a program or moving the work tree.
const CONTENT_CONFIG = /^(core\.(hookspath|fsmonitor|worktree)|init\.templatedir|include\.path|includeif\..*\.path)$/i
const COMMIT_CONFIG = new RegExp(`${CONTENT_CONFIG.source}|^filter\\.`, 'i')
// Settings that decide where a push goes without the command line showing it.
const PUSH_CONFIG = /^(remote\.pushdefault|remote\..*\.(push|url|pushurl)|branch\..*\.(remote|pushremote|merge)|url\..*\.(insteadof|pushinsteadof))$/i
// Settings that change who answers a push to a protected branch, so the address in the grant says nothing.
const PUSH_TRANSPORT_CONFIG = /^(core\.sshcommand|core\.gitproxy|ssh\..*|remote\..*\.(receivepack|proxy))$/i
const PUSH_TRANSPORT_ENV = ['GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_PROXY_COMMAND']
const PUSH_DEFAULTS_SHOWN = new Set(['current', 'simple', 'nothing', 'upstream', 'tracking'])

// The settings this one command is given -> { config: { key: value }, unknown, env }. `unknown` means
// some of them cannot be read here; `env` means they come through GIT_CONFIG_*.
function givenConfig(cmd) {
  const g = splitGit(cmd.args)
  const config = { ...cmd.parentConfig, ...g.inlineConfig }
  const env = cmd.env || {}
  let unknown = g.globalOpts.some((o) => /^--(config-env|exec-path=)/.test(o)) || Object.keys(config).some((k) => k.includes('$'))
  if (Object.keys(env).some((k) => /^(GIT_CONFIG(_PARAMETERS|_GLOBAL|_SYSTEM)?|GIT_EXEC_PATH)$/.test(k))) unknown = true
  let fromEnv = false
  for (const [k, v] of Object.entries(env)) {
    const m = /^GIT_CONFIG_(COUNT|KEY_(\d+)|VALUE_\d+)$/.exec(k)
    if (!m) continue
    fromEnv = true
    if (!m[2]) continue
    if (v.includes('$')) unknown = true
    config[v.toLowerCase()] = env[`GIT_CONFIG_VALUE_${m[2]}`] ?? ''
  }
  return { config, unknown, env: fromEnv }
}

// A setting on the line that could change what a granted commit, merge or push runs or contains.
function contentConfig(cmd) {
  const { config, unknown, env } = givenConfig(cmd)
  return unknown || env || Object.keys(config).some((k) => COMMIT_CONFIG.test(k))
}

// A verdict that allowed a change to a protected branch does not stand with such a setting on the line.
function withoutContentConfig(v, cmd, vars) {
  return v.decision === ALLOW && contentConfig(cmd) ? deny('grant.config', { ...vars, cmd: shortCmd(cmd) }) : v
}

const INIT_WITH_VALUE = new Set(['--template', '-b', '--initial-branch', '--object-format', '--ref-format', '--separate-git-dir'])

// A bare repository created in a folder that does not exist yet has no hooks to fill, so its template
// changes nothing that is here. Anything less certain than that counts as filling.
function initsNewBare(args, cmd, target) {
  if (!args.some((a) => a.text === '--bare') || args.some((a) => a.dynamic) || cmd.env?.GIT_DIR !== undefined) return false
  const dir = positional(args, INIT_WITH_VALUE)[0]
  return !!dir && !fs.existsSync(path.resolve(target.cwd, dir))
}

// `git init` run again fills .git/hooks from a template, in an existing repository too -> what names it, or null.
function initTemplate(args, cmd, target) {
  const { config, unknown } = givenConfig(cmd)
  if (initsNewBare(args, cmd, target)) return null
  const option = args.find((a) => /^--t[a-z]*(=|$)/.test(a.text) && '--template'.startsWith(a.text.split('=')[0]))
  if (option) return option.text
  if (cmd.env?.GIT_TEMPLATE_DIR !== undefined) return 'GIT_TEMPLATE_DIR'
  if (config['init.templatedir'] !== undefined) return 'init.templateDir'
  return unknown ? 'GIT_CONFIG' : null
}

// `git config` writing a setting that can change what commits contain or where a push goes -> the key, or null.
function configWrite(args) {
  const VERBS = new Set(['set', 'unset', 'get', 'list', 'edit', 'rename-section', 'remove-section'])
  const pos = positional(args, new Set(['--file', '-f', '--blob', '--default', '--type', '--comment', '--value', '--fixed-value']))
  const o = opts(args)
  const verb = VERBS.has(pos[0]) ? pos.shift() : null
  if (verb === 'edit' || o.includes('-e') || o.includes('--edit')) return 'edit'
  const reads = verb === 'get' || verb === 'list' || o.some((x) => /^--(get|list|get-all|get-regexp|get-urlmatch|show-)/.test(x) || x === '-l')
  const writes = verb === 'set' || verb === 'unset' || o.some((x) => /^--(add|unset|unset-all|replace-all)$/.test(x)) || pos.length > 1
  if (reads || !writes || !pos[0]) return null
  return CONTENT_CONFIG.test(pos[0]) || /^remote\..*\.(push|mirror)$/i.test(pos[0]) || pos[0].includes('$') ? pos[0] : null
}

// With remote.<name>.mirror true, a push to that remote overwrites all its refs, like --mirror.
function mirrorRemote(p, cmd, target, info, ctx) {
  const name = p.remote || ctx.git.defaultRemote(target, info.branch)
  const given = givenConfig(cmd).config[`remote.${name.toLowerCase()}.mirror`]
  if (given === undefined) return ctx.git.configBool(target, `remote.${name}.mirror`) === 'true'
  return given.includes('$') || /^(true|yes|on)$/i.test(given) || (/^-?\d+$/.test(given) && Number(given) !== 0)
}

// A push whose destination cannot be told from the command line, so it counts like --all.
// A refspec without `:` is not what it looks like when remote.<name>.push is set: git takes the
// destination from that setting. Only refspecs with `:` and deletions show where they go.
function pushUnknowable(p, cmd, target, info, f, ctx) {
  if (mirrorRemote(p, cmd, target, info, ctx)) return true
  for (const r of p.refspecs) {
    if (!r || /[*?{}$`]/.test(r)) return true
    const k = r.indexOf(':')
    if (k !== -1 && k === r.length - 1) return true
  }
  const srcOnly = !p.del && p.refspecs.some((r) => !r.includes(':'))
  if (p.refspecs.length && !srcOnly && !refspecDests(p, info).some((d) => f.isProtected(d.dst))) return false
  const { config, unknown, env } = givenConfig(cmd)
  if (unknown || env || Object.keys(config).some((k) => PUSH_CONFIG.test(k))) return true
  if (config['push.default'] !== undefined && !PUSH_DEFAULTS_SHOWN.has(config['push.default'].toLowerCase())) return true
  if (!srcOnly && (p.refspecs.length || p.tagsOnly)) return false
  if (!p.refspecs.length) {
    const def = ctx.git.configGet(target, 'push.default').at(-1)
    if (def && !PUSH_DEFAULTS_SHOWN.has(def.toLowerCase())) return true
  }
  return ctx.git.configGet(target, `remote.${p.remote || ctx.git.defaultRemote(target, info.branch)}.push`).length > 0
}

const QUIET_GIT = new Set(['status', 'diff', 'log', 'show', 'rev-parse'])
const QUIET_NAMES = new Set(['cat', 'less', 'more', 'head', 'tail', 'ls', 'stat', 'test', '[', 'jq', 'wc', 'file', 'grep', 'rg', 'diff', 'echo', 'printf', 'cd', 'pushd', 'popd', 'pwd', 'true', 'false', 'date', 'sleep'])

// A command that cannot change the staged content on the same line as a commit under a grant.
export function quietCommand(cmd) {
  if (cmd.redirs?.some((r) => r.op.includes('>') && r.target !== '/dev/null')) return false
  if (cmd.name === 'git') return QUIET_GIT.has(splitGit(cmd.args).sub)
  return QUIET_NAMES.has(cmd.name)
}

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
  let r = ref.replace(/^(refs\/)?heads\//, '').replace(/^refs\/remotes\//, '')
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
    case 'commit': {
      if (!onProtected) return allow()
      const form = commitForm(sub, args)
      const index = form || contentConfig(cmd) ? undefined : ctx.git.writeTree(target)
      const v = withGrant(ctx, info, 'commit-main', info.head || (ctx.git.unborn(target) ? unbornHead(info.branch) : null), false, vars, cmd, { index })
      if (v.decision !== ALLOW) return v
      if (form) return deny(`grant.commit_${form}`, { ...vars, cmd: shortCmd(cmd) })
      return withoutContentConfig({ ...v, stagedBound: true }, cmd, vars)
    }
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
      return withoutContentConfig(withGrant(ctx, info, 'merge-main', sha, true, { ...vars, source: srcs[0] }, cmd, { dest: info.branch }), cmd, vars)
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

// The options of a push as git reads them: the value of an option is not an option itself.
function pushOptions(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text
    if (t === '--') break
    if (!t.startsWith('-') || t === '-') continue
    out.push(t)
    const name = t.split('=')[0]
    if (t.includes('=')) continue
    if (name.startsWith('--') ? [...PUSH_WITH_VALUE].some((o) => o.startsWith(name)) : name.endsWith('o')) i++
  }
  return out
}

// The last --[no-]dry-run counts. Anything unread on the line means it is not known to be a dry run.
function isDryRun(args) {
  if (args.some((a) => a.dynamic)) return false
  let dry = false
  for (const x of pushOptions(args)) {
    const name = x.split('=')[0]
    if (name.startsWith('--')) {
      if (name.length > 3 && '--dry-run'.startsWith(name)) dry = true
      else if (name.length > 3 && '--no-dry-run'.startsWith(name)) dry = false
    } else {
      const letters = name.slice(1)
      const value = letters.indexOf('o')
      if ((value === -1 ? letters : letters.slice(0, value)).includes('n')) dry = true
    }
  }
  return dry
}

// A setting or option that changes who answers a push -> true.
function pushTransport(cmd) {
  const { config } = givenConfig(cmd)
  if (Object.keys(config).some((k) => PUSH_TRANSPORT_CONFIG.test(k))) return true
  if (PUSH_TRANSPORT_ENV.some((k) => cmd.env?.[k] !== undefined)) return true
  return pushOptions(splitGit(cmd.args).args).some((x) => {
    const name = x.split('=')[0]
    return name.startsWith('--') && name.length > 3 && ['--exec', '--receive-pack'].some((o) => o.startsWith(name))
  })
}

export function parsePush(args) {
  const o = opts(args)
  // Git accepts a shortened long option, so any prefix counts.
  const long = (...names) => o.some((x) => x.startsWith('--') && x.split('=')[0].length > 2 && names.some((n) => n.startsWith(x.split('=')[0])))
  const force =
    long('--force', '--force-with-lease', '--force-if-includes') || o.some((x) => x.startsWith('--force-with-lease') || /^-[A-Za-z]*f/.test(x)) ||
    positional(args, PUSH_WITH_VALUE).slice(1).some((r) => r.startsWith('+'))
  const dry = isDryRun(args)
  const all = long('--all', '--mirror', '--branches')
  const del = long('--delete') || o.some((x) => x === '-d' || /^-[A-Za-z]*d/.test(x))
  const tagsOnly = long('--tags')
  const withTags = tagsOnly || long('--follow-tags')
  const pos = positional(args, PUSH_WITH_VALUE)
  const repoAt = args.findIndex((a) => a.text === '--repo' || a.text.startsWith('--repo='))
  const repo = repoAt === -1 ? null : args[repoAt].text.startsWith('--repo=') ? args[repoAt].text.slice(7) : args[repoAt + 1]?.text
  const remote = pos[0] || repo || null
  // `tag <name>` is one refspec written as two words, the same as refs/tags/<name>:refs/tags/<name>
  const refspecs = pos.slice(1).flatMap((r, i, all) => (r === 'tag' && all[i + 1] !== undefined ? [`refs/tags/${all[i + 1]}:refs/tags/${all[i + 1]}`] : all[i - 1] === 'tag' ? [] : [r]))
  return { force, dry, all, del, tagsOnly, withTags, remote, refspecs }
}

// Where each written-out refspec goes. refs/remotes/... on the remote is not one of its branches.
const pushDest = (r) => (r.startsWith('refs/remotes/') ? r : branchName(r))
function refspecDests(p, info) {
  return p.refspecs.map((r) => {
    if (p.del) return { src: null, dst: pushDest(r), delete: true }
    const k = r.indexOf(':')
    if (k === 0) return { src: null, dst: pushDest(r.slice(1)), delete: true }
    if (k > 0) return { src: r.slice(0, k), dst: pushDest(r.slice(k + 1)) }
    return { src: r, dst: r === 'HEAD' || r === '@' ? info.branch : pushDest(r) }
  })
}

function judgePush(args, target, info, f, ctx, vars, cmd) {
  const p = parsePush(args)
  if (p.dry) return allow()
  if (p.force) return deny('git.force_push', vars)
  if (p.all || pushUnknowable(p, cmd, target, info, f, ctx)) return deny('git.push_all', vars)
  // destinations
  const dests = []
  if (!p.refspecs.length) {
    if (p.tagsOnly) return pushFeature(f, vars)
    const up = ctx.git.upstream(target)
    dests.push({ src: 'HEAD', dst: up ? branchName(up) : info.branch })
  } else dests.push(...refspecDests(p, info))
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
      const named = p.remote || ctx.git.defaultRemote(target, info.branch)
      const remote = named.includes('$') ? null : ctx.git.pushAddress(target, named)
      // the tags go along under a grant that only showed this commit, so it counts as a second change
      if (p.withTags) ctx.landings = (ctx.landings || 0) + 1
      const pushVars = { ...vars, branch: d.dst, target: d.dst }
      const v = withoutContentConfig(withGrant(ctx, info, 'push-main', sha, true, pushVars, cmd, { dest: d.dst, remote }), cmd, pushVars)
      out.push(v.decision === ALLOW && pushTransport(cmd) ? deny('grant.config', { ...pushVars, cmd: shortCmd(cmd) }) : v)
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

// The gate stamp for this commit, also read by the dialog that shows whether there is one.
export function stampFor(ctx, stateDir, cwd, sha) {
  const t = { cwd, globalOpts: [], env: {} }
  const resultsOnly = (from) => !!sha && !!ctx.git.changedSince && onlyUnder(resultsPrefix(ctx.config), ctx.git.changedSince(t, from, sha))
  return checkStamp(stateDir, ctx.config.project?.git?.gate_stamp, sha, resultsOnly)
}

// Allowed only with a matching unused owner grant (and gate stamp when a gate
// command is configured). The grant is consumed when the whole command passes.
function withGrant(ctx, info, action, sha, needStamp, vars, cmd, bind = {}) {
  ctx.landings = (ctx.landings || 0) + 1
  ctx.landedCmds?.push(cmd)
  const short = sha ? shortHead(sha) : '?'
  const g = checkGrant(info.stateDir, action, sha, ctx.now, bind)
  if (!g.ok) return deny(`grant.${g.why}`, { ...vars, action, head: short, granted: g.grant?.head ? shortHead(g.grant.head) : '-', dest: bind.dest ?? '-', grantedDest: g.grant?.dest ?? '-', remote: bind.remote ?? '-', grantedRemote: g.grant?.remoteUrl ?? '-', ttl: ctx.config.project?.git?.owner_grant_ttl_min || 15 })
  const gateCmd = ctx.config.project?.gate?.command
  if (needStamp && gateCmd) {
    const s = stampFor(ctx, info.stateDir, info.top, sha)
    if (!s.ok) return deny(`stamp.${s.why}`, { ...vars, action, head: short, stamped: s.stamp?.head?.slice(0, 9) || '-' })
  }
  return allow({ consume: { stateDir: info.stateDir, by: shortCmd(cmd) } })
}

// Reads the words of a gh command by its option table -> { positional, seen, values, known }. A short
// option is held under its long name, and an option not in the table makes the line unreadable.
function readGhWords(words, { flags, values, short }) {
  const out = { positional: [], seen: new Set(), values: {}, known: true }
  const hold = (name, value) => {
    if (value === undefined) out.known = false
    else (out.values[name] ||= []).push(value)
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w === '--') {
      out.positional.push(...words.slice(i + 1))
      break
    }
    if (w.startsWith('--')) {
      const eq = w.indexOf('=')
      const name = eq === -1 ? w : w.slice(0, eq)
      if (values.has(name)) hold(name, eq === -1 ? words[++i] : w.slice(eq + 1))
      else if (flags.has(name)) out.seen.add(name)
      else out.known = false
    } else if (w.length > 1 && w.startsWith('-')) {
      for (let j = 1; j < w.length; j++) {
        const name = short[w[j]]
        if (flags.has(name)) {
          out.seen.add(name)
          continue
        }
        if (!values.has(name)) {
          out.known = false
          break
        }
        hold(name, w.slice(j + 1).replace(/^=/, '') || words[++i])
        break
      }
    } else out.positional.push(w)
  }
  return out
}

const GH_MERGE_OPTIONS = {
  flags: new Set(['--admin', '--auto', '--delete-branch', '--disable-auto', '--merge', '--rebase', '--squash']),
  values: new Set(['--author-email', '--body', '--body-file', '--match-head-commit', '--repo', '--subject']),
  short: { A: '--author-email', F: '--body-file', R: '--repo', b: '--body', d: '--delete-branch', m: '--merge', r: '--rebase', s: '--squash', t: '--subject' },
}
const GH_API_OPTIONS = {
  flags: new Set(['--include', '--paginate', '--silent', '--slurp', '--verbose']),
  values: new Set(['--cache', '--field', '--header', '--hostname', '--input', '--jq', '--method', '--preview', '--raw-field', '--template']),
  short: { F: '--field', H: '--header', X: '--method', f: '--raw-field', i: '--include', p: '--preview', q: '--jq', t: '--template' },
}

// gh runs an extension or an alias for any other first word, so what such a word does is unknown.
// `co` is one of those aliases, kept out because its definition is in a file. help topics are harmless.
const GH_COMMANDS = new Set(['accessibility', 'actions', 'agent-task', 'alias', 'api', 'attestation', 'auth', 'browse', 'cache', 'codespace', 'completion', 'config', 'copilot', 'cs', 'environment', 'exit-codes', 'ext', 'extension', 'extensions', 'formatting', 'gist', 'gpg-key', 'help', 'issue', 'label', 'licenses', 'mintty', 'org', 'pr', 'preview', 'project', 'reference', 'release', 'repo', 'rs', 'ruleset', 'run', 'search', 'secret', 'ssh-key', 'status', 'variable', 'version', 'workflow'])
const GH_PR_READS_OR_ELSE = new Set(['checkout', 'checks', 'close', 'comment', 'create', 'diff', 'edit', 'list', 'lock', 'ls', 'new', 'ready', 'reopen', 'revert', 'review', 'status', 'unlock', 'update-branch', 'view'])
const GH_SECOND_WORD = new Set(['pr', 'repo', 'alias', 'extension', 'extensions', 'ext'])
const GH_EXTENSION_SAFE = new Set(['browse', 'list', 'ls', 'remove', 'search'])

// The words that decide what gh runs, or null when they cannot be read from the line. gh takes the word
// after an unknown option as that option's value when it looks for the subcommand, and the same word can
// come back later as the PR. So only -R and --repo may come before a subcommand.
function ghCommandPath(args) {
  const words = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text
    if (args[i].dynamic) return null
    if (t === '-R' || t === '--repo') {
      if (args[++i]?.dynamic) return null
    } else if (t.startsWith('-')) {
      if (!/^(-R.|--repo=)/.test(t)) return null
    } else {
      words.push(t)
      if (words.length === 2 || !GH_SECOND_WORD.has(words[0])) return words
    }
  }
  return words
}

// What moves or unprotects a branch, as the path of a REST call.
const BRANCH_WRITE = /(^|\/)(pulls\/[^/]+\/merge|merges|merge-upstream|git\/refs?(\/.+)?|contents(\/.+)?|branches\/.+\/(rename|protection(\/.+)?)|rulesets(\/.+)?)$/i
const decodedPath = (t) => {
  let s = t
  try {
    s = decodeURIComponent(t)
  } catch {}
  return s.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '')
}

// A query in the line itself can be read. A file, or a mutation of any name, cannot be told from a merge.
function graphqlOnlyReads(api) {
  if (api.values['--input']) return false
  const queries = [...(api.values['--raw-field'] || []), ...(api.values['--field'] || [])].filter((f) => f.startsWith('query='))
  return queries.length === 1 && /^\s*(query\b|\{)/.test(queries[0].slice(6)) && !/\bmutation\b/i.test(queries[0])
}

function judgeGhApi(cmd) {
  const refused = deny('gh.unresolved', {})
  if (cmd.args.some((a) => a.dynamic)) return refused
  const words = cmd.args.map((a) => a.text)
  const api = readGhWords(words.slice(words.indexOf('api') + 1), GH_API_OPTIONS)
  if (!api.known || api.positional.length !== 1) return refused
  const target = decodedPath(api.positional[0])
  if (/^(api\/)?graphql$/i.test(target)) return graphqlOnlyReads(api) ? null : refused
  const method = api.values['--method']?.at(-1)?.toUpperCase()
  const writes = method ? !['GET', 'HEAD'].includes(method) : !!(api.values['--raw-field'] || api.values['--field'] || api.values['--input'])
  return writes && BRANCH_WRITE.test(target) ? refused : null
}

// curl with an address and a method in the line. An address in a variable, and other HTTP tools, are not read.
function judgeCurl(cmd) {
  const words = cmd.args.map((a) => a.text)
  const writes = words.some((w, i) => {
    const m = /^(?:-[A-Za-z]*X|--request=?)(.*)$/.exec(w)
    if (m) return !/^(GET|HEAD)$/i.test(m[1] || words[i + 1] || '')
    return /^(-[A-Za-z]*[dFT]|--(data|form|upload-file|json))/.test(w)
  })
  if (!writes) return null
  const hits = words.some((w) => {
    const url = decodedPath(w.replace(/^--url=/, ''))
    if (/^(https?:\/\/)?(api\.github\.[^/\s]+\/|[^/\s]+\/api\/)graphql$/i.test(url)) return true
    const rest = /^(?:https?:\/\/)?[^/\s]+\/(?:api\/v3\/)?repos\/[^/]+\/[^/]+\/(.+)$/.exec(url)
    return !!rest && BRANCH_WRITE.test(rest[1])
  })
  return hits ? deny('gh.unresolved', {}) : null
}

// The one line a grant is spent on: nothing before or after it, so no folder, variable, wrapper or second
// command has a say in what gh merges or when. --match-head-commit makes the server refuse a moved head.
const GRANTED_MERGE = /^gh[ \t]+pr[ \t]+merge[ \t]+(\d+)[ \t]+--repo[ \t]+([A-Za-z0-9][A-Za-z0-9.-]*\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)[ \t]+--match-head-commit[ \t]+([0-9a-f]{40})((?:[ \t]+(?:--squash|--merge|--rebase|-d))*)$/
const isGrantedMerge = (line, number, repo, head) => {
  const m = GRANTED_MERGE.exec(String(line ?? '').trim())
  if (!m || m[1] !== String(number) || m[2] !== repo || m[3] !== head) return false
  const tail = m[4].trim().split(/[ \t]+/).filter(Boolean)
  return tail.filter((w) => w !== '-d').length <= 1 && tail.filter((w) => w === '-d').length <= 1
}

// `gh pr merge`, in any form. A number and a whole [host/]owner/name settle which PR gh merges, so only
// a line with both can pass. The lookup for other lines only serves to name the line to run instead.
function judgeGhMerge(cmd, ctx) {
  if (ctx.agentId) return deny('gh.lane_merge', {})
  const read = readGhWords(cmd.args.map((a) => a.text), GH_MERGE_OPTIONS)
  const repoWord = read.values['--repo']?.at(-1)
  const selector = read.positional[2]
  // Prefixed to the command, these name the PR's repository as --repo does.
  const env = Object.fromEntries(['GH_REPO', 'GH_HOST'].filter((k) => cmd.env?.[k] !== undefined).map((k) => [k, cmd.env[k]]))
  // With the repository written out whole, the folder gh runs in does not matter.
  const folderMatters = !/^[^/]+\/[^/]+\/[^/]+$/.test(repoWord ?? '') || !/^\d+$/.test(selector ?? '')
  const readable = read.known && read.positional.length <= 3 && (cmd.cwdKnown || !folderMatters) && !cmd.xargs && !cmd.args.some((a) => a.dynamic)
  const pr = readable ? ctx.pr({ cwd: cmd.cwd, cwdKnown: true, globalOpts: [], env }, { selector, repo: repoWord }) : null
  const key = prKey(pr)
  if (!key || !pr.base || !pr.headOid) return deny('gh.unresolved', {})
  const repo = repoOfKey(key)
  const named = selector === String(pr.number) && repoWord === repo
  const method = ['--squash', '--merge', '--rebase'].find((m) => read.seen.has(m))
  const line = prMergeLine({ number: pr.number, repo, head: pr.headOid, method, del: read.seen.has('--delete-branch') })
  const vars = { number: pr.number, repo, branch: pr.base, head: shortHead(pr.headOid), ttl: ctx.config.project?.git?.owner_grant_ttl_min || 15, line }
  const session = ctx.git.remoteAddresses({ cwd: ctx.cwd, globalOpts: [], env: {} })
  if (!grantNeeded(pr.base, repo, ctx.config.project?.git?.protected_branches, session)) return named ? allow() : deny('gh.form', vars)
  // Only a grant for this very PR, wherever the command runs. merge-main is for a merge in this folder.
  if (!checkGrant(ctx.ownerDir, 'merge-pr', pr.headOid, ctx.now, { dest: pr.base, pr: key }).ok) return deny('gh.need_grant', vars)
  if (!isGrantedMerge(ctx.commandLine, pr.number, repo, pr.headOid)) return deny('gh.form', vars)
  return allow({ consume: { stateDir: ctx.ownerDir, by: ctx.commandLine.trim().slice(0, 120) } })
}

// Every gh command is read here. What cannot be told apart from a merge is refused.
function judgeGh(cmd, ctx) {
  const refused = deny('gh.unresolved', {})
  const words = cmd.args.map((a) => a.text)
  if (words.length === 1 && /^(--version|--help|-h)$/.test(words[0])) return null
  const path = ghCommandPath(cmd.args)
  if (!path || (path[0] && !GH_COMMANDS.has(path[0]))) return refused
  const [first, second] = path
  if (first === 'pr') {
    if (second === 'merge') return judgeGhMerge(cmd, ctx)
    return second === undefined || GH_PR_READS_OR_ELSE.has(second) ? null : refused
  }
  if (first === 'api') return judgeGhApi(cmd)
  if (first === 'repo' && second === 'sync') return words.some((w) => /^--force(=|$)/.test(w)) ? refused : null
  if (first === 'alias' && ['set', 'import'].includes(second)) return refused
  if (['extension', 'extensions', 'ext'].includes(first) && second !== undefined && !GH_EXTENSION_SAFE.has(second)) return refused
  return null
}
