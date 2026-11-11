// Minimal schema checker for lanekeeper settings files (no dependencies).
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
      weight: str({ enum: ['light', 'heavy'] }),
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
    tiers: obj({
      light_only: { anyOf: [str({ enum: ['auto'] }), { type: 'number', min: 1 }] },
      hold_new_lanes: { anyOf: [str({ enum: ['auto'] }), { type: 'number', min: 1 }] },
      stop_heavy: { anyOf: [str({ enum: ['auto'] }), { type: 'number', min: 1 }] },
    }),
    check_every_min: int(0, 1440),
  }),
  slots: obj({
    heavy: obj({ count: int(1, 64), patterns: strList }),
    browser: obj({ count: int(1, 64), patterns: strList }),
    lease_dir: str(),
    stale_after_min: int(1, 100000),
    guard: str({ enum: ['warn', 'deny'] }),
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
    artifact_check: bool,
  }),
  auto_retry: obj({
    enabled: bool,
    permission_mode: str({ enum: ['default', 'acceptEdits', 'plan', 'bypassPermissions'] }),
    bypass_ack: bool,
  }),
  handoff: obj({ enabled: bool, inject: str({ enum: ['summary', 'full'] }), file: str(), throttle_min: int(0, 1440), max_lines: int(20, 100000), archive_dir: str() }),
  checkpoint: obj({ enabled: bool }),
  paths: obj({ scratch_root: str() }),
  token_guard: obj({ enabled: bool, stages: { type: 'array', items: int(1, 100) }, budget: int(0, 1e15), window_hours: int(1, 168), fresh_min: int(0, 1440), source: str({ enum: ['auto', 'official', 'local'] }) }),
  terse: bool,
  search: obj({ rg_hint: bool }),
  global_hooks: str({ enum: ['defer', 'ignore'] }),
  session_rules: obj({ language: bool, remote: bool, conduct: bool }),
  design_plugin: str(),
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
  codegraph: obj({ nudge: str({ enum: ['off', 'warn'] }), auto_index: bool, index_on_worktree: bool }),
  ui_stability: obj({ enabled: bool, adapter: str() }),
  slots: obj({ heavy: strList, browser: strList }),
  worktree: obj({ setup: str(), hook: bool }),
  protected_paths: strList,
  protected_data: obj({ paths: strList, ports: { type: 'array', items: int(1, 65535) }, containers: strList }),
  lanes: obj({ commit: str({ enum: ['allowed', 'on-instruction'] }) }),
  dispatch: obj({ brief: str({ enum: ['deny', 'warn', 'off'] }), exempt_agents: strList }),
  waves: obj({ stale_min: int(1, 1440) }),
  numbers: { type: 'map', values: obj({ dir: str(), pattern: str(), width: int(1, 9), start: int(0, 1e9) }) },
  review: obj({
    guards: { type: 'array', items: obj({ name: str(), command: str() }) },
    report_fields: { type: 'array', items: str({ enum: ['head', 'tests', 'remaining'] }) },
  }),
  integrate: obj({
    rules: { type: 'array', items: obj({ glob: str(), kind: str({ enum: ['ledger', 'union', 'generated', 'code'] }) }) },
    regenerate: { type: 'array', items: obj({ name: str(), command: str(), glob: str() }) },
    guards: { type: 'array', items: obj({ name: str(), command: str() }) },
  }),
  explain: obj({ links: { type: 'array', items: obj({ title: str(), href: str() }) } }),
  quality: obj({
    results_root: str(),
    raw_root: str(),
    version_file: str(),
    suites: {
      type: 'map',
      values: obj({
        category: str({ enum: ['unit', 'integration', 'gate', 'e2e', 'uistab', 'usability', 'ux-adversarial', 'ship'] }),
        command: str(),
        steps: { type: 'array', items: obj({ name: str(), cmd: str() }) },
        parser: str({ enum: ['vitest', 'jest', 'playwright', 'pytest', 'vitest-log', 'json', 'exit', 'steps'] }),
        result: str(),
        slot: str({ enum: ['heavy', 'browser', 'heavy,browser', 'none'] }),
        thresholds: { type: 'array', items: { anyOf: [str(), obj({ file: str(), rule: str({ enum: ['hash', 'max', 'min'] }) })] } },
        stale_paths: strList,
        timeout_min: int(0, 10080),
        env: { type: 'map', values: str() },
        note: str(),
      }),
    },
    ship: obj({
      requires: strList,
      advisory: strList,
      enforce: str({ enum: ['deny', 'warn', 'off'] }),
      agents: strList,
      skills: strList,
    }),
  }),
  release: obj({
    gates: { type: 'array', items: obj({ name: str(), command: str(), required: bool }) },
    security_check: str(),
    security_required: bool,
    security_stamp: str(),
    tag_patterns: strList,
  }),
  docs_sync: obj({
    base: str(),
    release_tag: str(),
    quality_base: str(),
    screen_sources: strList,
    screen_exclude: strList,
    ignore: strList,
    text_pattern: str(),
    min_phrase_length: int(1, 200),
    max_files_per_phrase: int(1, 100000),
    targets: { type: 'array', items: obj({ id: str(), name: str(), kind: str(), paths: strList }) },
    rules: { type: 'array', items: obj({ when: strList, unless: strList, require: strList, review: strList, why: str() }) },
    mirrors: { type: 'array', items: obj({ from: str(), to: str(), target: str() }) },
    groups: { type: 'array', items: obj({ name: str(), target: str(), files: strList }) },
    reverse_index: obj({ targets: strList, exclude: strList }),
    shots: obj({
      scripts: {
        type: 'array',
        items: obj({
          file: str(), call_pattern: str(), key_pattern: str(), key_scope: str(),
          entry_functions: { type: 'map', values: str() }, image: str(), ref: str(), command: str(),
        }),
      },
      command: str(),
    }),
    screen_registry: { type: 'map', values: str() },
    autofix: { type: 'array', items: obj({ name: str(), when: strList, command: str() }) },
    checks: { type: 'array', items: obj({ name: str(), when: strList, command: str() }) },
    manual_items: { type: 'array', items: obj({ when: strList, text: str() }) },
    ack_file: str(),
    style: str(),
    fail_on: str({ enum: ['required', 'review'] }),
  }),
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
