#!/usr/bin/env node
// Stop: at the report stage, finished work must be published as an artifact and the
// newest verification workbook must be in order. Blocks once per report.
//
// Report stage = the session ran /lanekeeper:report (Skill call or slash command). After the last
// such point the transcript must show an artifact: an Artifact tool call (any tool whose
// name contains "artifact"), or — when personal.report.artifact_fallback is "html-file" —
// a `lanekeeper-art report` command. When the project keeps test result workbooks (a verify
// config or a results folder exists), `lanekeeper-check test-results` must also pass.
// Off with personal.report.artifact_check = false. Not a safety hook: fail-open.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot, getPath } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { dataDir, hookMain, safeId } from '../../../lib/runtime.mjs'
import { checkTestResults, resultPaths, VERIFY_CONFIG } from '../../../lib/testresults.mjs'
import { projectRel } from '../../../lib/naming.mjs'

const REPORT_SKILL = /^(lanekeeper:)?report$/
const REPORT_CMD = /<command-name>\s*\/?lanekeeper:report\s*<\/command-name>|^\s*\/lanekeeper:report\b/m

function entries(file) {
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* partial line */
    }
  }
  return out
}

const contentOf = (e) => {
  const c = e?.message?.content
  if (typeof c === 'string') return [{ type: 'text', text: c }]
  return Array.isArray(c) ? c : []
}

// { start: index of the last report-stage signal or -1, artifact: bool, htmlFile: bool }
export function scan(list) {
  let start = -1
  list.forEach((e, i) => {
    for (const b of contentOf(e)) {
      if (e.type === 'user' && b.type === 'text' && REPORT_CMD.test(b.text || '')) start = i
      if (b.type === 'tool_use' && b.name === 'Skill' && REPORT_SKILL.test(String(b.input?.skill || '').replace(/^\//, ''))) start = i
    }
  })
  let artifact = false
  let htmlFile = false
  if (start >= 0) {
    for (const e of list.slice(start)) {
      for (const b of contentOf(e)) {
        if (b.type !== 'tool_use') continue
        if (/artifact/i.test(b.name || '')) artifact = true
        if (b.name === 'Bash' && /\blanekeeper-art\s+report\b/.test(String(b.input?.command || ''))) htmlFile = true
      }
    }
  }
  return { start, artifact, htmlFile }
}

export function handle(input, env = process.env) {
  if (input.stop_hook_active === true) return null
  const cwd = input.cwd || process.cwd()
  const root = projectRoot(cwd, env)
  const resolved = resolveConfig({ projectDir: root, env })
  const rep = getPath(resolved.config, 'personal.report') || {}
  if (rep.artifact_check === false) return null
  const s = scan(entries(input.transcript_path))
  if (s.start < 0) return null

  const sid = safeId(input.session_id)
  const mark = path.join(dataDir(env), 'report', `${sid}.blocked`)
  try {
    if (fs.readFileSync(mark, 'utf8').trim() === String(s.start)) return null
  } catch {
    /* not blocked yet */
  }
  const t = translator(resolved.effective.language)
  const problems = []
  const published = s.artifact || (rep.artifact_fallback !== 'none' && s.htmlFile)
  if (!published) problems.push(t('artifact.missing', { fallback: rep.artifact_fallback === 'none' ? '' : t('artifact.fallback') }))

  const { resultsBase } = resultPaths(root, resolved.config)
  if (fs.existsSync(path.join(root, projectRel(root, VERIFY_CONFIG))) || fs.existsSync(resultsBase)) {
    const r = checkTestResults(root, resolved.config)
    if (!r.ok) problems.push(t('artifact.xlsx', { items: r.items.filter((i) => i.level === 'fail').map((i) => i.id).join(', ') }))
  }
  if (!problems.length) return null
  fs.mkdirSync(path.dirname(mark), { recursive: true })
  fs.writeFileSync(mark, String(s.start))
  return { decision: 'block', reason: `[lanekeeper] ${t('artifact.head')}\n- ${problems.join('\n- ')}` }
}

hookMain(import.meta, (i, e) => handle(i, e))
