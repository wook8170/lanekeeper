// data-guard: keep test runs off the owner's data (project.protected_data).
//
//   paths       database files or folders (globs, relative to the project or absolute, ~ allowed)
//   ports       ports of protected database servers
//   containers  names of protected containers
//
// A write to one of them is denied for a lane (a subagent) and needs the
// owner's confirmation in the main session. What counts as a write:
//   - Write / Edit / NotebookEdit on a protected path; a shell redirect or a
//     file-writing command (cp, mv, rm, tee, sed -i …) that names one
//   - a database client (psql, mysql, sqlite3, duckdb …) on a protected port or
//     file whose SQL writes (INSERT, UPDATE, DELETE, DROP, CREATE, ALTER …);
//     pg_restore, mysqlimport, createdb and dropdb always write
//   - docker exec into a protected container running a writing command, and
//     docker cp into one
// When the SQL or the inner command cannot be read (interactive client, -f
// file, input from a file, a shell script) the call asks for confirmation.
// Read-only queries (SELECT, SHOW, EXPLAIN, \d …) pass.
import path from 'node:path'
import { ask, deny } from './common.mjs'
import { resolvePath } from './shell.mjs'
import { isProtectedPath } from './paths.mjs'

const PG = new Set(['psql', 'pg_restore', 'createdb', 'dropdb'])
const MY = new Set(['mysql', 'mariadb', 'mysqlimport'])
const FILE_DB = new Set(['sqlite3', 'duckdb'])
const ALWAYS_WRITE = new Set(['pg_restore', 'mysqlimport', 'createdb', 'dropdb'])
const DEFAULT_PORT = { pg: 5432, my: 3306 }
const WRITERS = new Set(['cp', 'mv', 'tee', 'touch', 'ln', 'install', 'rsync', 'truncate', 'dd', 'rm', 'unlink', 'sed', 'perl'])
const INNER_READ = new Set(['cat', 'ls', 'head', 'tail', 'env', 'ps', 'pg_isready', 'echo', 'df', 'du', 'stat', 'wc', 'pg_dump', 'mysqldump', 'whoami', 'date', 'uptime', 'id', 'hostname'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ash', 'ksh'])

const WRITE_SQL = /\b(insert|update|delete|drop|create|alter|truncate|grant|revoke|merge|replace|upsert|copy\s+\S+\s+from|vacuum|reindex|cluster|attach|import|load\s+data)\b|\\(copy|i|ir)\b|^\s*\.(import|restore|read)\b/im
const READ_SQL = /^\s*(?:(?:select|show|explain|describe|desc|with|values|table)\b|\\(?:d\S*|l\+?|x|conninfo)(?:\s|$)|\.(?:tables|schema|indexes|mode|headers)\b)/i

export function dataSettings(config, home) {
  const d = config.project?.protected_data || {}
  const exp = (p) => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? path.join(home || '', p.slice(1)) : p)
  return {
    paths: (d.paths || []).map(exp),
    ports: new Set((d.ports || []).filter(Number.isInteger)),
    containers: new Set(d.containers || []),
  }
}

const active = (s) => s.paths.length || s.ports.size || s.containers.size

// 'write' | 'read' | 'unknown' for a list of SQL texts.
export function sqlKind(texts) {
  const list = texts.filter((t) => typeof t === 'string' && t.trim())
  if (!list.length) return 'unknown'
  if (list.some((t) => WRITE_SQL.test(t))) return 'write'
  return list.every((t) => t.split(';').filter((x) => x.trim()).every((x) => READ_SQL.test(x))) ? 'read' : 'unknown'
}

// Values of a flag: "-c X", "--command=X", and with attached "-cX".
function flagValue(texts, names, { attached = true } = {}) {
  const out = []
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]
    for (const n of names) {
      if (t === n && texts[i + 1] !== undefined) out.push(texts[i + 1])
      else if (n.startsWith('--') && t.startsWith(`${n}=`)) out.push(t.slice(n.length + 1))
      else if (attached && n.length === 2 && t.startsWith(n) && t.length > 2 && !t.startsWith('--')) out.push(t.slice(2))
    }
  }
  return out
}

// SQL a client receives: -c / -e values, the second positional of sqlite3,
// a here-string or heredoc body, or the words of an echo/printf piped in.
function sqlSources(cmd, family, texts) {
  const out = []
  if (family === 'pg') out.push(...flagValue(texts, ['-c', '--command']))
  if (family === 'my') out.push(...flagValue(texts, ['-e', '--execute']))
  if (family === 'file') {
    out.push(...flagValue(texts, ['-c', '-cmd'], { attached: false }))
    const pos = texts.filter((t) => !t.startsWith('-'))
    if (pos.length > 1) out.push(...pos.slice(1))
  }
  for (const r of cmd.redirs || []) {
    if (r.op === '<<<') out.push(r.target)
    else if (r.body !== undefined) out.push(r.body)
  }
  const p = cmd.pipedFrom
  if (p && (p.name === 'echo' || p.name === 'printf')) out.push(p.args.map((a) => a.text).join(' '))
  return out
}

// Input the client reads that cannot be seen: -f file, < file, a pipe from
// anything but echo/printf.
function hiddenInput(cmd, family, texts) {
  if (family === 'pg' && flagValue(texts, ['-f', '--file']).length) return true
  if ((cmd.redirs || []).some((r) => r.op === '<')) return true
  if (cmd.pipedFrom && !(cmd.pipedFrom.name === 'echo' || cmd.pipedFrom.name === 'printf')) return true
  return false
}

function portsOf(cmd, family, texts) {
  const out = []
  const names = family === 'pg' ? ['-p', '--port'] : ['-P', '--port']
  for (const v of flagValue(texts, names)) if (/^\d+$/.test(v)) out.push(Number(v))
  for (const t of texts) {
    for (const m of t.matchAll(/:\/\/[^/\s]*?:(\d+)/g)) out.push(Number(m[1]))
    for (const m of t.matchAll(/\bport=(\d+)/g)) out.push(Number(m[1]))
  }
  const envPort = family === 'pg' ? cmd.env?.PGPORT : cmd.env?.MYSQL_TCP_PORT
  if (envPort && /^\d+$/.test(envPort)) out.push(Number(envPort))
  return out
}

// Judge one database client. Returns { kind, target } or null when it does not
// touch protected data.
function judgeClient(cmd, s, ctx) {
  const name = cmd.name
  const family = PG.has(name) ? 'pg' : MY.has(name) ? 'my' : FILE_DB.has(name) ? 'file' : null
  if (!family) return null
  const texts = cmd.args.map((a) => a.text)
  let target = null
  let sure = true
  if (family === 'file') {
    const file = texts.find((t) => !t.startsWith('-'))
    if (!file) return null
    const p = resolvePath(cmd.cwd || ctx.cwd, file, ctx.home)
    if (!isProtectedPath(p, ctx.projectRoot, s.paths)) return null
    target = file
  } else {
    if (!s.ports.size) return null
    const ports = portsOf(cmd, family, texts)
    const hit = ports.find((p) => s.ports.has(p))
    if (hit !== undefined) target = `port ${hit}`
    else if (!ports.length && s.ports.has(DEFAULT_PORT[family])) {
      target = `port ${DEFAULT_PORT[family]}`
      sure = false
    } else return null
  }
  if (ALWAYS_WRITE.has(name)) return { kind: sure ? 'write' : 'unknown', target }
  let kind = sqlKind(sqlSources(cmd, family, texts))
  if (kind !== 'write' && hiddenInput(cmd, family, texts)) kind = 'unknown'
  if (kind === 'write' && !sure) kind = 'unknown'
  return { kind, target }
}

const DOCKER_EXEC_VALUE = new Set(['-u', '--user', '-e', '--env', '-w', '--workdir', '--env-file', '--detach-keys', '--index'])

// docker exec / docker container exec / docker compose exec: { container, inner: [texts] }
function dockerExec(texts) {
  let i = 0
  if (texts[i] === 'container') i++
  else if (texts[i] === 'compose') {
    i++
    while (texts[i] && texts[i].startsWith('-')) i += ['-f', '--file', '-p', '--project-name'].includes(texts[i]) ? 2 : 1
  }
  if (texts[i] !== 'exec') return null
  i++
  while (i < texts.length && texts[i].startsWith('-')) i += DOCKER_EXEC_VALUE.has(texts[i]) ? 2 : 1
  if (i >= texts.length) return null
  return { container: texts[i], inner: texts.slice(i + 1) }
}

function judgeInner(inner, s, ctx) {
  const name = path.basename(inner[0] || '')
  if (!name) return 'unknown'
  if (SHELLS.has(name)) {
    const ci = inner.findIndex((t) => /^-[a-z]*c[a-z]*$/.test(t))
    const body = ci !== -1 ? inner[ci + 1] : null
    if (!body) return 'unknown'
    if (WRITE_SQL.test(body) || />|\b(rm|mv|cp|tee|dd|truncate)\b/.test(body)) return 'write'
    return 'unknown'
  }
  const fake = { name, args: inner.slice(1).map((text) => ({ text })), env: {}, redirs: [], cwd: '/' }
  const family = PG.has(name) ? 'pg' : MY.has(name) ? 'my' : FILE_DB.has(name) ? 'file' : null
  if (family) {
    if (ALWAYS_WRITE.has(name)) return 'write'
    return sqlKind(sqlSources(fake, family, inner.slice(1)))
  }
  if (INNER_READ.has(name)) return 'read'
  if (WRITERS.has(name) || name === 'mongosh' || name === 'redis-cli') return name === 'sed' && !inner.some((t) => /^-[a-zA-Z]*i/.test(t)) ? 'read' : 'write'
  return 'unknown'
}

// Verdict for a lane (deny) or the main session (ask) on a write; ask when unclear.
function verdict(kind, target, cmdText, ctx) {
  if (kind === 'read') return null
  const vars = { target, cmd: cmdText.slice(0, 120) }
  if (kind === 'write') return ctx.agentId ? deny('data.write', vars) : ask('data.write', vars)
  return ask('data.unclear', vars)
}

export function judgeData(cmd, ctx) {
  const s = dataSettings(ctx.config || {}, ctx.home)
  if (!active(s)) return []
  const out = []
  const text = cmd.words.map((w) => w.text).join(' ')
  // redirects into a protected path
  for (const r of cmd.redirs || []) {
    if (!/>/.test(r.op) || !r.target || /^&?\d$/.test(r.target)) continue
    const p = resolvePath(cmd.cwd || ctx.cwd, r.target, ctx.home)
    if (isProtectedPath(p, ctx.projectRoot, s.paths)) out.push(verdict('write', r.target, text || r.target, ctx))
  }
  // file-writing commands that name a protected path
  if (WRITERS.has(cmd.name) && (cmd.name !== 'sed' || cmd.args.some((a) => /^-[a-zA-Z]*i/.test(a.text)))) {
    for (const a of cmd.args) {
      if (a.text.startsWith('-')) continue
      const p = resolvePath(cmd.cwd || ctx.cwd, a.text, ctx.home)
      if (isProtectedPath(p, ctx.projectRoot, s.paths)) {
        out.push(verdict('write', a.text, text, ctx))
        break
      }
    }
  }
  const c = judgeClient(cmd, s, ctx)
  if (c) out.push(verdict(c.kind, c.target, text, ctx))
  if (cmd.name === 'docker' && s.containers.size) {
    const texts = cmd.args.map((a) => a.text)
    const ex = dockerExec(texts)
    if (ex && s.containers.has(ex.container)) out.push(verdict(judgeInner(ex.inner, s, ctx), `container ${ex.container}`, text, ctx))
    if (texts[0] === 'cp' || (texts[0] === 'container' && texts[1] === 'cp')) {
      const dest = texts.filter((t) => !t.startsWith('-')).at(-1) || ''
      const name = dest.includes(':') ? dest.slice(0, dest.indexOf(':')) : null
      if (name && s.containers.has(name)) out.push(verdict('write', `container ${name}`, text, ctx))
    }
  }
  return out.filter(Boolean)
}

// Write / Edit / NotebookEdit on a protected data path.
export function judgeDataFile(file, ctx) {
  const s = dataSettings(ctx.config || {}, ctx.home)
  if (!file || !s.paths.length) return null
  const p = path.isAbsolute(file) ? path.normalize(file) : path.resolve(ctx.cwd, file)
  return isProtectedPath(p, ctx.projectRoot, s.paths) ? verdict('write', file, file, ctx) : null
}
