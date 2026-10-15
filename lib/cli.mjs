// Small helpers for the bin tools: argument parsing, setting lookup and stdin.
import { resolveConfig, projectRoot } from './config.mjs'

// --key=value and bare --flag only.
export function parseArgs(argv) {
  const out = { _: [] }
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      out[k] = v === undefined ? true : v
    } else out._.push(a)
  }
  return out
}

export function load(args, env = process.env) {
  const root = projectRoot(args.project ? String(args.project) : process.cwd(), env)
  return { root, resolved: resolveConfig({ projectDir: root, env }) }
}

// Also accepts "--key value"; names in `booleans` never take a value. Words
// after a bare "--" are kept in out['--'].
export function parseOptions(argv, booleans = []) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      out['--'] = argv.slice(i + 1)
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq)
      if (eq !== -1) out[name] = a.slice(eq + 1)
      else if (!booleans.includes(name) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[name] = argv[++i]
      else out[name] = true
    } else out._.push(a)
  }
  return out
}

export function readStdin() {
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (raw += c))
    process.stdin.on('end', () => resolve(raw))
  })
}
