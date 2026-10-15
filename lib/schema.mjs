// Minimal schema checker for wb settings files (no dependencies).
//
// Schema node forms:
//   { type: 'object', props: {...}, extra: 'warn' | 'allow' }  unknown keys warn by default
//   { type: 'map', values: <schema> }                         free keys, each value checked
//   { type: 'array', items: <schema> }
//   { type: 'string', enum?: [...] }
//   { type: 'integer' | 'number', min?, max? }
//   { type: 'boolean' }
//   { anyOf: [<schema>, ...] }

const str = (extra = {}) => ({ type: 'string', ...extra })
const int = (min, max) => ({ type: 'integer', min, max })
const bool = { type: 'boolean' }
const strList = { type: 'array', items: str() }
const obj = (props, extra = 'warn') => ({ type: 'object', props, extra })


export const routingSchema = obj({
  version: int(1, 1),
  models: { type: 'map', values: obj({ agent_param: str(), rank: int(0, 100) }) },
  denied: strList,
  denied_note: { type: 'map', values: str() },
  tasks: {
    type: 'map',
    values: obj({
      label: str(),
      chain: strList,
      floor: str(),
      on_floor: str({ enum: ['wait-notify'] }),
      differ_from: str({ enum: ['implementer'] }),
    }),
  },
  limits_state: str(),
})

export const machineSchema = obj({
  version: int(1, 1),
  lanes: obj({ max: int(1, 64) }),
  load: obj({
    max: { anyOf: [str({ enum: ['auto'] }), { type: 'number', min: 1 }] },
    auto_rule: str(),
    sample: str({ enum: ['1min', '5min', '15min'] }),
  }),
  slots: obj({
    heavy: obj({ count: int(1, 64), patterns: strList }),
    browser: obj({ count: int(1, 64), patterns: strList }),
    lease_dir: str(),
    stale_after_min: int(1, 100000),
  }),
  ports: obj({
    protected: {
      type: 'array',
      items: obj({ name: str(), port: int(0, 65535), project: str(), note: str() }),
    },
    lane_range: obj({
      base: int(1, 65535),
      step: int(1, 1000),
      per_lane: strList,
      max_lanes: int(1, 64),
    }),
    leases: str(),
  }),
  servers: {
    type: 'array',
    items: obj({ name: str(), port_ref: str(), restart: str(), verify_url_path: str() }),
  },
})

export const personalSchema = obj({
  version: int(1, 1),
  language: str({ enum: ['auto', 'ko', 'en'] }),
  report: obj({
    chat_detail: str({ enum: ['summary', 'detailed'] }),
    viewer: str({ enum: ['local', 'remote'] }),
    artifact_fallback: str({ enum: ['html-file', 'none'] }),
  }),
  auto_retry: obj({
    enabled: bool,
    permission_mode: str({ enum: ['default', 'acceptEdits', 'plan', 'bypassPermissions'] }),
  }),
  paths: obj({ scratch_root: str() }),
  token_guard: obj({ enabled: bool, stages: { type: 'array', items: int(1, 100) } }),
  terse: bool,
})

export const projectSchema = obj({
  version: int(1, 1),
  project_kind: str({ enum: ['web-ui', 'service', 'library', 'other'] }),
  git: obj({
    protected_branches: strList,
    integration_branch_pattern: str(),
    lane_branch_pattern: str(),
    worktree_root: str(),
    main_checkout: str(),
    feature_push: str({ enum: ['ask', 'allow', 'deny'] }),
    gate_stamp: str(),
    owner_grant_ttl_min: int(1, 1440),
  }),
  paths: { type: 'map', values: { anyOf: [str(), obj({ over_kb: int(1, 1e6), quality: int(1, 100) })] } },
  gate: obj({ command: str(), verify_all: str(), append_checks: strList }),
  glossary: obj({ terms_dict: str(), terms_scan: str(), copy_globs: strList }),
  style: obj({
    map: { type: 'array', items: obj({ glob: str(), style: str({ enum: ['haeyo', 'report', 'plain'] }) }) },
  }),
  mockup: obj({ ui_globs: strList, tokens_css: str(), decision_required: bool }),
  codegraph: obj({ nudge: str({ enum: ['off', 'warn'] }), index_on_worktree: bool }),
  ui_stability: obj({ enabled: bool, adapter: str() }),
  protected_paths: strList,
  explain: obj({ links: { type: 'array', items: obj({ title: str(), href: str() }) } }),
})

export const SCHEMAS = {
  routing: routingSchema,
  machine: machineSchema,
  personal: personalSchema,
  project: projectSchema,
}

function typeOf(v) {
  if (Array.isArray(v)) return 'array'
  if (v === null) return 'null'
  if (Number.isInteger(v)) return 'integer'
  return typeof v
}

// Returns { errors: [{path, msg}], warnings: [{path, msg}] }
export function check(schema, value, path = '', out = { errors: [], warnings: [] }) {
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => check(s, value, path).errors.length === 0)
    if (!ok) out.errors.push({ path, msg: 'value does not match any allowed form', code: 'anyOf' })
    return out
  }
  const t = typeOf(value)
  switch (schema.type) {
    case 'object':
    case 'map': {
      if (t !== 'object') {
        out.errors.push({ path, msg: `expected object, got ${t}`, code: 'type' })
        return out
      }
      for (const [k, v] of Object.entries(value)) {
        const p = path ? `${path}.${k}` : k
        if (schema.type === 'map') {
          check(schema.values, v, p, out)
        } else if (schema.props[k]) {
          check(schema.props[k], v, p, out)
        } else if (schema.extra !== 'allow') {
          out.warnings.push({ path: p, msg: 'unknown key (ignored)', code: 'unknown' })
        }
      }
      return out
    }
    case 'array':
      if (t !== 'array') {
        out.errors.push({ path, msg: `expected array, got ${t}`, code: 'type' })
        return out
      }
      value.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, out))
      return out
    case 'string':
      if (t !== 'string') out.errors.push({ path, msg: `expected string, got ${t}`, code: 'type' })
      else if (schema.enum && !schema.enum.includes(value))
        out.errors.push({ path, msg: `must be one of ${schema.enum.join(' | ')}`, code: 'enum' })
      return out
    case 'integer':
    case 'number': {
      const okType = schema.type === 'integer' ? t === 'integer' : t === 'integer' || t === 'number'
      if (!okType) {
        out.errors.push({ path, msg: `expected ${schema.type}, got ${t}`, code: 'type' })
        return out
      }
      if (schema.min !== undefined && value < schema.min)
        out.errors.push({ path, msg: `must be >= ${schema.min}`, code: 'range' })
      if (schema.max !== undefined && value > schema.max)
        out.errors.push({ path, msg: `must be <= ${schema.max}`, code: 'range' })
      return out
    }
    case 'boolean':
      if (t !== 'boolean') out.errors.push({ path, msg: `expected boolean, got ${t}`, code: 'type' })
      return out
    default:
      throw new Error(`bad schema at ${path}`)
  }
}

// Cross-reference checks on the merged routing section.
export function checkRouting(routing, out = { errors: [], warnings: [] }) {
  const models = routing.models || {}
  for (const [name, task] of Object.entries(routing.tasks || {})) {
    for (const m of task.chain || []) {
      if (!models[m]) out.errors.push({ path: `routing.tasks.${name}.chain`, msg: `unknown model "${m}"`, code: 'ref' })
    }
    if (task.floor && !models[task.floor])
      out.errors.push({ path: `routing.tasks.${name}.floor`, msg: `unknown model "${task.floor}"`, code: 'ref' })
    if (!task.chain || task.chain.length === 0)
      out.errors.push({ path: `routing.tasks.${name}.chain`, msg: 'chain is empty', code: 'ref' })
  }
  for (const m of routing.denied || []) {
    if (!models[m]) out.warnings.push({ path: 'routing.denied', msg: `denied model "${m}" is not in models`, code: 'ref' })
  }
  return out
}
