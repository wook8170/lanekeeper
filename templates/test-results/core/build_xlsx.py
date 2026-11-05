#!/usr/bin/env python3
"""Test results -> workbook (xlsx) and a summary json next to it.

Needs Python 3.8+ and openpyxl (`python3 -m pip install openpyxl`).

Inputs (any mix):
  --results-dir <dir>     folder written by verify-all.mjs: manifest.json (+ gate.json) and the raw files
  --input adapter:kind:suite=path[,log=path]
                          one result, e.g. vitest:unit:web=out/web.json  playwright:e2e:main=out/e2e.json
                          pytest:unit:api=out/junit.xml   adapters: vitest jest playwright pytest
                          kind: unit | integration | e2e | uistab
  --gate-json <file>      gate step record (run-gate.mjs)        --gate-log <file>  plain marker log
  --rerun adapter=path    a second run of the failed tests (a failed test that passes there = flaky)
  --cases-dir <dir>       ledger folder (*.cases.json); --cases-ref <commit> reads it at that commit
  --ledger-priority P0    active cases of this priority that are missing from the run are mismatches
  --coverage area=file    istanbul coverage-summary.json      --mutation area=file  stryker mutation.json

Output: <repo>/docs/test-results/<date>/<name>-<HHMM>.xlsx and .json (--out changes it).
Sheets: summary, unit, integration, e2e, e2e detail, UI stability, gate steps, failures, flaky,
ledger comparison, coverage, mutation. A sheet without data is not created, except summary,
failures and flaky.
"""
import argparse
import datetime as dt
import glob
import json
import os
import platform
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import adapters as A  # noqa: E402
import ledger as L  # noqa: E402
from adapters import gate as G  # noqa: E402
from model import KINDS, suite as mk_suite, suites_from_tests  # noqa: E402
from strings import T, set_lang  # noqa: E402

STATUS_KEYS = ('passed', 'failed', 'skipped', 'flaky', 'notRun', 'timedOut', 'interrupted')
KIND_KEYS = ('unit', 'integration', 'e2e', 'uistab', 'gate')


class _Words:
    """Status and kind words in the current language (the language is set once per run)."""

    def __init__(self, keys, prefix, empty=False):
        self.keys, self.prefix, self.empty = keys, prefix, empty

    def get(self, k, default=None):
        if k in self.keys:
            return T(self.prefix + k)
        return '' if (self.empty and k == '') else default

    def __getitem__(self, k):
        v = self.get(k)
        if v is None:
            raise KeyError(k)
        return v


STATUS_KO = _Words(STATUS_KEYS, 'status.', empty=True)
KIND_KO = _Words(KIND_KEYS, 'kind.')


def _openpyxl():
    from openpyxl import Workbook
    from openpyxl.formatting.rule import FormulaRule
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    return Workbook, FormulaRule, Alignment, Border, Font, PatternFill, Side, get_column_letter


# ── inputs ────────────────────────────────────────────────────────────────

def read_text(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        return f.read()


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def git(repo, *args):
    try:
        return subprocess.run(['git', '-C', repo, *args], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return ''


def latest_results_dir(runs_dir):
    runs = [d for d in glob.glob(os.path.join(runs_dir, '*')) if os.path.isdir(d)]
    return max(runs, key=os.path.getmtime) if runs else None


def add_result(model, entry):
    """entry = {adapter, kind, suite, file?, log?, exit?}. Missing/unreadable -> a notRun or failed suite row."""
    adapter, kind, name = entry['adapter'], entry.get('kind', 'unit'), entry.get('suite', '')
    if kind not in KINDS:
        raise ValueError('unknown kind: %s (known: %s)' % (kind, ', '.join(KINDS)))
    f, log = entry.get('file'), entry.get('log')
    src = f if f and os.path.isfile(f) else (log if log and os.path.isfile(log) else None)
    if src is None:
        model['suites'].append(mk_suite(kind, name or adapter, '', status='failed' if entry.get('exit') else 'notRun'))
        return
    suites, tests = A.parse(adapter, kind, name, file=f if src == f else None, log=log if src == log else None)
    if src == f and log:
        for t in tests:
            t['log'] = log
    if kind in ('e2e', 'uistab') or adapter == 'playwright':
        # one suite row per project; the row keeps the stage kind
        for t in tests:
            t['kind'] = kind
        suites = suites_from_tests(tests, kind, src)
    model['suites'] += suites
    model['tests'] += tests
    model['meta']['sources'].append(src)


def load_results_dir(model, d, args):
    man = os.path.join(d, 'manifest.json')
    if os.path.isfile(man):
        m = read_json(man)
        for k in ('name', 'startedAt', 'finishedAt', 'commit', 'branch', 'host', 'load', 'workers', 'cpus', 'note'):
            if m.get(k) not in (None, '') and not model['meta'].get(k):
                model['meta'][k] = m[k]
        model['meta']['stages'] = m.get('stages', [])
        for r in m.get('results', []):
            add_result(model, r)
        for key, dest in (('coverage', args.coverage), ('mutation', args.mutation)):
            for c in m.get(key, []):
                dest.append('%s=%s' % (c['area'], c['file']))
    if os.path.isfile(os.path.join(d, 'gate.json')):
        model['gate'] += G.parse_json(read_json(os.path.join(d, 'gate.json')), os.path.join(d, 'gate.json'))
    reruns = sorted(glob.glob(os.path.join(d, 'rerun', '*.*')))
    for p in reruns:
        base = os.path.basename(p)
        adapter = base.split('.', 1)[0].split('-', 1)[0]
        args.rerun = (args.rerun or []) + ['%s=%s' % (adapter, p)]


def parse_input(spec):
    head, _, tail = spec.partition('=')
    parts = head.split(':')
    if len(parts) != 3:
        raise ValueError('--input wants adapter:kind:suite=path (got %r)' % spec)
    entry = {'adapter': parts[0], 'kind': parts[1], 'suite': parts[2]}
    for piece in tail.split(','):
        if piece.startswith('log='):
            entry['log'] = piece[4:]
        elif piece:
            entry['file'] = piece
    return entry


def build_model(args):
    now = dt.datetime.now().astimezone().isoformat(timespec='seconds')
    model = {'meta': {'name': args.name, 'sources': [], 'generatedAt': now},
             'suites': [], 'tests': [], 'gate': [], 'ledger': [], 'coverage': [], 'mutation': []}
    for kv in args.meta or []:
        k, _, v = kv.partition('=')
        model['meta'][k] = v
    for k in ('commit', 'branch'):
        if getattr(args, k):
            model['meta'][k] = getattr(args, k)
    if args.started:
        model['meta']['startedAt'] = args.started
    args.coverage = list(args.coverage or [])
    args.mutation = list(args.mutation or [])
    explicit = any([args.input, args.gate_json, args.gate_log])
    rd = args.results_dir or (None if explicit else latest_results_dir(args.runs_dir))
    if rd:
        load_results_dir(model, rd, args)
        model['meta']['resultsDir'] = rd
    for spec in args.input or []:
        add_result(model, parse_input(spec))
    for p in args.gate_json or []:
        model['gate'] += G.parse_json(read_json(p), p)
        model['meta']['sources'].append(p)
    for p in args.gate_log or []:
        model['gate'] += G.parse_log(read_text(p), p)
        model['meta']['sources'].append(p)

    reruns = []
    for spec in args.rerun or []:
        adapter, _, path = spec.partition('=')
        kind = 'e2e' if adapter == 'playwright' else 'unit'
        reruns += A.parse(adapter, kind, '', file=path if path.endswith(('.json', '.xml')) else None,
                          log=path if not path.endswith(('.json', '.xml')) else None)[1]
        model['meta']['sources'].append(path)
    if reruns:
        apply_rerun(model['tests'], reruns)
        model['meta']['rerunSources'] = [s.partition('=')[2] for s in args.rerun]

    if args.cases_ref:
        rel = os.path.relpath(args.cases_dir, args.repo).replace(os.sep, '/').rstrip('/') + '/'
        names = [n for n in git(args.repo, 'ls-tree', '--name-only', args.cases_ref, rel).splitlines() if n.endswith('.cases.json')]
        cases, retired = L.load_cases(documents=[git(args.repo, 'show', '%s:%s' % (args.cases_ref, n)) for n in names])
        model['meta']['ledgerRef'] = args.cases_ref
    else:
        cases, retired = L.load_cases(args.cases_dir)
    if cases:
        L.link_cases(model['tests'], cases)
        model['meta']['ledgerCases'] = len(cases)
        if any(t['kind'] in ('e2e', 'uistab') for t in model['tests']):
            model['ledger'] = L.compare(model['tests'], cases, retired, args.ledger_priority)
            model['meta']['ledgerCompared'] = True

    for area_file in args.coverage:
        area, _, f = area_file.partition('=')
        if os.path.isfile(f):
            tot = read_json(f).get('total', {})
            model['coverage'].append({'area': area, 'mtime': os.path.getmtime(f),
                                      **{k: tot.get(k, {}) for k in ('lines', 'statements', 'branches', 'functions')}})
    for area_file in args.mutation:
        area, _, f = area_file.partition('=')
        if os.path.isfile(f):
            model['mutation'].append(mutation_row(area, f))

    meta = model['meta']
    meta.setdefault('commit', git(args.repo, 'rev-parse', '--short', 'HEAD'))
    meta.setdefault('branch', git(args.repo, 'rev-parse', '--abbrev-ref', 'HEAD'))
    meta.setdefault('host', platform.node())
    if not meta.get('startedAt'):
        meta['startedAt'] = meta['generatedAt']
    if not meta.get('name'):
        meta['name'] = 'run'
    return model


def mutation_row(area, f):
    cnt = {}
    for fdata in read_json(f).get('files', {}).values():
        for m in fdata.get('mutants', []):
            cnt[m.get('status')] = cnt.get(m.get('status'), 0) + 1
    k, to, sv, nc = (cnt.get(x, 0) for x in ('Killed', 'Timeout', 'Survived', 'NoCoverage'))
    den = k + to + sv + nc
    return {'area': area, 'mtime': os.path.getmtime(f), 'killed': k, 'timeout': to, 'survived': sv, 'noCoverage': nc,
            'score': round((k + to) / den * 100, 1) if den else None}


def _rkey(t):
    return (t['kind'] if t['kind'] != 'uistab' else 'e2e', t['project'], os.path.basename(t['file'] or ''),
            re.sub(r'\s+', ' ', t['name']).strip())


def apply_rerun(tests, rerun_tests):
    """Attach the rerun result to failed/flaky tests. Failed in the run + passed in the rerun = flaky."""
    idx = {}
    for r in rerun_tests:
        idx[_rkey(r)] = r
        idx[('name', r['project'], re.sub(r'\s+', ' ', r['name']).strip())] = r
    for t in tests:
        if t['status'] not in ('failed', 'flaky'):
            continue
        r = idx.get(_rkey(t)) or idx.get(('name', t['project'], re.sub(r'\s+', ' ', t['name']).strip()))
        if r:
            t['rerun'] = r['status']
            if t['status'] == 'failed' and r['status'] == 'passed':
                t['flakyByRerun'] = True


# ── aggregation ───────────────────────────────────────────────────────────

def rerun_pass(model, kind, name):
    return sum(1 for t in model['tests'] if t['kind'] == kind and (t['project'] or t['suite']) == name and t.get('flakyByRerun'))


def pass_rate(s):
    run = s['total'] - s['skipped']
    return round((s['passed'] + s['flaky']) / run * 100, 2) if run > 0 else None


def totals(suites, name):
    t = {'kind': '', 'name': name, 'total': 0, 'passed': 0, 'failed': 0, 'skipped': 0, 'flaky': 0, 'durationMs': 0}
    for s in suites:
        for k in ('total', 'passed', 'failed', 'skipped', 'flaky'):
            t[k] += s[k] or 0
        t['durationMs'] += s['durationMs'] or 0
    t['status'] = 'failed' if t['failed'] or any(s['status'] == 'failed' for s in suites) else ('passed' if t['total'] else 'notRun')
    return t


def verdict(model):
    bad = [s for s in model['suites'] if s['status'] == 'failed'] + [g for g in model['gate'] if g['status'] == 'failed']
    return 'failed' if bad else 'passed'


def secs(ms):
    return round(ms / 1000, 1) if ms else None


# ── workbook ──────────────────────────────────────────────────────────────

SUITE_COL_KEYS = ('kind', 'suite', 'total', 'passed', 'failed', 'skipped', 'flaky', 'rerun_passed', 'seconds', 'pass_rate', 'result', 'input')
SUITE_W = [10, 30, 10, 10, 10, 10, 10, 12, 14, 12, 10, 50]


def build_xlsx(model, out):
    SUITE_COLS = [T('col.' + k) for k in SUITE_COL_KEYS]
    Workbook, FormulaRule, Alignment, Border, Font, PatternFill, Side, col = _openpyxl()
    HEAD = PatternFill('solid', fgColor='D9E2F3')
    TOTAL = PatternFill('solid', fgColor='F2F2F2')
    PASS = PatternFill('solid', fgColor='C6EFCE')
    FAIL = PatternFill('solid', fgColor='FFC7CE')
    WARN = PatternFill('solid', fgColor='FFEB9C')
    thin = Side(style='thin', color='BFBFBF')
    BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
    WRAP = Alignment(wrap_text=True, vertical='top')

    def header(ws, row, titles, widths):
        for j, h in enumerate(titles, 1):
            c = ws.cell(row=row, column=j, value=h)
            c.font, c.fill, c.border = Font(bold=True), HEAD, BORDER
            c.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
            ws.column_dimensions[col(j)].width = widths[j - 1]

    def table(ws, titles, widths, rows, status_cols=(), row0=1, freeze=True, total_last=False):
        header(ws, row0, titles, widths)
        for i, r in enumerate(rows, row0 + 1):
            for j, v in enumerate(r, 1):
                c = ws.cell(row=i, column=j, value=v)
                c.border, c.alignment = BORDER, WRAP
            if total_last and i == row0 + len(rows):
                for j in range(1, len(titles) + 1):
                    ws.cell(row=i, column=j).font = Font(bold=True)
                    ws.cell(row=i, column=j).fill = TOTAL
        last = row0 + max(len(rows), 1)
        if freeze:
            ws.freeze_panes = ws.cell(row=row0 + 1, column=1)
            ws.auto_filter.ref = 'A%d:%s%d' % (row0, col(len(titles)), last)
        for c in status_cols:
            L_ = col(c)
            first = '%s%d' % (L_, row0 + 1)
            for word, fill in ((T('status.passed'), PASS), (T('status.failed'), FAIL), (T('status.flaky'), WARN)):
                ws.conditional_formatting.add('%s%d:%s%d' % (L_, row0 + 1, L_, last),
                                              FormulaRule(formula=['ISNUMBER(SEARCH("%s",%s))' % (word, first)], fill=fill, stopIfTrue=True))
        return last + 2

    def count_fill(ws, c, r1, r2, fill):
        L_ = col(c)
        ws.conditional_formatting.add('%s%d:%s%d' % (L_, r1, L_, r2), FormulaRule(formula=['%s%d>0' % (L_, r1)], fill=fill))

    def suite_row(s):
        return [KIND_KO.get(s['kind'], s['kind']), s['name'], s['total'], s['passed'], s['failed'], s['skipped'], s['flaky'],
                rerun_pass(model, s['kind'], s['name']) if s['kind'] else sum(1 for t in model['tests'] if t.get('flakyByRerun')),
                secs(s['durationMs']), pass_rate(s), STATUS_KO.get(s['status'], s['status']), s.get('source', '')]

    def suite_sheet(book, title, kinds):
        suites = [s for s in model['suites'] if s['kind'] in kinds]
        if not suites:
            return
        ws = book.create_sheet(title)
        rows = [suite_row(s) for s in sorted(suites, key=lambda s: (s['status'] != 'failed', s['name']))]
        tot = totals(suites, T('sum.total'))
        rows.append([T('sum.total'), T('sum.n_suites', n=len(suites))] + suite_row(tot)[2:7] + [sum(r[7] or 0 for r in rows)] + suite_row(tot)[8:11] + [''])
        last = table(ws, SUITE_COLS, SUITE_W, rows, status_cols=(11,), total_last=True)
        count_fill(ws, 5, 2, last - 2, FAIL)
        count_fill(ws, 7, 2, last - 2, WARN)

    book = Workbook()
    ws = book.active
    ws.title = T('sheet.summary')
    m = model['meta']
    ws['A1'] = T('sum.title', name=m.get('name', ''))
    ws['A1'].font = Font(bold=True, size=14)
    ws.merge_cells('A1:L1')
    v = verdict(model)
    failed_n = sum(1 for t in model['tests'] if t['status'] == 'failed')
    gate_failed = sum(g['status'] == 'failed' for g in model['gate'])
    meta_rows = [
        (T('sum.verdict'), STATUS_KO[v] + (T('sum.verdict_detail', tests=failed_n, gate=gate_failed) if v == 'failed' else '')),
        (T('sum.started'), m.get('startedAt', '')), (T('sum.finished'), m.get('finishedAt', '')), (T('sum.generated'), m.get('generatedAt', '')),
        (T('sum.commit'), m.get('commit', '')), (T('sum.branch'), m.get('branch', '')), (T('sum.host'), m.get('host', '')),
        (T('sum.load'), m.get('load', '')), (T('sum.workers'), m.get('workers', '')),
        (T('sum.ledger_ref'), m.get('ledgerRef', T('sum.worktree')) if m.get('ledgerCases') is not None else ''), (T('sum.note'), m.get('note', '')),
        (T('sum.inputs'), '\n'.join(dict.fromkeys(m.get('sources', [])))),
    ]
    for i, (k, val) in enumerate(meta_rows, 3):
        a = ws.cell(row=i, column=1, value=k)
        a.font, a.fill, a.border = Font(bold=True), HEAD, BORDER
        b = ws.cell(row=i, column=2, value=str(val) if val is not None else '')
        b.alignment, b.border = WRAP, BORDER
        ws.merge_cells(start_row=i, start_column=2, end_row=i, end_column=11)
    ws.row_dimensions[3 + len(meta_rows) - 1].height = 15 * max(1, len(dict.fromkeys(m.get('sources', []))))
    vcell = ws.cell(row=3, column=2)
    vcell.fill = PASS if v == 'passed' else FAIL
    vcell.font = Font(bold=True)

    r0 = 3 + len(meta_rows) + 1
    ws.cell(row=r0, column=1, value=T('sum.by_suite')).font = Font(bold=True, size=12)
    rows = []
    for kind in ('unit', 'integration', 'e2e', 'uistab'):
        ss = [s for s in model['suites'] if s['kind'] == kind]
        if not ss:
            continue
        t = totals(ss, T('sum.groups', n=len(ss)))
        t['kind'] = kind
        row = suite_row(t)
        row[7] = sum(rerun_pass(model, kind, s['name']) for s in ss)
        row[11] = ''
        rows.append(row)
    if model['gate']:
        g = model['gate']
        gp, gf = sum(x['status'] == 'passed' for x in g), sum(x['status'] == 'failed' for x in g)
        gn = sum(x['status'] in ('notRun', 'skipped') for x in g)
        rows.append(['gate', T('sum.steps', n=len(g)), len(g), gp, gf, gn, 0, 0, secs(sum(x['durationMs'] or 0 for x in g)),
                     round(gp / (len(g) - gn) * 100, 2) if len(g) - gn else None, T('status.failed') if gf else T('status.passed'), T('sum.gate_note')])
    if rows:
        t = totals(model['suites'], T('sum.total_all'))
        trow = [T('sum.total')] + suite_row(t)[1:11] + ['']
        trow[7] = sum(r[7] or 0 for r in rows if r[0] != 'gate')
        rows.append(trow)
        last = table(ws, SUITE_COLS, SUITE_W, rows, status_cols=(11,), row0=r0 + 1, freeze=False, total_last=True)
        count_fill(ws, 5, r0 + 2, last - 2, FAIL)
    else:
        last = r0 + 2
    notes = [
        T('sum.note_rate'),
        T('sum.note_rerun', sheet=T('sheet.flaky')),
        T('sum.note_ledger', n=len(model['ledger']), sheet=T('sheet.ledger')) if m.get('ledgerCompared') else '',
    ]
    for i, n in enumerate([n for n in notes if n], last):
        ws.cell(row=i, column=1, value=n)
        ws.merge_cells(start_row=i, start_column=1, end_row=i, end_column=12)
    ws.column_dimensions['A'].width = 18

    for kind in ('unit', 'integration', 'e2e'):
        suite_sheet(book, T('sheet.' + kind), (kind,))

    e2e = [t for t in model['tests'] if t['kind'] in ('e2e', 'uistab')]
    if e2e:
        w = book.create_sheet(T('sheet.e2e_detail'))
        rows = [[KIND_KO[t['kind']], t['project'], '%s:%s' % (t['file'], t['line']) if t['line'] else t['file'],
                 ' · '.join(t.get('caseIds') or []), t['name'], STATUS_KO.get(t['status'], t['status']),
                 ' → '.join(STATUS_KO.get(a, a) for a in t['attempts']), STATUS_KO.get(t['rerun'], t['rerun']),
                 secs(t['durationMs']), t['error']] for t in e2e]
        table(w, [T('col.' + k) for k in ('kind', 'project', 'file_line', 'case_id', 'test_name', 'result', 'attempts', 'rerun_result', 'seconds', 'error')],
              [10, 12, 34, 16, 70, 10, 18, 12, 12, 60], rows, status_cols=(6, 8))
    suite_sheet(book, T('sheet.uistab'), ('uistab',))

    if model['gate']:
        w = book.create_sheet(T('sheet.gate'))
        rows = [[i, g['step'], g['cmd'], STATUS_KO.get(g['status'], g['status']), g['exit'], secs(g['durationMs']), g['detail'], g['log']]
                for i, g in enumerate(model['gate'], 1)]
        table(w, [T('col.' + k) for k in ('order', 'step', 'command', 'result', 'exit_code', 'seconds', 'fail_detail', 'log')],
              [6, 22, 34, 10, 10, 12, 70, 50], rows, status_cols=(4,))

    w = book.create_sheet(T('sheet.failures'))
    fails = [t for t in model['tests'] if t['status'] == 'failed']
    rows = [[KIND_KO.get(t['kind'], t['kind']), t['project'] or t['suite'], t['name'],
             '%s:%s' % (t['file'], t['line']) if t['line'] else t['file'], t['error'], t['log'],
             STATUS_KO.get(t['rerun'], t['rerun']) or T('fail.no_rerun')] for t in fails]
    rows += [['gate', g['step'], g['cmd'], '', g['detail'], g['log'], ''] for g in model['gate'] if g['status'] == 'failed']
    rows += [[KIND_KO.get(s['kind'], s['kind']), s['name'], T('fail.suite_failed'), '', '', s.get('source', ''), '']
             for s in model['suites'] if s['status'] == 'failed' and not any(
                 (t['project'] or t['suite']) == s['name'] and t['kind'] == s['kind'] and t['status'] == 'failed' for t in model['tests'])]
    if rows:
        table(w, [T('col.' + k) for k in ('kind', 'suite_project', 'test_name', 'file_line', 'error', 'log', 'rerun_result')],
              [10, 20, 70, 40, 70, 50, 14], rows, status_cols=(7,))
    else:
        w['A1'] = T('fail.none')

    w = book.create_sheet(T('sheet.flaky'))
    fl = [t for t in model['tests'] if t['status'] == 'flaky' or t.get('flakyByRerun')]
    rows = [[KIND_KO.get(t['kind'], t['kind']), t['project'] or t['suite'], t['name'],
             '%s:%s' % (t['file'], t['line']) if t['line'] else t['file'],
             T('flaky.same_run') if t['status'] == 'flaky' else T('flaky.separate'),
             ' → '.join(STATUS_KO.get(a, a) for a in t['attempts']) if t['status'] == 'flaky'
             else T('flaky.rerun_result', result=STATUS_KO.get(t['rerun'], t['rerun'])), t['error']] for t in fl]
    if rows:
        table(w, [T('col.' + k) for k in ('kind', 'suite_project', 'test_name', 'file_line', 'basis', 'attempt_results', 'error')],
              [10, 18, 70, 40, 18, 30, 60], rows)
    else:
        w['A1'] = T('flaky.none', rerun=T('flaky.rerun_given') if m.get('rerunSources') else T('flaky.rerun_absent'))

    if m.get('ledgerCompared'):
        w = book.create_sheet(T('sheet.ledger'))
        if model['ledger']:
            rows = [[r['kind'], r['caseId'], r['priority'], r['module'], r['ledger'], STATUS_KO.get(r['actual'], r['actual']),
                     r['detail'], r['scenario']] for r in model['ledger']]
            table(w, [T('col.' + k) for k in ('mismatch', 'case_id', 'priority', 'module', 'ledger_status', 'actual', 'per_project', 'scenario')],
                  [34, 18, 9, 10, 12, 10, 34, 70], rows, status_cols=(6,))
        else:
            w['A1'] = T('ledger.none', n=m.get('ledgerCases', 0))

    if model['coverage']:
        w = book.create_sheet(T('sheet.coverage'))
        pct = lambda x: x.get('pct') if isinstance(x, dict) else None  # noqa: E731
        rows = [[c['area'], pct(c['lines']), pct(c['statements']), pct(c['branches']), pct(c['functions']),
                 (c['lines'] or {}).get('total'), dt.datetime.fromtimestamp(c['mtime']).strftime('%Y-%m-%d %H:%M')] for c in model['coverage']]
        table(w, [T('col.' + k) for k in ('area', 'lines', 'statements', 'branches', 'functions', 'code_lines', 'measured_at')], [30, 10, 10, 10, 10, 12, 18], rows)
    if model['mutation']:
        w = book.create_sheet(T('sheet.mutation'))
        rows = [[x['area'], x['score'], x['killed'], x['timeout'], x['survived'], x['noCoverage'],
                 dt.datetime.fromtimestamp(x['mtime']).strftime('%Y-%m-%d %H:%M')] for x in model['mutation']]
        table(w, [T('col.' + k) for k in ('area', 'score', 'killed', 'timeout', 'survived', 'no_coverage', 'measured_at')], [30, 12, 10, 10, 10, 10, 18], rows)

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    book.save(out)


def summary_json(model):
    """The committed summary: failures and flaky tests only (passed e2e rows keep result + case id)."""
    keep = [t for t in model['tests'] if t['status'] in ('failed', 'flaky') or t.get('flakyByRerun')]
    e2e = [{'project': t['project'], 'file': t['file'], 'line': t['line'], 'caseId': t['caseId'], 'status': t['status']}
           for t in model['tests'] if t['kind'] in ('e2e', 'uistab')]
    return {'meta': model['meta'], 'verdict': verdict(model), 'suites': model['suites'], 'gate': model['gate'],
            'failures': keep, 'e2eResults': e2e, 'ledger': model['ledger'], 'coverage': model['coverage'], 'mutation': model['mutation']}


def started_local(model):
    """Run start time in the machine's local time zone (TZ). startedAt is ISO 8601, often UTC ('...Z')."""
    raw = str(model['meta'].get('startedAt') or '')
    try:
        t = dt.datetime.fromisoformat(raw[:-1] + '+00:00' if raw.endswith('Z') else raw)
    except ValueError:
        return dt.datetime.now()
    return t.astimezone() if t.tzinfo else t


def default_out(model, repo):
    now = started_local(model)
    name = re.sub(r'[^\w.-]+', '-', model['meta'].get('name') or 'run').strip('-')
    return os.path.join(repo, 'docs', 'test-results', now.strftime('%Y-%m-%d'), '%s-%s.xlsx' % (name, now.strftime('%H%M')))


def expand_template(tpl, model, repo):
    now = started_local(model)
    name = re.sub(r'[^\w.-]+', '-', model['meta'].get('name') or 'run').strip('-')
    vars_ = {'date': now.strftime('%Y-%m-%d'), 'HHMM': now.strftime('%H%M'), 'name': name, 'stamp': now.strftime('%Y%m%d-%H%M')}
    return os.path.join(repo, re.sub(r'\{(\w+)\}', lambda m: vars_.get(m.group(1), m.group(0)), tpl))


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description='test results -> xlsx + summary json')
    ap.add_argument('--results-dir')
    ap.add_argument('--runs-dir', default=None, help='where to look for the newest results folder (default <repo>/test-results/runs)')
    ap.add_argument('--name', default='')
    ap.add_argument('--out')
    ap.add_argument('--out-template', help='path template relative to --repo with {date} {name} {HHMM}, used when --out is not given')
    ap.add_argument('--repo', default=os.getcwd())
    ap.add_argument('--cases-dir', default=None)
    ap.add_argument('--cases-ref')
    ap.add_argument('--ledger-priority')
    for k in ('input', 'gate-json', 'gate-log', 'rerun', 'meta', 'coverage', 'mutation'):
        ap.add_argument('--' + k, action='append')
    ap.add_argument('--commit')
    ap.add_argument('--branch')
    ap.add_argument('--started')
    ap.add_argument('--lang', choices=('ko', 'en'), default='ko', help='language of the sheet names, headers, notes and the result line printed at the end')
    a = ap.parse_args(argv)
    set_lang(a.lang)
    a.repo = os.path.abspath(a.repo)
    a.cases_dir = a.cases_dir or os.path.join(a.repo, 'docs', 'e2e')
    a.runs_dir = a.runs_dir or os.path.join(a.repo, 'test-results', 'runs')
    return a


def main(argv=None):
    args = parse_args(argv)
    model = build_model(args)
    out = args.out or (expand_template(args.out_template, model, args.repo) if args.out_template else default_out(model, args.repo))
    build_xlsx(model, out)
    with open(out.rsplit('.', 1)[0] + '.json', 'w', encoding='utf-8') as f:
        json.dump(summary_json(model), f, ensure_ascii=False, indent=1, default=str)
    counts = (len(model['suites']), len(model['gate']),
              sum(t['status'] == 'failed' for t in model['tests']),
              sum(1 for t in model['tests'] if t['status'] == 'flaky' or t.get('flakyByRerun')),
              len(model['ledger']), len(model['tests']))
    print(T('line', out=out, verdict=T('line.verdict.' + verdict(model)), suites=counts[0], gate=counts[1], failed=counts[2],
            flaky=counts[3], ledger=counts[4], rows=counts[5]))
    return out


if __name__ == '__main__':
    main()
