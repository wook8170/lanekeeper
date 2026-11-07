// Small POSIX-ish shell reader for the safety hooks.
//
// It does not run anything. It turns a Bash tool command into a flat list of
// simple commands so each guard can judge them one by one:
//   - splits on ; && || | |& & newlines, ( ) { }
//   - removes quotes and joins adjacent parts ("g""it" -> git)
//   - pulls $( ... ) and backtick bodies out as commands of their own and marks
//     the word that held them as dynamic
//   - unwraps env/sudo/command/exec/nohup/time/nice/timeout/xargs/stdbuf,
//     flock/setsid/ssh-agent/ionice/gtimeout/arch/script, coproc, find -exec and watch,
//     sh|bash|zsh -c '...', eval '...', and scripts fed to a shell on its input
//   - marks a command it cannot look inside as opaque (`cat a | sh`, parallel)
//   - expands aliases defined earlier in the same command line
//   - follows cd / pushd so later commands know their working directory
//
// A word is { text, dynamic } where dynamic means the real value is only known
// at run time ($VAR, $(...), globs are left as text).

const OPS = ['&&', '||', '|&', ';;', ';', '|', '&', '\n', '(', ')']
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'ash', 'csh', 'tcsh'])
// The command after these words runs as usual: `then git push` is `git push`.
const LEADING_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', 'coproc'])

export function tokenize(src) {
  const tokens = []
  const heredocs = []
  let i = 0
  let word = null // { text, dynamic, quoted }
  const subs = []
  const pushWord = () => {
    if (word) tokens.push({ type: 'word', ...word })
    word = null
  }
  const ensure = () => {
    if (!word) word = { text: '', dynamic: false, quoted: false }
    return word
  }
  const pendingHeredocs = []

  while (i < src.length) {
    const c = src[i]
    if (c === '\\' && i + 1 < src.length) {
      if (src[i + 1] === '\n') {
        i += 2
        continue
      }
      ensure().text += src[i + 1]
      word.quoted = true
      i += 2
      continue
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      const stop = end === -1 ? src.length : end
      ensure().text += src.slice(i + 1, stop)
      word.quoted = true
      i = stop + 1
      continue
    }
    if (c === '$' && src[i + 1] === "'") {
      let j = i + 2
      let out = ''
      while (j < src.length && src[j] !== "'") {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1]
          out += n === 'n' ? '\n' : n === 't' ? '\t' : n
          j += 2
        } else out += src[j++]
      }
      ensure().text += out
      word.quoted = true
      i = j + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      ensure().quoted = true
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length && '"\\$`\n'.includes(src[j + 1])) {
          if (src[j + 1] !== '\n') word.text += src[j + 1]
          j += 2
        } else if (src[j] === '$' && src[j + 1] === '(') {
          const { body, end } = readParen(src, j + 1)
          subs.push(body)
          word.text += `$(${body})`
          word.dynamic = true
          j = end
        } else if (src[j] === '`') {
          const end = src.indexOf('`', j + 1)
          const stop = end === -1 ? src.length : end
          subs.push(src.slice(j + 1, stop))
          word.text += src.slice(j, stop + 1)
          word.dynamic = true
          j = stop + 1
        } else {
          if (src[j] === '$' && /[A-Za-z_{0-9@*#?!-]/.test(src[j + 1] || '')) word.dynamic = true
          word.text += src[j++]
        }
      }
      i = j + 1
      continue
    }
    if (c === '$' && src[i + 1] === '(') {
      if (src[i + 2] === '(') {
        // arithmetic $(( ... ))
        const { end } = readParen(src, i + 1)
        ensure().text += src.slice(i, end)
        word.dynamic = true
        i = end
        continue
      }
      const { body, end } = readParen(src, i + 1)
      subs.push(body)
      ensure().text += `$(${body})`
      word.dynamic = true
      i = end
      continue
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1)
      const stop = end === -1 ? src.length : end
      subs.push(src.slice(i + 1, stop))
      ensure().text += src.slice(i, stop + 1)
      word.dynamic = true
      i = stop + 1
      continue
    }
    if (c === '$' && /[A-Za-z_{0-9@*#?!-]/.test(src[i + 1] || '')) {
      ensure().dynamic = true
      word.text += c
      i++
      continue
    }
    if ((c === '<' || c === '>') && (src[i + 1] === '(')) {
      // process substitution <( ... ) / >( ... )
      pushWord()
      const { body, end } = readParen(src, i + 1)
      subs.push(body)
      tokens.push({ type: 'word', text: `${c}(${body})`, dynamic: true, quoted: false })
      i = end
      continue
    }
    if (c === '#' && !word && (i === 0 || /\s|[;&|()]/.test(src[i - 1]))) {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      pushWord()
      i++
      continue
    }
    // redirections
    const redir = /^(\d*)(&>>|&>|>>|>\||>&|<<<|<<-|<<|<>|<&|>|<)/.exec(src.slice(i))
    if (redir && (redir[1] === '' || !word)) {
      pushWord()
      const op = redir[2]
      i += redir[0].length
      tokens.push({ type: 'redir', op, fd: redir[1] })
      if (op === '<<' || op === '<<-') pendingHeredocs.push({ index: tokens.length - 1, strip: op === '<<-' })
      continue
    }
    if (c === '\n' && pendingHeredocs.length) {
      pushWord()
      tokens.push({ type: 'op', op: '\n' })
      i++
      // read heredoc bodies in order
      for (const h of pendingHeredocs.splice(0)) {
        const delimTok = tokens[h.index + 1]
        const delim = delimTok && delimTok.type === 'word' ? delimTok.text : ''
        const lines = []
        while (i < src.length) {
          const nl = src.indexOf('\n', i)
          const line = src.slice(i, nl === -1 ? src.length : nl)
          i = nl === -1 ? src.length : nl + 1
          const cmp = h.strip ? line.replace(/^\t+/, '') : line
          if (cmp === delim) break
          lines.push(line)
        }
        heredocs.push({ index: h.index, body: lines.join('\n') })
        tokens[h.index].body = lines.join('\n')
      }
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      pushWord()
      tokens.push({ type: 'op', op })
      i += op.length
      continue
    }
    if ((c === '{' || c === '}') && !word) {
      const next = src[i + 1]
      if (c === '}' || next === undefined || /\s/.test(next)) {
        tokens.push({ type: 'op', op: c })
        i++
        continue
      }
    }
    ensure().text += c
    i++
  }
  pushWord()
  // heredoc without trailing newline: nothing to read
  return { tokens, subs }
}

function readParen(src, open) {
  // src[open] === '('; returns body and index after the matching ')'
  let depth = 0
  let i = open
  let quote = null
  for (; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === '\\') i++
    else if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return { body: src.slice(open + 1, i), end: i + 1 }
    }
  }
  return { body: src.slice(open + 1), end: src.length }
}

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

// Wrapper commands whose real command follows. Returns the index of the real
// command word, or -1 when the wrapper runs nothing (e.g. `env` alone).
function unwrapIndex(words, i) {
  const w = base(words[i].text)
  const optArgs = {
    sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T']),
    doas: new Set(['-u', '-C']),
    nice: new Set(['-n']),
    stdbuf: new Set(['-i', '-o', '-e']),
    env: new Set(['-u', '-C', '-S', '--unset', '--chdir']),
    timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
    xargs: new Set(['-I', '-i', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '--max-args', '--max-procs', '--delimiter', '--arg-file', '--replace']),
    time: new Set(['-f', '-o']),
    caffeinate: new Set(['-t', '-w']),
    nohup: new Set(),
    command: new Set(),
    builtin: new Set(),
    exec: new Set(['-a']),
    flock: new Set(['-w', '--wait', '--timeout', '-E', '--conflict-exit-code']),
    setsid: new Set(),
    'ssh-agent': new Set(['-a', '-E', '-O', '-P', '-t']),
    ionice: new Set(['-c', '--class', '-n', '--classdata', '-p', '--pid', '-P', '--pgid', '-u', '--uid']),
    arch: new Set(['-d', '-e', '-arch']),
    script: new Set(['-t', '-T', '-E', '-I', '-O', '-B', '-m', '-o']),
    watch: new Set(['-n', '--interval', '-q', '--equexit']),
  }
  optArgs.gtimeout = optArgs.timeout
  if (!(w in optArgs)) return null
  let j = i + 1
  while (j < words.length) {
    const t = words[j].text
    if (w === 'env' && ASSIGN.test(t)) {
      j++
      continue
    }
    if (t === '--') {
      j++
      break
    }
    if (t.startsWith('-') && t.length > 1) {
      const name = t.includes('=') ? t.slice(0, t.indexOf('=')) : t
      j += optArgs[w].has(name) && !t.includes('=') ? 2 : 1
      if (w === 'command' && (t === '-v' || t === '-V')) return -1
      continue
    }
    break
  }
  if ((w === 'timeout' || w === 'gtimeout') && j < words.length && /^[0-9.]+[smhd]?$/.test(words[j].text)) j++
  // the lock file and the typescript file come before the command
  if (w === 'flock' || w === 'script') {
    j++
    if (words[j]?.text === '--') j++
  }
  return j < words.length ? j : -1
}

// flock and script also take the command as one string.
function commandString(words, i) {
  if (!['flock', 'script'].includes(base(words[i].text))) return null
  for (let j = i + 1; j < words.length; j++) {
    const t = words[j].text
    if (t === '-c' || t === '--command') return words[j + 1]?.text ?? ''
    if (t.startsWith('--command=')) return t.slice(10)
  }
  return null
}

// What a shell reading its input would run -> { text } | { opaque: true } | null when it does not read it.
function shellInput(cmd, rds, pipedFrom) {
  const hasC = cmd.args.some((a) => /^-[a-z]*c[a-z]*$/.test(a.text))
  const hasScript = cmd.args.some((a) => !a.text.startsWith('-'))
  if (hasC || (hasScript && !cmd.args.some((a) => a.text === '-s'))) return null
  const given = rds.find((r) => r.op === '<<<')
  if (given) return given.dynamic ? { opaque: true } : { text: given.target }
  if (rds.some((r) => r.op === '<' && r.target !== '/dev/null')) return { opaque: true }
  if (!pipedFrom) return null
  // echo and printf with literal words show what they print; anything else cannot be read
  const words = pipedFrom.args.filter((a) => !/^-[a-zA-Z]+$/.test(a.text))
  if (!['echo', 'printf'].includes(pipedFrom.name) || words.some((a) => a.dynamic)) return { opaque: true }
  return { text: words.map((a) => a.text).join(' ').replace(/\\n/g, '\n') }
}

export const base = (t) => {
  const s = t.replace(/^\\/, '')
  const k = s.lastIndexOf('/')
  return k === -1 ? s : s.slice(k + 1)
}

// Parse a command line into simple commands.
// opts: { cwd, home, env } -> each command: { name, args:[word], words:[word],
//   env:{K:V}, cwd, cwdKnown, redirs:[{op, target}], via:[wrappers], dynamicName }
export function parse(src, opts = {}, depth = 0, state = null) {
  const st = state || {
    cwd: opts.cwd || process.cwd(),
    cwdKnown: true,
    aliases: new Map(),
    home: opts.home || process.env.HOME || '',
    functions: new Set(),
    env: {},
  }
  const out = []
  if (depth > 6 || typeof src !== 'string') return out
  const { tokens, subs } = tokenize(src)
  for (const s of subs) out.push(...parse(s, opts, depth + 1, { ...st, aliases: new Map(st.aliases) }))

  let cur = []
  let redirs = []
  const flush = (pipedFrom) => {
    if (cur.length || redirs.length) emit(cur, redirs, pipedFrom)
    cur = []
    redirs = []
  }
  // Commands run from inside another one, possibly many times.
  const nested = (text, repeats, env) => {
    const inner = parse(text, opts, depth + 1, { ...childState(st), env: { ...st.env, ...env } })
    if (repeats) for (const c of inner) c.repeats = true
    out.push(...inner)
  }
  const emit = (words, rds, pipedFrom) => {
    let ws = words
    // alias expansion (first word only)
    let guard = 0
    while (ws.length && st.aliases.has(ws[0].text) && !ws[0].quoted && guard++ < 5) {
      const exp = tokenize(st.aliases.get(ws[0].text)).tokens.filter((t) => t.type === 'word')
      ws = [...exp, ...ws.slice(1)]
    }
    while (ws.length && LEADING_KEYWORDS.has(ws[0].text) && !ws[0].quoted) ws = ws.slice(1)
    const env = { ...st.env }
    let i = 0
    while (i < ws.length && ASSIGN.test(ws[i].text) && !ws[i].quotedName) {
      const t = ws[i].text
      env[t.slice(0, t.indexOf('='))] = t.slice(t.indexOf('=') + 1)
      i++
    }
    const via = []
    while (i < ws.length && base(ws[i].text) !== 'watch') {
      const str = commandString(ws, i)
      if (str !== null) {
        via.push(base(ws[i].text))
        nested(str, false, env)
        i = ws.length
        break
      }
      const k = unwrapIndex(ws, i)
      if (k === null) break
      via.push(base(ws[i].text))
      if (via.at(-1) === 'env') {
        for (let m = i + 1; m < (k === -1 ? ws.length : k); m++) {
          const t = ws[m].text
          if (ASSIGN.test(t)) env[t.slice(0, t.indexOf('='))] = t.slice(t.indexOf('=') + 1)
        }
      }
      if (k === -1) {
        i = ws.length
        break
      }
      i = k
    }
    const rest = ws.slice(i)
    const cmd = {
      name: rest.length ? base(rest[0].text) : '',
      rawName: rest.length ? rest[0].text : '',
      dynamicName: rest.length ? rest[0].dynamic : false,
      args: rest.slice(1),
      words: rest,
      env,
      cwd: st.cwd,
      cwdKnown: st.cwdKnown,
      redirs: rds,
      via,
      pipedFrom: pipedFrom || null,
      xargs: via.includes('xargs'),
    }
    if (rest.length || rds.length) out.push(cmd)
    if (st.functions.has(cmd.name)) cmd.functionCall = true
    if (cmd.name === 'function' && cmd.args[0]) st.functions.add(cmd.args[0].text.replace(/\(\)$/, ''))
    if (cmd.name === 'watch') {
      const k = unwrapIndex(rest, 0)
      if (k > 0) nested(rest.slice(k).map((w) => w.text).join(' '), true, env)
    }
    if (cmd.name === 'find') {
      for (let a = 0; a < cmd.args.length; a++) {
        if (!/^-(exec|execdir|ok|okdir)$/.test(cmd.args[a].text)) continue
        let e = a + 1
        while (e < cmd.args.length && ![';', '+'].includes(cmd.args[e].text)) e++
        const from = out.length
        emit(cmd.args.slice(a + 1, e), [], null)
        for (const c of out.slice(from)) c.repeats = true
        a = e
      }
    }
    if (cmd.name === 'parallel') {
      const first = cmd.args.findIndex((a) => !a.text.startsWith('-'))
      const fromInput = first === -1 || /^:::/.test(cmd.args[first].text) || cmd.args.some((a) => ['-a', '--arg-file', '--pipe'].includes(a.text))
      cmd.opaque = fromInput ? 'always' : 'guarded'
    }
    // follow-ups
    if (cmd.name === 'cd' || cmd.name === 'pushd') {
      const target = cmd.args.find((a) => !a.text.startsWith('-'))
      if (!target) {
        st.cwd = st.home
      } else if (target.dynamic && !/^\$HOME(\/|$)/.test(target.text)) {
        st.cwdKnown = false
      } else {
        st.cwd = resolvePath(st.cwd, target.text, st.home)
      }
    }
    if (cmd.name === 'alias') {
      for (const a of cmd.args) {
        const k = a.text.indexOf('=')
        if (k > 0) st.aliases.set(a.text.slice(0, k), a.text.slice(k + 1))
      }
    }
    // shell -c / eval / heredoc into a shell
    if (SHELLS.has(cmd.name)) {
      const ci = cmd.args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a.text))
      if (ci !== -1 && cmd.args[ci + 1]) nested(cmd.args[ci + 1].text, false, env)
      for (const r of rds) if (r.body !== undefined) nested(r.body, false, env)
      const input = rds.some((r) => r.body !== undefined) ? null : shellInput(cmd, rds, pipedFrom)
      if (input?.opaque) cmd.opaque = 'always'
      else if (input) nested(input.text, false, env)
    }
    if (cmd.name === 'eval' && cmd.args.length) {
      out.push(...parse(cmd.args.map((a) => a.text).join(' '), opts, depth + 1, st))
    }
    return cmd
  }

  let lastPiped = null
  const scopes = []
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.type === 'word') {
      cur.push(t)
      continue
    }
    if (t.type === 'redir') {
      const target = tokens[k + 1] && tokens[k + 1].type === 'word' ? tokens[k + 1] : null
      redirs.push({ op: t.op, fd: t.fd, target: target ? target.text : '', dynamic: target ? target.dynamic : false, body: t.body })
      if (target) k++
      continue
    }
    // operator
    if (t.op === '|' || t.op === '|&') {
      const prev = cur.length || redirs.length ? emitAndReturn() : null
      lastPiped = prev
      continue
    }
    // `name()` starts a function definition, so later uses of the name are calls
    const defined = t.op === '(' && tokens[k + 1]?.op === ')' && cur.length === 1 ? cur[0].text : null
    flush(lastPiped)
    lastPiped = null
    if (defined) st.functions.add(defined)
    // a subshell keeps its cd to itself
    if (t.op === '(') scopes.push({ cwd: st.cwd, cwdKnown: st.cwdKnown })
    if (t.op === ')' && scopes.length) Object.assign(st, scopes.pop())
  }
  flush(lastPiped)
  return out

  function emitAndReturn() {
    const c = emit(cur, redirs, lastPiped)
    cur = []
    redirs = []
    return c
  }
}

function childState(st) {
  return { ...st, aliases: new Map(st.aliases) }
}

export function resolvePath(cwd, p, home) {
  let s = p
  if (s === '~' || s.startsWith('~/')) s = home + s.slice(1)
  else if (/^\$HOME(\/|$)/.test(s)) s = home + s.slice(5)
  else if (/^\$\{HOME\}(\/|$)/.test(s)) s = home + s.slice(7)
  if (!s.startsWith('/')) s = `${cwd.replace(/\/$/, '')}/${s}`
  // normalize . and ..
  const parts = []
  for (const part of s.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}
