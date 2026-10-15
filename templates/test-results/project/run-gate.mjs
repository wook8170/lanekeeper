#!/usr/bin/env node
// Runs the project's gate step by step and records result, exit code and duration of every step in gate.json.
// The steps come from the verify config (`gate.steps`, or `gate.script` = a package.json script that chains
// commands with `&&`), so changing the gate changes the record.
//
//   node run-gate.mjs [--root <dir>] [--config <file>] [--results-dir <dir>] [--no-bail] [--skip=a,b]
//     --no-bail  keep going after a failure (default: stop at the first failure, the rest are "notRun")
//     --skip     step names that another stage runs later
// Exit code: exit code of the first failed step (0 = all passed).
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function parseArgs(argv) {
  const o = { root: process.cwd(), config: '', resultsDir: '', bail: true, skip: [] }
  for (const a of argv) {
    if (a === '--no-bail') o.bail = false
    else if (a.startsWith('--root=')) o.root = a.slice(7)
    else if (a.startsWith('--config=')) o.config = a.slice(9)
    else if (a.startsWith('--results-dir=')) o.resultsDir = a.slice(14)
    else if (a.startsWith('--skip=')) o.skip = a.slice(7).split(',').filter(Boolean)
  }
  return o
}

export const loadConfig = (root, file) => JSON.parse(fs.readFileSync(path.resolve(root, file || path.join('.wb', 'verify.config.json')), 'utf8'))

/** "npm run a && npm run b" -> [{name, cmd}] */
export function splitChain(script) {
  return script.split('&&').map((s) => s.trim()).filter(Boolean).map((cmd) => {
    const words = cmd.split(/\s+/)
    const i = words.findIndex((w) => w === 'run' || w === 'run-script')
    const name = i >= 0 && words[i + 1] ? words[i + 1] : words.slice(0, 2).join(' ')
    return { name, cmd }
  })
}

/** gate section of the config -> [{name, cmd}] */
export function gateSteps(config, root) {
  const g = config.gate || {}
  if (Array.isArray(g.steps) && g.steps.length) return g.steps.map((s) => ({ name: s.name, cmd: s.cmd }))
  if (g.script) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const s = pkg.scripts?.[g.script]
    if (!s) throw new Error(`package.json has no script "${g.script}"`)
    return splitChain(s)
  }
  return []
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** Run one shell command; output goes to the screen (unless echo is false) and the log file. */
export function runLogged(cmd, logFile, { cwd = process.cwd(), env = process.env, echo = true, argv = null } = {}) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const out = fs.createWriteStream(logFile)
  const t0 = Date.now()
  return new Promise((resolve) => {
    const child = argv
      ? spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(cmd, { cwd, shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.on('error', (e) => { out.write(`${e.message}\n`) })
    child.stdout.on('data', (b) => { if (echo) process.stdout.write(b); out.write(b) })
    child.stderr.on('data', (b) => { if (echo) process.stderr.write(b); out.write(b) })
    child.on('close', (code) => out.end(() => resolve({ exit: code ?? 1, durationMs: Date.now() - t0 })))
  })
}

function failDetail(logFile) {
  const lines = fs.readFileSync(logFile, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n')
  const marks = lines.filter((l) => /^\s*[✗×]/.test(l) || /^\s+(Tests|Test Files)\s+\d+ failed/.test(l)).map((l) => l.trim())
  return (marks.length ? marks : lines.filter((l) => /ERR|Error|error/.test(l)).map((l) => l.trim())).slice(0, 3).join(' / ').slice(0, 500)
}

/** opts: { root, config (object), resultsDir, bail, skip, wrap(cmd) -> {cmd?, argv?}, echo } */
export async function runGate(opts) {
  const root = opts.root
  const steps = gateSteps(opts.config, root)
  const dir = path.resolve(root, opts.resultsDir || path.join('test-results', 'runs', `gate-${stamp()}`))
  const rows = []
  let firstFail = 0
  for (const [i, s] of steps.entries()) {
    const log = path.join(dir, 'logs', `gate-${String(i + 1).padStart(2, '0')}-${s.name.replace(/[^\w.-]+/g, '_')}.log`)
    if ((opts.skip || []).includes(s.name)) {
      rows.push({ name: s.name, cmd: s.cmd, status: 'skipped', exit: null, durationMs: null, detail: 'skipped here (another stage runs it)', log: '' })
      continue
    }
    if (firstFail && opts.bail !== false) {
      rows.push({ name: s.name, cmd: s.cmd, status: 'notRun', exit: null, durationMs: null, detail: 'not run: an earlier step failed', log: '' })
      continue
    }
    if (opts.echo !== false) console.log(`\n[gate ${i + 1}/${steps.length}] ${s.cmd}`)
    const w = opts.wrap ? opts.wrap(s.cmd) : { cmd: s.cmd }
    const r = await runLogged(w.cmd, log, { cwd: root, echo: opts.echo !== false, argv: w.argv })
    const ok = r.exit === 0
    if (!ok && !firstFail) firstFail = r.exit || 1
    rows.push({ name: s.name, cmd: s.cmd, status: ok ? 'passed' : 'failed', exit: r.exit, durationMs: r.durationMs, detail: ok ? '' : failDetail(log), log })
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ steps: rows }, null, 1))
  if (opts.echo !== false) {
    console.log(`\n[gate] ${rows.length} steps · passed ${rows.filter((r) => r.status === 'passed').length} · failed ${rows.filter((r) => r.status === 'failed').length} · ${path.join(dir, 'gate.json')}`)
  }
  return { dir, rows, exit: firstFail }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2))
  const r = await runGate({ ...o, config: loadConfig(o.root, o.config) })
  process.exit(r.exit)
}
