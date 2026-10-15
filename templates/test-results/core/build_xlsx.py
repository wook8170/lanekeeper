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

STATUS_KO = {'passed': '통과', 'failed': '실패', 'skipped': '건너뜀', 'flaky': '간헐', 'notRun': '미실행',
             'timedOut': '시간 초과', 'interrupted': '중단', '': ''}
KIND_KO = {'unit': '단위', 'integration': '통합 DB', 'e2e': 'e2e', 'uistab': 'UI 안정성', 'gate': 'gate'}
SHEET_OF = {'unit': '단위', 'integration': '통합 DB', 'e2e': 'e2e'}


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

SUITE_COLS = ['구분', '스위트', '총계', '통과', '실패', '건너뜀', '간헐', '재실행 통과', '소요 시간(초)', '통과율(%)', '결과', '입력']
SUITE_W = [10, 30, 10, 10, 10, 10, 10, 12, 14, 12, 10, 50]


def build_xlsx(model, out):
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
            for word, fill in (('통과', PASS), ('실패', FAIL), ('간헐', WARN)):
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

    def suite_sheet(wb, title, kinds):
        suites = [s for s in model['suites'] if s['kind'] in kinds]
        if not suites:
            return
        ws = wb.create_sheet(title)
        rows = [suite_row(s) for s in sorted(suites, key=lambda s: (s['status'] != 'failed', s['name']))]
        tot = totals(suites, '합계')
        rows.append(['합계', '%d개' % len(suites)] + suite_row(tot)[2:7] + [sum(r[7] or 0 for r in rows)] + suite_row(tot)[8:11] + [''])
        last = table(ws, SUITE_COLS, SUITE_W, rows, status_cols=(11,), total_last=True)
        count_fill(ws, 5, 2, last - 2, FAIL)
        count_fill(ws, 7, 2, last - 2, WARN)

    wb = Workbook()
    ws = wb.active
    ws.title = '요약'
    m = model['meta']
    ws['A1'] = '시험 결과 — %s' % m.get('name', '')
    ws['A1'].font = Font(bold=True, size=14)
    ws.merge_cells('A1:L1')
    v = verdict(model)
    failed_n = sum(1 for t in model['tests'] if t['status'] == 'failed')
    gate_failed = sum(g['status'] == 'failed' for g in model['gate'])
    meta_rows = [
        ('종합 판정', STATUS_KO[v] + (' (실패 시험 %d건 · gate 실패 단계 %d건)' % (failed_n, gate_failed) if v == 'failed' else '')),
        ('실행 시각', m.get('startedAt', '')), ('종료 시각', m.get('finishedAt', '')), ('보고서 생성', m.get('generatedAt', '')),
        ('커밋', m.get('commit', '')), ('브랜치', m.get('branch', '')), ('호스트', m.get('host', '')),
        ('부하(1·5·15분 평균)', m.get('load', '')), ('워커 수', m.get('workers', '')),
        ('원장 기준', m.get('ledgerRef', '작업 트리') if m.get('ledgerCases') is not None else ''), ('비고', m.get('note', '')),
        ('입력', '\n'.join(dict.fromkeys(m.get('sources', [])))),
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
    ws.cell(row=r0, column=1, value='스위트별 결과').font = Font(bold=True, size=12)
    rows = []
    for kind in ('unit', 'integration', 'e2e', 'uistab'):
        ss = [s for s in model['suites'] if s['kind'] == kind]
        if not ss:
            continue
        t = totals(ss, '%d개 묶음' % len(ss))
        t['kind'] = kind
        row = suite_row(t)
        row[7] = sum(rerun_pass(model, kind, s['name']) for s in ss)
        row[11] = ''
        rows.append(row)
    if model['gate']:
        g = model['gate']
        gp, gf = sum(x['status'] == 'passed' for x in g), sum(x['status'] == 'failed' for x in g)
        gn = sum(x['status'] in ('notRun', 'skipped') for x in g)
        rows.append(['gate', '%d단계' % len(g), len(g), gp, gf, gn, 0, 0, secs(sum(x['durationMs'] or 0 for x in g)),
                     round(gp / (len(g) - gn) * 100, 2) if len(g) - gn else None, '실패' if gf else '통과', '건너뜀 열 = 미실행 · 건너뛴 단계'])
    if rows:
        t = totals(model['suites'], '전체 시험(gate 제외)')
        trow = ['합계'] + suite_row(t)[1:11] + ['']
        trow[7] = sum(r[7] or 0 for r in rows if r[0] != 'gate')
        rows.append(trow)
        last = table(ws, SUITE_COLS, SUITE_W, rows, status_cols=(11,), row0=r0 + 1, freeze=False, total_last=True)
        count_fill(ws, 5, r0 + 2, last - 2, FAIL)
    else:
        last = r0 + 2
    notes = [
        '통과율 = (통과 + 간헐) ÷ (총계 − 건너뜀). 간헐 = 같은 실행 안의 재시도에서 통과한 시험.',
        '재실행 통과 = 본 실행에서 실패했고 별도 재실행에서 통과한 시험(실패 수에 포함된다). 상세는 「간헐 실패」 시트.',
        ('e2e 원장 대조 불일치 %d건 — 「원장 대조」 시트.' % len(model['ledger'])) if m.get('ledgerCompared') else '',
    ]
    for i, n in enumerate([n for n in notes if n], last):
        ws.cell(row=i, column=1, value=n)
        ws.merge_cells(start_row=i, start_column=1, end_row=i, end_column=12)
    ws.column_dimensions['A'].width = 18

    for kind in ('unit', 'integration', 'e2e'):
        suite_sheet(wb, SHEET_OF[kind], (kind,))

    e2e = [t for t in model['tests'] if t['kind'] in ('e2e', 'uistab')]
    if e2e:
        w = wb.create_sheet('e2e 상세')
        rows = [[KIND_KO[t['kind']], t['project'], '%s:%s' % (t['file'], t['line']) if t['line'] else t['file'],
                 ' · '.join(t.get('caseIds') or []), t['name'], STATUS_KO.get(t['status'], t['status']),
                 ' → '.join(STATUS_KO.get(a, a) for a in t['attempts']), STATUS_KO.get(t['rerun'], t['rerun']),
                 secs(t['durationMs']), t['error']] for t in e2e]
        table(w, ['구분', '프로젝트', '파일:줄', '케이스 ID', '시험명', '결과', '시도', '재실행 결과', '소요 시간(초)', '오류 첫 줄'],
              [10, 12, 34, 16, 70, 10, 18, 12, 12, 60], rows, status_cols=(6, 8))
    suite_sheet(wb, 'UI 안정성', ('uistab',))

    if model['gate']:
        w = wb.create_sheet('gate 단계')
        rows = [[i, g['step'], g['cmd'], STATUS_KO.get(g['status'], g['status']), g['exit'], secs(g['durationMs']), g['detail'], g['log']]
                for i, g in enumerate(model['gate'], 1)]
        table(w, ['순서', '단계', '명령', '결과', '종료 코드', '소요 시간(초)', '실패 상세', '로그 위치'],
              [6, 22, 34, 10, 10, 12, 70, 50], rows, status_cols=(4,))

    w = wb.create_sheet('실패 목록')
    fails = [t for t in model['tests'] if t['status'] == 'failed']
    rows = [[KIND_KO.get(t['kind'], t['kind']), t['project'] or t['suite'], t['name'],
             '%s:%s' % (t['file'], t['line']) if t['line'] else t['file'], t['error'], t['log'],
             STATUS_KO.get(t['rerun'], t['rerun']) or '재실행 없음'] for t in fails]
    rows += [['gate', g['step'], g['cmd'], '', g['detail'], g['log'], ''] for g in model['gate'] if g['status'] == 'failed']
    rows += [[KIND_KO.get(s['kind'], s['kind']), s['name'], '(스위트 전체 실패 — 시험 목록 없음)', '', '', s.get('source', ''), '']
             for s in model['suites'] if s['status'] == 'failed' and not any(
                 (t['project'] or t['suite']) == s['name'] and t['kind'] == s['kind'] and t['status'] == 'failed' for t in model['tests'])]
    if rows:
        table(w, ['구분', '스위트·프로젝트', '시험명', '파일:줄', '오류 첫 줄', '로그 위치', '재실행 결과'],
              [10, 20, 70, 40, 70, 50, 14], rows, status_cols=(7,))
    else:
        w['A1'] = '실패한 시험이 없다.'

    w = wb.create_sheet('간헐 실패')
    fl = [t for t in model['tests'] if t['status'] == 'flaky' or t.get('flakyByRerun')]
    rows = [[KIND_KO.get(t['kind'], t['kind']), t['project'] or t['suite'], t['name'],
             '%s:%s' % (t['file'], t['line']) if t['line'] else t['file'],
             '같은 실행 안 재시도' if t['status'] == 'flaky' else '별도 재실행',
             ' → '.join(STATUS_KO.get(a, a) for a in t['attempts']) if t['status'] == 'flaky'
             else '본 실행 실패 → 재실행 %s' % STATUS_KO.get(t['rerun'], t['rerun']), t['error']] for t in fl]
    if rows:
        table(w, ['구분', '스위트·프로젝트', '시험명', '파일:줄', '판정 근거', '시도 결과', '오류 첫 줄'],
              [10, 18, 70, 40, 18, 30, 60], rows)
    else:
        w['A1'] = '간헐 실패로 판정된 시험이 없다(%s).' % ('재실행 입력 있음' if m.get('rerunSources') else '재실행 입력 없음')

    if m.get('ledgerCompared'):
        w = wb.create_sheet('원장 대조')
        if model['ledger']:
            rows = [[r['kind'], r['caseId'], r['priority'], r['module'], r['ledger'], STATUS_KO.get(r['actual'], r['actual']),
                     r['detail'], r['scenario']] for r in model['ledger']]
            table(w, ['불일치 종류', '케이스 ID', '우선순위', '모듈', '원장 상태', '실제 결과', '프로젝트별 결과', '시나리오'],
                  [34, 18, 9, 10, 12, 10, 34, 70], rows, status_cols=(6,))
        else:
            w['A1'] = '원장(케이스 %d건)과 실행 결과가 어긋난 케이스가 없다.' % m.get('ledgerCases', 0)

    if model['coverage']:
        w = wb.create_sheet('커버리지')
        pct = lambda x: x.get('pct') if isinstance(x, dict) else None  # noqa: E731
        rows = [[c['area'], pct(c['lines']), pct(c['statements']), pct(c['branches']), pct(c['functions']),
                 (c['lines'] or {}).get('total'), dt.datetime.fromtimestamp(c['mtime']).strftime('%Y-%m-%d %H:%M')] for c in model['coverage']]
        table(w, ['영역', '줄(%)', '문장(%)', '분기(%)', '함수(%)', '코드 줄 수', '측정 시각'], [30, 10, 10, 10, 10, 12, 18], rows)
    if model['mutation']:
        w = wb.create_sheet('변이')
        rows = [[x['area'], x['score'], x['killed'], x['timeout'], x['survived'], x['noCoverage'],
                 dt.datetime.fromtimestamp(x['mtime']).strftime('%Y-%m-%d %H:%M')] for x in model['mutation']]
        table(w, ['영역', '변이 점수(%)', '잡힘', '시간 초과', '살아남음', '시험 없음', '측정 시각'], [30, 12, 10, 10, 10, 10, 18], rows)

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    wb.save(out)


def summary_json(model):
    """The committed summary: failures and flaky tests only (passed e2e rows keep result + case id)."""
    keep = [t for t in model['tests'] if t['status'] in ('failed', 'flaky') or t.get('flakyByRerun')]
    e2e = [{'project': t['project'], 'file': t['file'], 'line': t['line'], 'caseId': t['caseId'], 'status': t['status']}
           for t in model['tests'] if t['kind'] in ('e2e', 'uistab')]
    return {'meta': model['meta'], 'verdict': verdict(model), 'suites': model['suites'], 'gate': model['gate'],
            'failures': keep, 'e2eResults': e2e, 'ledger': model['ledger'], 'coverage': model['coverage'], 'mutation': model['mutation']}


def default_out(model, repo):
    now = dt.datetime.now()
    try:
        now = dt.datetime.fromisoformat(str(model['meta'].get('startedAt')))
    except ValueError:
        pass
    name = re.sub(r'[^\w.-]+', '-', model['meta'].get('name') or 'run').strip('-')
    return os.path.join(repo, 'docs', 'test-results', now.strftime('%Y-%m-%d'), '%s-%s.xlsx' % (name, now.strftime('%H%M')))


def expand_template(tpl, model, repo):
    now = dt.datetime.now()
    try:
        now = dt.datetime.fromisoformat(str(model['meta'].get('startedAt')))
    except ValueError:
        pass
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
    a = ap.parse_args(argv)
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
    print('%s: 판정 %s · 스위트 %d · gate %d단계 · 실패 %d · 간헐 %d · 원장 불일치 %d · 시험 행 %d' % (
        out, STATUS_KO[verdict(model)], len(model['suites']), len(model['gate']),
        sum(t['status'] == 'failed' for t in model['tests']),
        sum(1 for t in model['tests'] if t['status'] == 'flaky' or t.get('flakyByRerun')),
        len(model['ledger']), len(model['tests'])))
    return out


if __name__ == '__main__':
    main()
