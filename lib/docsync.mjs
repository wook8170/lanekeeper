// lib/docsync.mjs — docs sync: from a change of screens or features to the documents that must follow
// (the impact map) and the gate that fails when a required one was left alone. Pure logic: the
// caller (bin/wb-docs) passes the changed files, the diff and functions to read and list files, so
// the tests reproduce every decision on a small in-memory repository. Settings: project.docs_sync.
//
// The impact map is a list of items { level: required | review, target, file?, line?, phrase?,
// suggestion?, image?, code, vars }. With a file, that file must change in the same change; without
// one, any path of the target will do. An unmet required item fails the gate, a review item warns.
// Items come from five sources:
//   1. rules          changed paths → targets (require · review)
//   2. mirrors        one side of a pair changed → the other side is required (two front ends, …)
//   3. groups         part of a group changed → the rest is required (a document and its copies)
//   4. reverse index  a phrase that left the screen code but stays in a document → that document is
//                     required; phrases near the changed lines or new phrases found in documents → review
//   5. shots          capture scenes whose test ids the changed screens carry → recapture candidates,
//                     and the documents that show those pictures → review
// code is one of rule · mirror · group · vanished · nearby · shot · shot_page (locale docs.reason.*).
// A phrase is a string with letters and at least one space between words, unless text_pattern says otherwise.
const DEFAULT_TEXT = '\\p{L}+\\s+\\p{L}'

// ---- paths -----------------------------------------------------------------

const reCache = new Map()
/** glob → RegExp. `**` spans folders, `*` and `?` stay inside one, `{a,b}` is a choice. */
export function globToRegExp(glob) {
  if (reCache.has(glob)) return reCache.get(glob)
  let s = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') { i++; s += '(?:.*/)?' } else s += '.*'
      } else s += '[^/]*'
    } else if (c === '?') s += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end < 0) { s += '\\{'; continue }
      s += `(?:${glob.slice(i + 1, end).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`
      i = end
    } else s += /[.+^$()|[\]\\]/.test(c) ? `\\${c}` : c
  }
  const re = new RegExp(`^${s}$`)
  reCache.set(glob, re)
  return re
}

export const matchAny = (file, globs = []) => globs.some((g) => globToRegExp(g).test(file))

// ---- settings --------------------------------------------------------------

const pick = (c, snake, camel, dflt) => (c[snake] !== undefined ? c[snake] : c[camel] !== undefined ? c[camel] : dflt)
const camelScript = (s) => ({
  file: s.file,
  callPattern: pick(s, 'call_pattern', 'callPattern', ''),
  keyPattern: pick(s, 'key_pattern', 'keyPattern', ''),
  keyScope: pick(s, 'key_scope', 'keyScope', ''),
  entryFunctions: pick(s, 'entry_functions', 'entryFunctions', {}),
  image: s.image || '',
  ref: s.ref || '',
  command: s.command || '',
})

/** project.docs_sync (snake_case; camelCase also read) → the internal shape. */
export function normalizeConfig(c = {}) {
  const ri = pick(c, 'reverse_index', 'reverseIndex', {}) || {}
  const shots = c.shots || {}
  return {
    base: c.base || 'main',
    releaseTag: pick(c, 'release_tag', 'releaseTag', 'v*'),
    qualityBase: pick(c, 'quality_base', 'qualityBase', 'release'),
    screenSources: pick(c, 'screen_sources', 'screenSources', []),
    screenExclude: pick(c, 'screen_exclude', 'screenExclude', []),
    ignore: c.ignore || [],
    textPattern: pick(c, 'text_pattern', 'textPattern', '') || DEFAULT_TEXT,
    minPhraseLength: pick(c, 'min_phrase_length', 'minPhraseLength', 4),
    maxFilesPerPhrase: pick(c, 'max_files_per_phrase', 'maxFilesPerPhrase', 12),
    targets: (c.targets || []).map((t) => ({ kind: 'write', ...t, paths: t.paths || [] })),
    rules: c.rules || [],
    mirrors: c.mirrors || [],
    groups: c.groups || [],
    reverseIndex: { targets: ri.targets || [], exclude: ri.exclude || [] },
    shots: { scripts: (shots.scripts || []).map(camelScript), command: shots.command || '' },
    screenRegistry: (() => { const r = pick(c, 'screen_registry', 'screenRegistry', null); return r && r.file ? r : null })(),
    autofix: c.autofix || [],
    checks: c.checks || [],
    manualItems: pick(c, 'manual_items', 'manualItems', []),
    ackFile: pick(c, 'ack_file', 'ackFile', ''),
    style: c.style || '',
    gate: { failOn: pick(c, 'fail_on', 'failOn', '') || c.gate?.failOn || 'required' },
  }
}

// ---- diff and phrases ------------------------------------------------------

/** unified diff → Map(file → { status, hunks: [{ removed[], added[], context[] }] }). */
export function parseDiff(text = '') {
  const files = new Map()
  let cur = null
  let hunk = null
  let header = false
  let minus = ''
  const open = (f) => {
    if (!files.has(f)) files.set(f, { file: f, status: 'M', hunks: [] })
    return files.get(f)
  }
  for (const line of String(text).split('\n')) {
    if (line.startsWith('diff --git ')) {
      header = true
      hunk = null
      minus = ''
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
      cur = m ? open(m[2]) : null
      continue
    }
    if (header) {
      if (line.startsWith('--- ')) { minus = line.slice(4).replace(/^a\//, ''); continue }
      if (line.startsWith('+++ ')) {
        if (cur && line.slice(4) === '/dev/null') cur.status = 'D'
        else if (cur && minus === '/dev/null') cur.status = 'A'
        continue
      }
      if (line.startsWith('new file')) { if (cur) cur.status = 'A'; continue }
      if (line.startsWith('deleted file')) { if (cur) cur.status = 'D'; continue }
    }
    if (line.startsWith('@@')) {
      header = false
      if (!cur) continue
      hunk = { removed: [], added: [], context: [] }
      cur.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    if (line.startsWith('+')) hunk.added.push(line.slice(1))
    else if (line.startsWith('-')) hunk.removed.push(line.slice(1))
    else if (line.startsWith(' ')) hunk.context.push(line.slice(1))
  }
  return files
}

const STR_RE = /(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g
const JSX_RE = />([^<>{}]+)</g
const CODEISH = /[;{}()=<>]|=>|\bconst\b|\bimport\b/

/** Phrases people read on one line: string literals and text between tags that match text_pattern. Comment lines are skipped. */
export function extractPhrases(line, opts = {}) {
  const text = new RegExp(opts.textPattern || DEFAULT_TEXT, 'u')
  const min = opts.minPhraseLength ?? 4
  const out = new Set()
  const add = (s) => {
    const v = String(s).replace(/\s+/g, ' ').trim()
    if (v && [...v].length >= min && text.test(v)) out.add(v)
  }
  const bare0 = String(line).trim()
  if (bare0.startsWith('//') || bare0.startsWith('*') || bare0.startsWith('/*') || bare0.startsWith('<!--') || bare0.includes('*/')) return out
  const src = String(line).replace(/\s\/\/\s.*$/, '')
  const bare = src.trim()
  for (const m of src.matchAll(STR_RE)) if (!(m[1] === '`' && m[2].includes('${'))) add(m[2])
  for (const m of src.matchAll(JSX_RE)) add(m[1])
  if (!out.size && bare && !CODEISH.test(bare) && !/['"`]/.test(bare)) add(bare)
  return out
}

const TESTID_RES = [/data-testid=["'`]([\w:.-]+)["'`]/g, /getByTestId\(\s*["'`]([\w:.-]+)["'`]/g, /testid=["'`]([\w:.-]+)["'`]/gi]
export function extractTestIds(text) {
  const out = new Set()
  for (const re of TESTID_RES) for (const m of String(text).matchAll(re)) out.add(m[1])
  return out
}

function phrasesOf(lines, opts) {
  const out = []
  for (const l of lines) for (const p of extractPhrases(l, opts)) if (!out.includes(p)) out.push(p)
  return out
}

/** One file's diff → phrases removed, phrases added, pairs (in order inside one hunk) and nearby phrases. */
export function phraseChanges(fileDiff, opts = {}) {
  const allRemoved = new Set()
  const allAdded = new Set()
  for (const h of fileDiff.hunks) {
    for (const p of phrasesOf(h.removed, opts)) allRemoved.add(p)
    for (const p of phrasesOf(h.added, opts)) allAdded.add(p)
  }
  const removed = new Set([...allRemoved].filter((p) => !allAdded.has(p)))
  const added = new Set([...allAdded].filter((p) => !allRemoved.has(p)))
  const pairs = []
  const context = new Set()
  for (const h of fileDiff.hunks) {
    const r = phrasesOf(h.removed, opts).filter((p) => removed.has(p))
    const a = phrasesOf(h.added, opts).filter((p) => added.has(p))
    if (r.length && r.length === a.length) r.forEach((from, i) => pairs.push({ from, to: a[i] }))
    for (const p of phrasesOf(h.context, opts)) if (!removed.has(p)) context.add(p)
  }
  return { removed, added, pairs, context }
}

// ---- capture scenes --------------------------------------------------------

/**
 * Capture script → scenes [{ key, keys, image, testids:Set }].
 * A line matching key_pattern starts a scene block (the key a capture run takes, e.g. a SHOTS entry);
 * call_pattern matches a capture call and its first matching group is the picture name. A line matching
 * function_pattern (default: `function name`) also starts a block; a scene taken inside a function is
 * traced back through the callers to the key blocks that call it (up to 6 levels). With key_scope, keys
 * count only from that line to the next line starting with `}`. entry_functions = { function: key } ties
 * run functions called outside any key block to a key. A scene's test ids are those seen from the start
 * of its block to the capture call.
 */
export function indexShots(text, { callPattern, keyPattern, keyScope, entryFunctions = {}, functionPattern = '^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+([\\w$]+)' }) {
  const callRe = new RegExp(callPattern, 'g')
  const keyRe = keyPattern ? new RegExp(keyPattern) : null
  const fnRe = functionPattern ? new RegExp(functionPattern) : null
  const scopeRe = keyScope ? new RegExp(keyScope) : null
  let inScope = !scopeRe
  const blocks = []
  let cur = { kind: 'top', name: '', calls: new Set(), acc: new Set() }
  blocks.push(cur)
  const raw = []
  for (const line of String(text).split('\n')) {
    if (scopeRe && scopeRe.test(line)) inScope = true
    else if (scopeRe && inScope && /^\}/.test(line)) inScope = false
    const f = fnRe && fnRe.exec(line)
    const k = !f && inScope && keyRe && keyRe.exec(line)
    if (f || k) {
      cur = { kind: f ? 'fn' : 'key', name: (f || k)[1], calls: new Set(), acc: new Set() }
      blocks.push(cur)
    }
    for (const m of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) cur.calls.add(m[1])
    for (const id of extractTestIds(line)) cur.acc.add(id)
    for (const m of line.matchAll(callRe)) raw.push({ block: cur, image: m.slice(1).find((g) => g !== undefined), testids: new Set(cur.acc) })
  }
  const keysFor = (block) => {
    if (block.kind === 'key') return [block.name]
    if (block.kind !== 'fn') return []
    const out = []
    const alias = (fn) => { const a = entryFunctions[fn]; if (a && !out.includes(a)) out.push(a) }
    alias(block.name)
    let frontier = [block.name]
    const seenFn = new Set(frontier)
    for (let depth = 0; depth < 6 && frontier.length; depth++) {
      const next = []
      for (const b of blocks) {
        if (![...frontier].some((fn) => b.calls.has(fn)) || b === block) continue
        if (b.kind === 'key' && !out.includes(b.name)) out.push(b.name)
        if (b.kind === 'fn' && !seenFn.has(b.name)) { seenFn.add(b.name); alias(b.name); next.push(b.name) }
      }
      frontier = next
    }
    return out
  }
  const cache = new Map()
  return raw.map((r) => {
    if (!cache.has(r.block)) cache.set(r.block, keysFor(r.block))
    const keys = cache.get(r.block)
    return { key: keys[0] || null, keys, image: r.image, testids: r.testids }
  })
}

// ---- impact map ------------------------------------------------------------

const LEVEL_RANK = { required: 2, review: 1 }

/**
 * @param {{ config, changed: {file,status}[], diff: Map, read: (f)=>string|null, list: (globs)=>string[] }} input
 */
export function buildImpactMap({ config, changed = [], diff = new Map(), read, list }) {
  const cfg = normalizeConfig(config)
  const items = []
  const seen = new Set()
  const add = (it) => {
    const k = [it.level, it.target, it.file || '', it.phrase || '', it.image || ''].join('|')
    if (seen.has(k)) return
    seen.add(k)
    items.push(it)
  }
  const live = changed.filter((c) => !matchAny(c.file, cfg.ignore))
  const changedSet = new Set(changed.map((c) => c.file))
  const targetById = new Map(cfg.targets.map((t) => [t.id, t]))
  const targetOf = (file) => cfg.targets.find((t) => matchAny(file, t.paths))?.id || ''
  const isScreen = (f) => matchAny(f, cfg.screenSources) && !matchAny(f, cfg.screenExclude) && !matchAny(f, cfg.ignore)
  const screenChanged = live.filter((c) => isScreen(c.file))

  // 1. rules
  for (const r of cfg.rules) {
    const hit = live.filter((c) => matchAny(c.file, r.when || []) && !matchAny(c.file, r.unless || []))
    if (!hit.length) continue
    const vars = { why: r.why || '', file: hit[0].file, more: hit.length - 1 }
    for (const id of r.require || []) add({ level: 'required', target: id, code: 'rule', vars })
    for (const id of r.review || []) add({ level: 'review', target: id, code: 'rule', vars })
  }

  // 2. mirrors
  for (const c of live) {
    for (const m of cfg.mirrors) {
      const re = new RegExp(m.from)
      if (!re.test(c.file)) continue
      const cp = c.file.replace(re, m.to)
      if (changedSet.has(cp) || read(cp) === null) continue
      add({ level: 'required', target: m.target || targetOf(cp), file: cp, code: 'mirror', vars: { file: c.file } })
    }
  }

  // 3. groups
  for (const g of cfg.groups) {
    const done = g.files.filter((f) => changedSet.has(f))
    if (!done.length || done.length === g.files.length) continue
    for (const f of g.files) if (!changedSet.has(f)) add({ level: 'required', target: g.target || targetOf(f), file: f, code: 'group', vars: { name: g.name, files: done.join(', ') } })
  }

  // 4. reverse index
  const docGlobs = cfg.reverseIndex.targets.flatMap((id) => targetById.get(id)?.paths || [])
  const docFiles = docGlobs.length && screenChanged.length ? list(docGlobs).filter((f) => !matchAny(f, cfg.reverseIndex.exclude) && !isScreen(f)) : []
  const docText = new Map()
  const textOf = (f) => {
    if (!docText.has(f)) docText.set(f, read(f) ?? '')
    return docText.get(f)
  }
  const screenFiles = screenChanged.length ? list(cfg.screenSources).filter((f) => isScreen(f)) : []
  const screenText = new Map()
  const inScreens = (phrase) => screenFiles.some((f) => {
    if (!screenText.has(f)) screenText.set(f, read(f) ?? '')
    return screenText.get(f).includes(phrase)
  })
  const findHits = (phrase) => {
    const hits = []
    for (const f of docFiles) {
      const body = textOf(f)
      const at = body.indexOf(phrase)
      if (at >= 0) hits.push({ file: f, line: body.slice(0, at).split('\n').length })
    }
    return hits
  }
  const vanished = []
  const addedPhrases = new Set()
  const pairs = new Map()
  const context = new Set()
  for (const c of screenChanged) {
    const fd = diff.get(c.file)
    if (!fd) continue
    const ch = phraseChanges(fd, cfg)
    for (const p of ch.pairs) if (!pairs.has(p.from)) pairs.set(p.from, p.to)
    for (const p of ch.added) addedPhrases.add(p)
    for (const p of ch.context) context.add(p)
    for (const p of ch.removed) if (!vanished.includes(p) && !inScreens(p)) vanished.push(p)
  }
  const skippedPhrases = []
  // Overlapping phrases on one line (a long one holding a short one): keep the shortest.
  const byLine = new Map()
  for (const phrase of vanished) {
    const hits = findHits(phrase)
    if (hits.length > cfg.maxFilesPerPhrase) { skippedPhrases.push({ phrase, files: hits.length }); continue }
    for (const h of hits) {
      const k = `${h.file}:${h.line}`
      const prev = byLine.get(k)
      if (!prev || [...phrase].length < [...prev.phrase].length) byLine.set(k, { ...h, phrase })
    }
  }
  for (const h of byLine.values()) add({ level: 'required', target: targetOf(h.file), file: h.file, line: h.line, phrase: h.phrase, suggestion: pairs.get(h.phrase), code: 'vanished', vars: { phrase: h.phrase } })
  for (const phrase of [...context, ...addedPhrases]) {
    const hits = findHits(phrase)
    if (!hits.length) continue
    if (hits.length > cfg.maxFilesPerPhrase) { skippedPhrases.push({ phrase, files: hits.length }); continue }
    for (const h of hits) add({ level: 'review', target: targetOf(h.file), file: h.file, line: h.line, phrase, code: 'nearby', vars: { phrase } })
  }

  // 5. shots
  const shots = []
  const shotSeen = new Set()
  const commands = []
  if (screenChanged.length && cfg.shots.scripts.length) {
    const changedIds = new Set()
    for (const c of screenChanged) {
      const body = read(c.file)
      const src = body !== null ? body : (diff.get(c.file)?.hunks || []).flatMap((h) => h.removed).join('\n')
      for (const id of extractTestIds(src)) changedIds.add(id)
    }
    for (const s of cfg.shots.scripts) {
      const text = read(s.file)
      if (text === null) continue
      const keys = []
      for (const sc of indexShots(text, s)) {
        const match = [...sc.testids].filter((id) => changedIds.has(id))
        if (!match.length) continue
        const k = `${s.file}|${sc.key}|${sc.image}`
        if (shotSeen.has(k)) continue
        shotSeen.add(k)
        const imagePath = s.image ? s.image.replace('{name}', sc.image) : ''
        shots.push({ script: s.file, key: sc.key, image: sc.image, path: imagePath, testids: match })
        if (imagePath && targetOf(imagePath)) add({ level: 'review', target: targetOf(imagePath), file: imagePath, image: sc.image, code: 'shot', vars: { key: sc.key } })
        for (const kk of sc.keys || (sc.key ? [sc.key] : [])) if (!keys.includes(kk)) keys.push(kk)
        const ref = (s.ref || (imagePath ? imagePath.split('/').pop() : sc.image)).replace('{name}', sc.image)
        for (const f of docFiles) if (textOf(f).includes(ref)) add({ level: 'review', target: targetOf(f), file: f, image: sc.image, code: 'shot_page', vars: { ref } })
      }
      const tpl = s.command || cfg.shots.command
      if (keys.length && tpl) commands.push(tpl.replace('{keys}', keys.join(',')))
    }
  }

  // screen registry (optional): screens whose sources changed
  const screens = []
  if (cfg.screenRegistry && screenChanged.length) {
    const r = cfg.screenRegistry
    try {
      const body = JSON.parse(read(r.file) || '{}')
      const rows = (r.list ? body[r.list] : body) || []
      const files = new Set(screenChanged.map((c) => c.file))
      for (const row of rows) if ((row[r.sources || 'sources'] || []).some((f) => files.has(f))) screens.push({ id: row[r.id || 'id'], title: row[r.title || 'title'] })
    } catch { /* no registry or a broken one: skip */ }
  }

  const fire = (when) => when === 'always' || live.some((c) => matchAny(c.file, when || []))
  const targets = cfg.targets.map((t) => {
    const mine = items.filter((i) => i.target === t.id)
    const level = mine.reduce((a, i) => (LEVEL_RANK[i.level] > (LEVEL_RANK[a] || 0) ? i.level : a), '')
    return { id: t.id, name: t.name, kind: t.kind, level, changed: changed.some((c) => matchAny(c.file, t.paths)), count: mine.length }
  })
  return {
    changed,
    screenFiles: screenChanged.map((c) => c.file),
    items,
    targets,
    targetPaths: Object.fromEntries(cfg.targets.map((t) => [t.id, t.paths])),
    phrases: { vanished, added: [...addedPhrases], pairs: [...pairs].map(([from, to]) => ({ from, to })) },
    skippedPhrases,
    shots,
    recapture: commands.join('\n'),
    screens,
    autofix: cfg.autofix.filter((a) => fire(a.when)),
    checks: cfg.checks.filter((a) => !a.when || !a.when.length || fire(a.when)),
    manual: cfg.manualItems.filter((m) => fire(m.when)).map((m) => m.text),
    gate: cfg.gate,
    style: cfg.style,
  }
}

// ---- gate ------------------------------------------------------------------

/** Impact map + the files that changed → { verdict, missing, warnings, acked, required, failedTargets, counts }. */
export function judgeGate(map, { changed = map.changed || [], acks = [], strict = false } = {}) {
  const changedSet = new Set(changed.map((c) => c.file))
  const satisfied = (it) => (it.file ? changedSet.has(it.file) : changed.some((c) => matchAny(c.file, map.targetPaths?.[it.target] || [])))
  const ackOf = (it) => acks.find((a) => a.target === it.target && (!a.file || a.file === it.file) && (!a.phrase || a.phrase === it.phrase))
  const missing = []
  const warnings = []
  const acked = []
  let passed = 0
  const required = map.items.filter((i) => i.level === 'required')
  for (const it of required) {
    if (satisfied(it)) { passed++; continue }
    const a = ackOf(it)
    if (a) { passed++; acked.push({ ...it, ack: a }); continue }
    missing.push(it)
  }
  for (const it of map.items.filter((i) => i.level === 'review')) if (!satisfied(it)) warnings.push(it)
  const failOnReview = strict || map.gate?.failOn === 'review'
  const failed = missing.length > 0 || (failOnReview && warnings.length > 0)
  // One test per target. A target with an unmet required item fails. Removing a target from the settings
  // lowers the test count, which the ship precheck reports as weakened. Items outside every target count as one more.
  const ids = (map.targets || []).map((t) => t.id)
  const bad = new Set([...missing, ...(failOnReview ? warnings : [])].map((i) => i.target || '(outside targets)'))
  for (const id of bad) if (!ids.includes(id)) ids.push(id)
  return {
    verdict: failed ? 'failed' : 'passed',
    missing,
    warnings,
    acked,
    required: { total: required.length, satisfied: passed - acked.length, acked: acked.length, missing: missing.length },
    failedTargets: [...bad],
    counts: { total: ids.length, passed: ids.length - bad.size, failed: bad.size, skipped: 0, fixme: 0, flaky: 0 },
  }
}
