// Shared start-up of the ledger tools (wb-waves, wb-number, wb-cases, wb-defects):
// configuration, language, state folder, error printing.
import path from 'node:path'
import { load, parseOptions } from './cli.mjs'
import { stateDir, getPath } from './config.mjs'
import { translator } from './i18n.mjs'
import { LedgerError } from './waves.mjs'

export function context(argv, booleans = []) {
  const args = parseOptions(argv, ['json', ...booleans])
  const { root, resolved } = load(args)
  const t = translator(resolved.effective.language)
  const print = (s = '') => process.stdout.write(`${s}\n`)
  const fail = (code, vars = {}, exit = 1) => {
    process.stderr.write(`[wb] ${t(`ledger.err.${code}`, vars)}\n`)
    process.exit(exit)
  }
  return {
    args,
    root,
    resolved,
    t,
    print,
    fail,
    state: () => stateDir(root),
    needState() {
      const sd = stateDir(root)
      if (!sd) fail('no_state')
      return sd
    },
    path: (key, fallback) => path.resolve(root, String(getPath(resolved.config, `project.paths.${key}`) || fallback)),
    json: (v) => print(JSON.stringify(v, null, 2)),
  }
}

// Run fn; a LedgerError becomes a translated message and exit 1.
export async function guarded(ctx, fn) {
  try {
    await fn()
  } catch (e) {
    if (e instanceof LedgerError) ctx.fail(e.code, e.vars)
    throw e
  }
}
