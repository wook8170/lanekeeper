#!/usr/bin/env node
// Integration / final verification in one go: gate -> every configured test stage -> workbook.
// A failing stage does not stop the run (no-bail). Raw results go to <runs-dir>/<name>-<stamp>/ (not committed);
// the workbook and the summary json go to the test-results folder (committed).
//
//   node verify-all.mjs [--root <dir>] [--config <file>] [--name <name>] [--skip=gate,<stage>,…]
//        [--only=<stage>,…] [--runs-dir <dir>] [--out <xlsx> | --out-template <tpl>] [--cases-dir <dir>] [--ledger-priority P0] [--no-slot]
//        [--lang=ko|en]   language of the [verify] lines and the workbook result line (default en)
//
// Heavy stages (every stage unless "slot": "none") run inside `wb-slot --kind <slot> --`, so only a few
// heavy commands run at a time on the machine. --no-slot runs them directly.
// Stage and gate shape: see verify.config.json next to this file.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gateSteps, loadConfig, runGate, runLogged, stamp } from './run-gate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export function parseArgs(argv) {
  const o = { root: process.cwd(), config: '', name: 'verify', skip: [], only: [], runsDir: '', out: '', outTemplate: '', casesDir: '', ledgerPriority: '', slot: true, core: '', lang: 'en' }
  for (const a of argv) {
    if (a === '--no-slot') { o.slot = false; continue }
    const m = /^--(root|config|name|skip|only|runs-dir|out-template|out|cases-dir|ledger-priority|core|lang)=(.*)$/.exec(a)
    if (!m) continue
    const k = m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase())
    o[k] = k === 'skip' || k === 'only' ? m[2].split(',').filter(Boolean) : m[2]
  }
  return o
}

const MSG = {
  en: {
    noPython: '[verify] workbook skipped: python3 was not found. Install Python 3.8+ (macOS: brew install python3; Debian/Ubuntu: sudo apt install python3 python3-openpyxl). Elsewhere: python3 -m pip install openpyxl',
    noOpenpyxl: '[verify] workbook skipped: the openpyxl module is missing. Install it with: sudo apt install python3-openpyxl (Debian/Ubuntu), or python3 -m pip install openpyxl. Where pip into the system Python is blocked (Homebrew, Debian 12+, Ubuntu 24.04): python3 -m venv ~/.wb/venv && ~/.wb/venv/bin/pip install openpyxl, then export WB_PYTHON=$HOME/.wb/venv/bin/python3',
    rawKept: (dir) => `[verify] raw results are kept in ${dir}; build the workbook later with: wb-test-report build --results-dir ${dir}. The workbook is optional for the gate: when every stage passes, the gate pass stamp is still written.`,
    noGateScript: (name) => `[verify] package.json has no script "${name}" (gate.script in .wb/verify.config.json). Add that script, point gate.script at an existing one, or list the commands in gate.steps ([{ "name": "test", "cmd": "npm test" }]).`,
    done: (dir, failed) => `[verify] results folder ${dir} · failed stages ${failed.length ? failed.join(', ') : 'none'}`,
  },
  ko: {
    noPython: '[verify] 엑셀 생성을 건너뜁니다: python3 가 없습니다. Python 3.8 이상을 설치하십시오(macOS: brew install python3, Debian·Ubuntu: sudo apt install python3 python3-openpyxl). 그 밖의 환경은 python3 -m pip install openpyxl 을 실행하십시오.',
    noOpenpyxl: '[verify] 엑셀 생성을 건너뜁니다: openpyxl 모듈이 없습니다. Debian·Ubuntu 는 sudo apt install python3-openpyxl, 그 밖은 python3 -m pip install openpyxl 로 설치하십시오. 시스템 Python 에 pip 설치가 막힌 환경(Homebrew·Debian 12 이상·Ubuntu 24.04)은 python3 -m venv ~/.wb/venv && ~/.wb/venv/bin/pip install openpyxl 을 실행하고 export WB_PYTHON=$HOME/.wb/venv/bin/python3 를 지정하십시오.',
    rawKept: (dir) => `[verify] 원본 결과는 ${dir} 에 남습니다. 나중에 wb-test-report build --results-dir ${dir} 로 엑셀을 만드십시오. 엑셀은 게이트 통과의 조건이 아닙니다. 모든 단계가 통과하면 게이트 통과 표식은 그대로 남깁니다.`,
    noGateScript: (name) => `[verify] package.json 에 "${name}" 스크립트가 없습니다(.wb/verify.config.json 의 gate.script). 그 스크립트를 추가하거나, gate.script 를 있는 스크립트로 바꾸거나, gate.steps 에 명령을 직접 적으십시오(예: [{ "name": "test", "cmd": "npm test" }]).`,
    done: (dir, failed) => `[verify] 결과 폴더 ${dir} · 실패 단계 ${failed.length ? failed.join(', ') : '없음'}`,
  },
}

export const safeName = (n) => n.replace(/[^\w.-]+/g, '__')
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`))
const sh = (c, cwd) => { try { return execSync(c, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' } }

export function pythonReady(py = process.env.WB_PYTHON || 'python3') {
  const r = spawnSync(py, ['-c', 'import sys, openpyxl; print(sys.version_info[0])'], { encoding: 'utf8' })
  return { ok: r.status === 0, python: r.error ? 'missing' : r.status === 0 ? 'ok' : 'noOpenpyxl' }
}

/** One slot wrapper for a command: {cmd} or {argv}. */
export function slotWrap(cmd, kind, { slotBin, enabled }) {
  if (!enabled || !kind || kind === 'none' || !slotBin) return { cmd }
  return { argv: [slotBin, '--kind', kind, '--', 'sh', '-c', cmd] }
}

export async function runVerify(o) {
  const root = path.resolve(o.root)
  const lang = o.lang === 'ko' ? 'ko' : 'en'
  const msg = MSG[lang]
  const config = o.configObject || loadConfig(root, o.config)
  let gateList
  try {
    gateList = gateSteps(config, root)
  } catch (e) {
    if (!/has no script/.test(e.message)) throw e
    console.error(msg.noGateScript(config.gate.script))
    return { dir: '', failed: ['gate'], manifest: null, report: { status: 0, skipped: true }, exit: 1 }
  }
  const started = new Date()
  const runsDir = path.resolve(root, o.runsDir || path.join('test-results', 'runs'))
  const dir = path.join(runsDir, `${o.name}-${stamp(started)}`)
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
  const slotBin = process.env.WB_SLOT_BIN || path.join(HERE, '..', '..', '..', 'bin', 'wb-slot')
  const slotOn = o.slot && fs.existsSync(slotBin)
  const wrapFor = (kind) => (cmd) => slotWrap(cmd, kind, { slotBin, enabled: slotOn })
  const manifest = {
    name: o.name, startedAt: started.toISOString(), commit: sh('git rev-parse --short HEAD', root), branch: sh('git rev-parse --abbrev-ref HEAD', root),
    host: os.hostname(), cpus: os.cpus().length, load: os.loadavg().map((x) => x.toFixed(1)).join(' · '),
    note: config.note || '', stages: [], results: [],
  }
  const save = () => fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1))
  const wanted = (name) => !o.skip.includes(name) && (!o.only.length || o.only.includes(name))
  const stage = async (name, fn) => {
    if (!wanted(name)) { manifest.stages.push({ name, status: 'skipped' }); return }
    const t0 = Date.now()
    const exit = await fn()
    manifest.stages.push({ name, exit, durationMs: Date.now() - t0, status: exit === 0 ? 'passed' : 'failed' })
    save()
  }
  save()

  if (gateList.length) {
    await stage('gate', async () => {
      const skip = (config.gate && config.gate.skip_in_verify) || []
      const r = await runGate({ root, config, resultsDir: dir, bail: false, skip, wrap: wrapFor((config.gate && config.gate.slot) || 'heavy'), echo: o.echo })
      return r.exit
    })
  }

  for (const st of config.stages || []) {
    await stage(st.name, async () => {
      const vars = { dir, name: st.name, file: path.join(dir, st.name, st.file || 'result.json') }
      fs.mkdirSync(path.dirname(vars.file), { recursive: true })
      const log = path.join(dir, 'logs', `${safeName(st.name)}.log`)
      const env = { ...process.env }
      for (const [k, v] of Object.entries(st.env || {})) env[k] = fill(String(v), vars)
      const w = wrapFor(st.slot === undefined ? 'heavy' : st.slot)(fill(st.cmd, vars))
      const r = await runLogged(w.cmd, log, { cwd: path.resolve(root, st.cwd || '.'), env, echo: o.echo !== false, argv: w.argv })
      manifest.results.push({ adapter: st.adapter, kind: st.kind || 'unit', suite: st.suite || st.name, file: vars.file, log, exit: r.exit, durationMs: r.durationMs })
      return r.exit
    })
  }

  manifest.finishedAt = new Date().toISOString()
  for (const k of ['coverage', 'mutation']) {
    if (Array.isArray(config[k])) manifest[k] = config[k].map((c) => ({ area: c.area, file: path.resolve(root, c.file) }))
  }
  save()

  const failed = manifest.stages.filter((s) => s.status === 'failed').map((s) => s.name)
  let report = { status: 0, skipped: false }
  const py = pythonReady()
  if (!py.ok) {
    report = { status: 0, skipped: true, python: py.python }
    console.error(py.python === 'missing' ? msg.noPython : msg.noOpenpyxl)
    console.error(msg.rawKept(dir))
  } else {
    const core = o.core || path.join(HERE, '..', 'core', 'build_xlsx.py')
    const args = [core, '--results-dir', dir, '--name', o.name, '--repo', root, '--runs-dir', runsDir, '--lang', lang]
    if (o.casesDir) args.push('--cases-dir', path.resolve(root, o.casesDir))
    if (o.ledgerPriority) args.push('--ledger-priority', o.ledgerPriority)
    if (o.out) args.push('--out', path.resolve(root, o.out))
    else if (o.outTemplate) args.push('--out-template', o.outTemplate)
    const r = spawnSync(process.env.WB_PYTHON || 'python3', args, { cwd: root, stdio: o.echo === false ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
    report = { status: r.status ?? 1, skipped: false, stdout: r.stdout }
  }
  if (o.echo !== false) console.log(`\n${msg.done(dir, failed)}`)
  return { dir, failed, manifest, report, exit: failed.length || report.status ? 1 : 0 }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await runVerify(parseArgs(process.argv.slice(2)))
  process.exit(r.exit)
}
