"""Build one full workbook from the synthetic fixtures and dump it to plain data (for the language tests)."""
import os
import re
import subprocess
import sys
import tempfile

import fixtures as F

SCRIPT = os.path.join(F.CORE, 'build_xlsx.py')
VOLATILE_LABELS = {'보고서 생성', 'Report generated', '호스트', 'Host', '부하(1·5·15분 평균)', 'Load (1/5/15 min avg)',
                   '커밋', 'Commit', '브랜치', 'Branch', '워커 수', 'Workers'}


def build_full(lang=None, env=None):
    """Returns (xlsx path, stdout line, temp dir). Every input kind is used so every sheet exists."""
    import openpyxl  # noqa: F401
    d = tempfile.mkdtemp()
    p = lambda n: os.path.join(d, n)  # noqa: E731
    F.write(p('v.json'), F.VITEST_JSON)
    F.write(p('pw.json'), F.PLAYWRIGHT_JSON)
    F.write(p('junit.xml'), F.JUNIT)
    F.write(p('gate.json'), F.GATE_JSON)
    F.write(p('docs/e2e/pay.cases.json'), F.LEDGER)
    F.write(p('cov.json'), {'total': {'lines': {'pct': 81.5, 'total': 100}, 'statements': {'pct': 80}, 'branches': {'pct': 70}, 'functions': {'pct': 90}}})
    F.write(p('mut.json'), {'files': {'a.js': {'mutants': [{'status': 'Killed'}, {'status': 'Survived'}, {'status': 'Timeout'}]}}})
    F.write(p('uis.json'), F.PLAYWRIGHT_JSON)
    rerun = {'suites': [{'title': 'specs/cart.spec.ts', 'file': 'specs/cart.spec.ts', 'specs': [
        {'title': 'PAY-002 · 003 refund', 'file': 'specs/cart.spec.ts', 'line': 30, 'tests': [
            {'projectName': 'chromium', 'status': 'expected', 'results': [{'status': 'passed', 'duration': 5}]}]}]}]}
    F.write(p('rerun.json'), rerun)
    out = p('out/r.xlsx')
    cmd = [sys.executable, SCRIPT, '--repo', d, '--name', 'itest', '--out', out, '--started', '2026-03-04T05:06:00',
           '--input', 'vitest:unit:web=' + p('v.json'), '--input', 'pytest:integration:svc=' + p('junit.xml'),
           '--input', 'playwright:e2e:main=' + p('pw.json'), '--input', 'playwright:uistab:ui=' + p('uis.json'),
           '--gate-json', p('gate.json'), '--ledger-priority', 'P0', '--rerun', 'playwright=' + p('rerun.json'),
           '--coverage', 'web=' + p('cov.json'), '--mutation', 'web=' + p('mut.json')]
    if lang:
        cmd += ['--lang', lang]
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    return out, r.stdout, d


def dump(out, tmp):
    import openpyxl
    book = openpyxl.load_workbook(out)
    res = {'sheets': book.sheetnames, 'data': {}}
    for ws in book.worksheets:
        cells, labels = {}, {}
        for row in ws.iter_rows():
            for c in row:
                if c.value is None:
                    continue
                v = c.value.replace(tmp, '<TMP>') if isinstance(c.value, str) else c.value
                cells[c.coordinate] = v
        # volatile summary rows: blank their value cell
        for coord, v in list(cells.items()):
            if coord.startswith('A') and v in VOLATILE_LABELS:
                cells.pop('B' + coord[1:], None)
        # coverage / mutation measured-at column varies
        if ws.title in ('커버리지', '변이', 'Coverage', 'Mutation'):
            cells = {k: v for k, v in cells.items() if not re.match(r'[GH]\d+$', k) or k.endswith('1')}
        res['data'][ws.title] = {
            'cells': cells,
            'widths': {k: round(v.width, 2) for k, v in ws.column_dimensions.items()},
            'merged': sorted(str(m) for m in ws.merged_cells.ranges),
            'cf': sorted(str(rng.sqref) + '|' + '|'.join(r.formula[0] for r in rules) for rng, rules in ws.conditional_formatting._cf_rules.items()),
        }
    return res
