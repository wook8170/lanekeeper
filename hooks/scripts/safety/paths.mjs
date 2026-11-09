// paths: protected paths (project.protected_paths), the Lanekeeper state files that
// only hooks may write (owner grant, dialog ticket, gate stamp, lane ledger), and the git
// hooks and config that can change what a commit contains, which need a person's answer.
import path from 'node:path'
import { ask, deny, globToRe, inside } from './common.mjs'
import { resolvePath } from './shell.mjs'
import { DIR, LEGACY_DIR } from '../../../lib/naming.mjs'

export const READ_ONLY = new Set(['cat', 'less', 'more', 'head', 'tail', 'ls', 'stat', 'test', '[', 'jq', 'wc', 'file', 'grep', 'rg', 'diff', 'git', 'echo', 'printf', 'lanekeeper-config'])
const WRITERS = new Set(['cp', 'mv', 'tee', 'touch', 'ln', 'install', 'rsync', 'truncate', 'dd', 'sed', 'perl', 'chmod', 'rm', 'unlink'])

// A path is state when it lives under <git-common-dir>/lanekeeper/ (or the
// <git-common-dir>/wb/ used before 0.2.0).
// The home folder and the disk of a Mac do not tell cases apart, so neither do these comparisons.
const fold = (s) => s.toLowerCase()

export function isStatePath(p, stateDirs = []) {
  if (/\/\.git\/(lanekeeper|wb)(\/|$)/i.test(p)) return true
  if (['owner-grant.json', 'owner-ticket.json'].includes(fold(path.basename(p)))) return true
  return stateDirs.some((d) => d && inside(fold(p), fold(d)))
}

// With the folder that holds the grant for a pull request, which is in no repository.
const allStateDirs = (ctx) => [...(ctx.stateDirs || []), ctx.ownerDir]

// In the words of a command that may be a script (`python -c "open('.git/hooks/x')"`).
const GIT_CONTROL_TEXT = /(^|[^A-Za-z0-9_.-])\.git\/(hooks(\/|\b)|config\b)|\.gitconfig\b|\.config\/git\/config\b/

// Commands that can name these files without a question. Any command not known to only read gets one,
// because there is no list of everything that can write: curl -o, tar, patch, go run and so on.
const READS_NAMED_FILES = new Set([...READ_ONLY, 'awk', 'bat', 'tree', 'docker', 'npm', 'pnpm', 'cd', 'pushd', 'popd'])
function readsNamedFiles(cmd, texts) {
  if (cmd.name === 'sed') return !texts.some((t) => /^-[a-zA-Z]*i/.test(t) || t.startsWith('--in-place'))
  if (cmd.name === 'find') return !texts.some((t) => /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(t))
  return READS_NAMED_FILES.has(cmd.name)
}

const isGitDir = (p, ctx) => /\/\.git$/.test(p) || (ctx.stateDirs || []).some((d) => d && p === path.dirname(d))
const insideGitDir = (p, ctx) => /\/\.git(\/|$)/.test(p) || (ctx.stateDirs || []).some((d) => d && inside(p, path.dirname(d)))

// The value of a short option, also when it is attached (-C.git) or ends a group of letters (-rt .git).
function shortValue(words, letter) {
  const i = words.findIndex((t) => new RegExp(`^-[A-Za-z]*${letter}`).test(t) && !t.startsWith('--'))
  if (i === -1) return null
  const rest = words[i].slice(words[i].indexOf(letter) + 1)
  return rest || words[i + 1] || null
}

// The words that can be where a copy lands.
function copyTargets(words) {
  const long = words.find((t) => t.startsWith('--target-directory'))
  return [long?.includes('=') ? long.split('=')[1] : long ? words[words.indexOf(long) + 1] : null, shortValue(words, 't'), words.filter((t) => !t.startsWith('-')).at(-1)].filter(Boolean)
}

// Where tar or unzip unpacks -> the folder as written, or null when the command does not unpack.
function unpackTarget(cmd, words) {
  if (cmd.name === 'tar') {
    if (!words.some((t) => t === '--extract' || t === '--get' || /^-[A-Za-z]*x/.test(t) || /^[A-Za-z]*x[A-Za-z]*$/.test(t))) return null
    const long = words.find((t) => t.startsWith('--directory'))
    return (long?.includes('=') ? long.split('=')[1] : long ? words[words.indexOf(long) + 1] : shortValue(words, 'C')) || '.'
  }
  if (cmd.name === 'unzip') {
    const opt = words.indexOf('-d')
    return opt === -1 ? '.' : words[opt + 1] || null
  }
  return null
}

// A copy or an unpacking aimed at .git itself, which can fill .git/hooks without naming it -> the target, or null.
function intoGitDir(cmd, texts, ctx) {
  const at = (t) => resolvePath(cmd.cwd, t, ctx.home)
  const words = texts.slice(1)
  if (['cp', 'mv', 'rsync', 'install', 'ln'].includes(cmd.name)) return copyTargets(words).find((t) => isGitDir(at(t), ctx)) || null
  const named = unpackTarget(cmd, words)
  return named && insideGitDir(at(named), ctx) ? named : null
}

// A folder that holds the grant folder somewhere below it: ~ and ~/.lanekeeper, and everything above them.
const aboveOwnerDir = (p, ctx) => !!ctx.ownerDir && (p === '/' || fold(ctx.ownerDir).startsWith(`${fold(p)}/`))

// `mv a ~/` lands on ~/a. A plain source keeps its own name, so it reaches the grant folder only when
// that name is the next step towards it, or when it holds the folder's name on the way down. A trailing
// slash copies what is inside, and ditto always does. The target has to be above the home of the grants,
// because such a folder exists: a move onto one that does not exist gives the source that name.
function keepsOwnName(cmd, words, target, ctx) {
  if (cmd.name === 'ditto' || !ctx.lanekeeperHome) return false
  const at = resolvePath(cmd.cwd, target, ctx.home)
  // Options change where things land (--parents, -T, rsync -R, --files-from), so only these plain ones count.
  const plainOption = (t) => (cmd.name === 'rsync' ? /^-[aPrvzqhlpogD]+$/ : /^-[RrapfvnLPHi]+$/).test(t) || ['--recursive', '--archive', '--verbose', '--progress'].includes(t)
  if (insideHome(at, ctx) || !words.every((t) => !t.startsWith('-') || plainOption(t))) return false
  const sources = words.filter((t) => !t.startsWith('-') && t !== target)
  const next = fold(path.relative(at, ctx.ownerDir).split('/')[0])
  const home = fold(path.basename(ctx.lanekeeperHome))
  return sources.length > 0 && sources.every((s) => {
    const parts = fold(s).split('/')
    return !/[*?[{$`]|^~[^/]|\/$/.test(s) && !['.', '..', next].includes(parts.at(-1)) && !parts.includes(home)
  })
}

// A tree copied or unpacked over such a folder makes the grant file without naming it -> the target, or null.
function overOwnerDir(cmd, texts, ctx) {
  const above = (t) => aboveOwnerDir(resolvePath(cmd.cwd, t, ctx.home), ctx)
  const words = texts.slice(1)
  // A link to such a folder gives it a second name that nothing here would know.
  if (cmd.name === 'ln') return words.find((t) => !t.startsWith('-') && above(t)) || null
  const recursive = words.some((t) => t === '--recursive' || t === '--archive' || (/^-[A-Za-z]+$/.test(t) && /[rRa]/.test(t)))
  if (['mv', 'rsync', 'ditto'].includes(cmd.name) || (cmd.name === 'cp' && recursive)) {
    const target = copyTargets(words).find(above)
    return target && !keepsOwnName(cmd, words, target, ctx) ? target : null
  }
  const named = unpackTarget(cmd, words)
  return named && above(named) ? named : null
}

// Whether a path with only * and ? in it can come out as the grant folder or a folder on the way to it.
// `~/*.tmp` cannot: no name that ends in .tmp is the next step down.
function globReachesOwnerDir(t, cmd, ctx) {
  const parts = fold(resolvePath(cmd.cwd, t, ctx.home)).split('/')
  const owner = fold(ctx.ownerDir).split('/')
  return parts.every((part, i) => i >= owner.length || new RegExp(`^${part.replace(/[.+^()|\\\]]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 's').test(owner[i]))
}

// A word with a glob or a brace can come out as the grant folder. The part before it shows whether it may.
function mayNameOwnerDir(word, cmd, ctx) {
  const t = word.replace(/^\$(HOME|\{HOME\})(?=\/|$)/, '~')
  const cut = t.search(/[*?[{$]/)
  if (cut === -1) return false
  const head = t.slice(0, cut)
  if (/\.(lanekeeper|wb)\/(o|ow|own|owne)?$/i.test(head)) return true
  if (!ctx.ownerDir || !fold(ctx.ownerDir).startsWith(fold(resolvePath(cmd.cwd, head, ctx.home)))) return false
  return /[[{$`]/.test(t) || globReachesOwnerDir(t, cmd, ctx)
}

const insideHome = (p, ctx) => !!ctx.lanekeeperHome && inside(fold(p), fold(ctx.lanekeeperHome))
const gitMakesTreeHere = (cmd, texts, ctx) => cmd.name === 'git' && insideHome(cmd.cwd, ctx) && texts.some((t) => ['clone', 'init', 'worktree'].includes(t))

// A variable that holds the home of the grants: `D=~/.lanekeeper/ow; cp x ${D}ner/y`.
function namesHomeInVariable(cmd, ctx) {
  const values = String(ctx.commandLine ?? '').matchAll(/(?:^|[\s;&|(])[A-Za-z_]\w*=["']?([^\s;&|"']+)/g)
  return [...values].some((m) => insideHome(resolvePath(cmd.cwd, m[1], ctx.home), ctx))
}

// Exported here, these reach every git or gh command that follows in the same shell.
const GIT_ENV = /^(GIT_CONFIG(_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS|GLOBAL|SYSTEM))?|GIT_DIR|GIT_TEMPLATE_DIR|GIT_INDEX_FILE|GIT_WORK_TREE|GH_REPO|GH_HOST)$/

export function isGitControlPath(p, ctx) {
  if (/\/\.git\/(?:worktrees\/[^/]+\/)?(?:hooks(?:\/|$)|config(?:\.worktree)?$)/.test(p)) return true
  if (ctx.home && [path.join(ctx.home, '.gitconfig'), path.join(ctx.home, '.config/git/config')].includes(p)) return true
  return (ctx.stateDirs || []).some((d) => d && (inside(p, path.join(path.dirname(d), 'hooks')) || p === path.join(path.dirname(d), 'config')))
}

export function isProtectedPath(p, root, globs) {
  if (!globs?.length) return null
  const rel = root && inside(p, root) ? path.relative(root, p) : null
  for (const g of globs) {
    const re = globToRe(g.replace(/\/$/, '/**'), {})
    if ((rel !== null && (re.test(rel) || re.test(`${rel}/`))) || re.test(p)) return g
    // a folder glob protects everything below it
    if (rel !== null && !/[*?]/.test(g) && inside(path.join(root, rel), path.join(root, g))) return g
  }
  return null
}

// Owner decisions recorded in a file: the bypassPermissions acknowledgement in
// personal.json and the accepted weakened results. Only /lanekeeper:approve writes them.
const personalFile = (ctx) => (ctx.lanekeeperHome ? path.join(ctx.lanekeeperHome, 'personal.json') : null)
const resultsRoot = (ctx) => ctx.config.project?.quality?.results_root || 'docs/test-results'
const acceptedFile = (ctx) => (ctx.projectRoot ? path.join(ctx.projectRoot, resultsRoot(ctx), 'accepted.json') : null)
const samePath = (p, file) => !!file && fold(p) === fold(file)

// Write / Edit / MultiEdit / NotebookEdit
export function judgeFileTool(file, ctx, toolInput = {}) {
  if (!file) return null
  const p = path.isAbsolute(file) ? path.normalize(file) : path.resolve(ctx.cwd, file)
  if (p === acceptedFile(ctx)) return deny('paths.accepted', { path: file })
  if (samePath(p, personalFile(ctx)) && JSON.stringify(toolInput).includes('bypass_ack')) return deny('paths.ack', { path: file })
  if (isStatePath(p, allStateDirs(ctx))) return deny('paths.state', { path: file })
  if (isLanekeeperConfigFile(p, ctx)) return ask('paths.config', { path: file })
  const hit = isProtectedPath(p, ctx.projectRoot, ctx.config.project?.protected_paths)
  if (hit) return deny('paths.protected', { path: file, glob: hit })
  if (isGitControlPath(p, ctx)) return ask('paths.git_control', { path: file })
  return null
}

export function isLanekeeperConfigFile(p, ctx) {
  return (ctx.projectRoot && [DIR, LEGACY_DIR].some((d) => p === path.join(ctx.projectRoot, d, 'config.json'))) || (insideHome(p, ctx) && fold(p).endsWith('.json'))
}

// Bash: state files may be read, never written; protected paths may not be
// redirected into or touched by file-writing commands.
export function judgeBashPaths(cmd, ctx) {
  const out = []
  const ownerCode = (t) => {
    const p = resolvePath(cmd.cwd, t, ctx.home)
    if (p === acceptedFile(ctx) || t.includes(`${resultsRoot(ctx)}/accepted.json`)) return 'paths.accepted'
    if (samePath(p, personalFile(ctx)) || /\.(lanekeeper|wb)\/personal\.json/i.test(t)) return 'paths.ack'
    return null
  }
  const mentions = (t) => /owner-(grant|ticket)/i.test(t) || /\.git\/(lanekeeper|wb)\//i.test(t) || /\.(lanekeeper|wb)\/owner(\/|$)/i.test(t) || allStateDirs(ctx).some((d) => d && fold(t).includes(fold(d)))
  for (const r of cmd.redirs) {
    if (!/>/.test(r.op) || !r.target || /^&?\d$/.test(r.target)) continue
    const p = resolvePath(cmd.cwd, r.target, ctx.home)
    if (mentions(r.target) || isStatePath(p, allStateDirs(ctx))) out.push(deny('paths.state', { path: r.target }))
    else if (mayNameOwnerDir(r.target, cmd, ctx)) out.push(deny('paths.reach', { path: r.target }))
    if (ownerCode(r.target)) out.push(deny(ownerCode(r.target), { path: r.target }))
    const hit = isProtectedPath(p, ctx.projectRoot, ctx.config.project?.protected_paths)
    if (hit) out.push(deny('paths.protected', { path: r.target, glob: hit }))
    if (isGitControlPath(p, ctx) || GIT_CONTROL_TEXT.test(r.target)) out.push(ask('paths.git_control', { path: r.target }))
  }
  const texts = cmd.words.map((w) => w.text)
  if (cmd.name && !readsNamedFiles(cmd, texts)) {
    const control = texts.find((t) => GIT_CONTROL_TEXT.test(t) || (!t.startsWith('-') && isGitControlPath(resolvePath(cmd.cwd, t, ctx.home), ctx)))
    if (control) out.push(ask('paths.git_control', { path: control }))
    // from inside .git, a file can be written without its name saying so (cd .git/hooks && curl -O ...)
    else if (insideGitDir(cmd.cwd, ctx)) out.push(ask('paths.git_control', { path: cmd.cwd }))
  }
  const target = intoGitDir(cmd, texts, ctx)
  if (target) out.push(ask('paths.git_control', { path: target }))
  const over = overOwnerDir(cmd, texts, ctx)
  if (over) out.push(deny('paths.reach', { path: over }))
  if (gitMakesTreeHere(cmd, texts, ctx)) out.push(deny('paths.state', { path: cmd.cwd }))
  if (cmd.name && !readsNamedFiles(cmd, texts)) {
    // from inside the home of the grants, a file can be written without its name saying so
    if (insideHome(cmd.cwd, ctx)) out.push(deny('paths.state', { path: cmd.cwd }))
    const word = texts.slice(1).find((t) => mayNameOwnerDir(t, cmd, ctx))
    if (word) out.push(deny('paths.reach', { path: word }))
    if (namesHomeInVariable(cmd, ctx)) out.push(deny('paths.state', { path: ctx.lanekeeperHome }))
  }
  if (cmd.name === 'export' || (['declare', 'typeset'].includes(cmd.name) && texts.some((t) => /^-[A-Za-z]*x/.test(t)))) {
    const name = texts.slice(1).map((t) => t.split('=')[0]).find((n) => GIT_ENV.test(n))
    if (name) out.push(ask('paths.git_env', { name }))
  }
  // git counts as reading, but these make a tree where they are told to.
  const gitMakesTree = cmd.name === 'git' && texts.some((t) => ['clone', 'init', 'worktree'].includes(t))
  if (texts.some(mentions) && (!READ_ONLY.has(cmd.name) || gitMakesTree)) out.push(deny('paths.state', { path: texts.find(mentions) }))
  if (!READ_ONLY.has(cmd.name)) for (const t of texts.slice(1)) if (ownerCode(t)) out.push(deny(ownerCode(t), { path: t }))
  if (WRITERS.has(cmd.name) && (cmd.name !== 'sed' || texts.some((t) => /^-[a-zA-Z]*i/.test(t)))) {
    for (const t of texts.slice(1)) {
      if (t.startsWith('-')) continue
      const p = resolvePath(cmd.cwd, t, ctx.home)
      const hit = isProtectedPath(p, ctx.projectRoot, ctx.config.project?.protected_paths)
      if (hit) out.push(deny('paths.protected', { path: t, glob: hit }))
      // Moving or copying over the whole folder replaces the grant without naming it.
      if (ctx.lanekeeperHome && path.resolve(p) === path.resolve(ctx.lanekeeperHome)) out.push(deny('paths.state', { path: t }))
    }
  }
  return out
}
