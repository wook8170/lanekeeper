// browser-guard: block browser runs that open a window (they take focus away
// from the person using the machine). Headless runs pass; slot limits are a
// separate guard.
import { deny } from './common.mjs'

const BROWSER_BIN = /^(google-chrome(-stable|-beta|-unstable)?|chrome|chromium(-browser)?|google chrome( canary| beta| dev)?|chromium|microsoft-edge(-stable)?|msedge|microsoft edge|brave(-browser)?|brave browser|firefox|safari)$/i
const BROWSER_APP = /chrome|chromium|edge|brave|firefox|safari|arc|opera|vivaldi/i
const RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'pnpm', 'yarn', 'npm', 'bun'])
const PW_WINDOW_SUBS = new Set(['open', 'codegen', 'cr', 'ff', 'wk', 'show-trace', 'show-report'])
const HEADLESS_FALSE = /headless["']?\s*[:=]\s*(false|False|0)\b/

export function judgeBrowser(cmd) {
  const name = cmd.name
  const texts = cmd.args.map((a) => a.text)
  const bodies = cmd.redirs.map((r) => r.body).filter(Boolean)
  if (BROWSER_BIN.test(name)) {
    const headless = texts.some((t) => /^--?headless(=|$)/.test(t))
    return headless ? null : deny('browser.headed', { cmd: name })
  }
  if (name === 'open' || name === 'xdg-open') {
    const appIdx = texts.findIndex((t) => t === '-a' || t === '-b')
    if (appIdx !== -1 && BROWSER_APP.test(texts[appIdx + 1] || '')) return deny('browser.open', { cmd: `${name} ${texts.slice(0, appIdx + 2).join(' ')}` })
    if (texts.some((t) => /^(https?:|file:)\/\//i.test(t) || /\.html?$/i.test(t))) return deny('browser.open', { cmd: name })
    return null
  }
  if (name === 'osascript' && texts.some((t) => BROWSER_APP.test(t) && /tell application/i.test(t))) return deny('browser.open', { cmd: 'osascript' })
  // any runner flag that turns on a visible window
  if (texts.includes('--headed')) return deny('browser.headed', { cmd: `${name} --headed` })
  const env = cmd.env || {}
  if (env.PWDEBUG && env.PWDEBUG !== '0') return deny('browser.headed', { cmd: 'PWDEBUG' })
  if (env.HEADED && !/^(0|false)$/i.test(env.HEADED)) return deny('browser.headed', { cmd: 'HEADED' })
  const pwAt = name === 'playwright' ? -1 : RUNNERS.has(name) ? texts.findIndex((t) => /^(@playwright\/test|playwright)(@.*)?$/.test(t)) : -2
  if (pwAt !== -2) {
    const rest = texts.slice(pwAt + 1)
    const sub = rest.find((t) => !t.startsWith('-'))
    if (sub && PW_WINDOW_SUBS.has(sub)) return deny('browser.playwright_window', { cmd: `playwright ${sub}` })
    if (rest.some((t) => t === '--debug' || t === '--ui' || t.startsWith('--ui-'))) return deny('browser.playwright_window', { cmd: 'playwright --debug/--ui' })
  }
  // inline scripts: node -e, python -c, heredoc bodies
  if ([...texts, ...bodies].some((t) => HEADLESS_FALSE.test(t))) return deny('browser.headed', { cmd: 'headless: false' })
  return null
}
