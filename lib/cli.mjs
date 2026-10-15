// Small helpers for the bin tools: argument parsing and setting lookup.
import { resolveConfig, projectRoot } from './config.mjs'

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
