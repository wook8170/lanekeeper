// limits.json — which models are out of quota until when.
//
// Written by the auto-retry detector, read by the routing resolver (L5):
//   { "version": 1,
//     "models": { "<routing model key | *>": { "until": "<ISO>", "scope": "5h|daily|weekly|unknown",
//                                              "recorded_at": "<ISO>", "session": "<id>" } } }
// The key "*" means the account itself is out of quota (model not identified).
// A model counts as exhausted while `until` lies in the future.
import { readJson, writeJsonAtomic } from './runtime.mjs'

export function readLimits(file) {
  const d = readJson(file)
  return d && d.version === 1 && d.models && typeof d.models === 'object' ? d : { version: 1, models: {} }
}

export function recordLimit(file, { model = '*', untilEpoch, scope = 'unknown', session = '', now = Date.now() }) {
  const d = readLimits(file)
  for (const [k, v] of Object.entries(d.models)) if (Date.parse(v.until) <= now) delete d.models[k]
  d.models[model] = {
    until: new Date(untilEpoch * 1000).toISOString(),
    scope,
    recorded_at: new Date(now).toISOString(),
    session,
  }
  writeJsonAtomic(file, d)
  return d
}

// Model keys that are still out of quota. "*" is returned as-is.
export function exhaustedModels(file, now = Date.now()) {
  const d = readLimits(file)
  return Object.entries(d.models)
    .filter(([, v]) => Date.parse(v.until) > now)
    .map(([k]) => k)
}

export function clearLimit(file, model) {
  const d = readLimits(file)
  if (model) delete d.models[model]
  else d.models = {}
  writeJsonAtomic(file, d)
}
