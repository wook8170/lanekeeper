// Artifacts: keep (repository, big PNG → WebP), temp (scratch) and a single-file
// HTML report with every image embedded as a data: URI (remote viewers cannot
// reach local paths or external URLs).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { PLUGIN_ROOT, getPath, expandHome } from './config.mjs'

const DEFAULT_WEBP = { over_kb: 300, quality: 80 }

export function webpSettings(config) {
  const w = getPath(config, 'project.paths.artifacts_keep_webp')
  return { ...DEFAULT_WEBP, ...(w && typeof w === 'object' ? w : {}) }
}

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Expand {slug} {date} {project} {scratch_root} of a path setting.
export function artPath(root, config, key, slug, env = process.env) {
  const fallback = key === 'artifacts_keep' ? 'docs/reports/artifacts/{slug}/' : '{scratch_root}/art/{slug}/'
  const tpl = String(getPath(config, `project.paths.${key}`) || fallback)
  const project = path.basename(root)
  const scratch = String(getPath(config, 'personal.paths.scratch_root') || '~/.wb-scratch/{project}').replace('{project}', project)
  const s = tpl.replace('{scratch_root}', scratch).replace('{slug}', slug).replace('{date}', today()).replace('{project}', project)
  return path.resolve(root, expandHome(s, env.HOME || os.homedir()))
}

const onPath = (cmd, env) => {
  for (const d of String(env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, cmd)
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {
      /* next */
    }
  }
  return null
}

// A PNG → WebP converter: cwebp, else Python with Pillow. null when neither exists.
// WB_CWEBP names a cwebp binary; WB_ART_CONVERTER=none disables conversion (tests).
export function findConverter(env = process.env) {
  if (env.WB_ART_CONVERTER === 'none') return null
  const cwebp = env.WB_CWEBP || onPath('cwebp', env)
  if (cwebp && env.WB_ART_CONVERTER !== 'pillow') {
    return { name: 'cwebp', run: (src, dst, q) => spawnSync(cwebp, ['-quiet', '-q', String(q), src, '-o', dst], { encoding: 'utf8' }).status === 0 }
  }
  const py = env.WB_PYTHON || 'python3'
  const ok = spawnSync(py, ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0
  if (!ok) return null
  return {
    name: 'pillow',
    run: (src, dst, q) =>
      spawnSync(py, ['-c', 'import sys\nsys.path = [p for p in sys.path if p not in ("", ".")]\nfrom PIL import Image\nImage.open(sys.argv[1]).save(sys.argv[2], "WEBP", quality=int(sys.argv[3]))', src, dst, String(q)], { encoding: 'utf8' }).status === 0,
  }
}

export const isWebp = (buf) => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'

/**
 * Copy files into dir. A PNG larger than over_kb becomes WebP at `quality`.
 * Returns [{ src, dest, converted, bytesIn, bytesOut, warn? }].
 */
export function placeFiles(files, dir, { webp = DEFAULT_WEBP, convert = true, converter } = {}, env = process.env) {
  fs.mkdirSync(dir, { recursive: true })
  const conv = converter === undefined ? findConverter(env) : converter
  const out = []
  for (const src of files) {
    const st = fs.statSync(src)
    const base = path.basename(src)
    const big = convert && /\.png$/i.test(src) && st.size > webp.over_kb * 1024
    if (big && conv) {
      const dest = path.join(dir, base.replace(/\.png$/i, '.webp'))
      if (conv.run(src, dest, webp.quality) && fs.existsSync(dest)) {
        out.push({ src, dest, converted: true, bytesIn: st.size, bytesOut: fs.statSync(dest).size })
        continue
      }
      out.push({ src, dest: copy(src, dir), converted: false, bytesIn: st.size, bytesOut: st.size, warn: 'convert_failed' })
      continue
    }
    out.push({ src, dest: copy(src, dir), converted: false, bytesIn: st.size, bytesOut: st.size, ...(big ? { warn: 'no_converter' } : {}) })
  }
  return out
}

function copy(src, dir) {
  const dest = path.join(dir, path.basename(src))
  if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest)
  return dest
}

// ---- HTML report --------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
}

// Minimal Markdown: headings, paragraphs, lists, tables, fenced code, quotes.
export function markdownToHtml(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  const html = []
  let i = 0
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  while (i < lines.length) {
    const l = lines[i]
    if (/^```/.test(l)) {
      const body = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++])
      i++
      html.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`)
      continue
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
      i++
      continue
    }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(l)
      i += 2
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]))
      html.push(`<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l)
      const items = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))
      const tag = ordered ? 'ol' : 'ul'
      html.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`)
      continue
    }
    if (/^>\s?/.test(l)) {
      const q = []
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''))
      html.push(`<blockquote>${inline(q.join(' '))}</blockquote>`)
      continue
    }
    if (!l.trim()) {
      i++
      continue
    }
    const p = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*\||\s*([-*]|\d+\.)\s|>)/.test(lines[i])) p.push(lines[i++])
    html.push(`<p>${inline(p.join(' '))}</p>`)
  }
  return html.join('\n')
}

const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' }

export function dataUri(file) {
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
}

/**
 * Build the report page. images: [{ label, file }] (already converted when big).
 * Pairs of images are shown side by side (before · after) and stack on a phone.
 */
export function buildReportHtml({ title, markdown, images = [], lang = 'en', generated = new Date() }) {
  const tpl = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'report', 'report.html'), 'utf8')
  const figures = images.map((im) => `<figure><img src="${dataUri(im.file)}" alt="${esc(im.label)}"><figcaption>${esc(im.label)}</figcaption></figure>`).join('\n')
  return tpl
    .replace('{{lang}}', lang === 'ko' ? 'ko' : 'en')
    .replace(/\{\{title\}\}/g, esc(title))
    .replace('{{date}}', esc(generated.toISOString().slice(0, 16).replace('T', ' ')))
    .replace('{{body}}', () => markdownToHtml(markdown))
    .replace('{{figures}}', () => (figures ? `<section class="figs">${figures}</section>` : ''))
}
