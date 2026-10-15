// Message lookup for ko/en. Missing keys fall back to English, then to the key.
import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT } from './config.mjs'

export const LANGUAGES = ['ko', 'en']
const cache = {}

export function messages(lang) {
  if (!cache[lang]) {
    cache[lang] = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'locales', `${lang}.json`), 'utf8'))
  }
  return cache[lang]
}

export function translator(lang) {
  const primary = LANGUAGES.includes(lang) ? messages(lang) : messages('en')
  const fallback = messages('en')
  return (key, vars = {}) => {
    const tpl = primary[key] ?? fallback[key] ?? key
    return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
  }
}
