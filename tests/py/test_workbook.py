import json
import os
import subprocess
import sys
import tempfile
import unittest

import fixtures as F
import build_xlsx as B

try:
    import openpyxl
except ImportError:  # the node wrapper skips these tests with an install hint
    openpyxl = None

SCRIPT = os.path.join(F.CORE, 'build_xlsx.py')


@unittest.skipIf(openpyxl is None, 'openpyxl is not installed (python3 -m pip install openpyxl)')
class Workbook(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.p = lambda n: os.path.join(self.dir, n)
        F.write(self.p('v.json'), F.VITEST_JSON)
        F.write(self.p('pw.json'), F.PLAYWRIGHT_JSON)
        F.write(self.p('junit.xml'), F.JUNIT)
        F.write(self.p('gate.json'), F.GATE_JSON)
        F.write(self.p('docs/e2e/pay.cases.json'), F.LEDGER)

    def run_build(self, *extra):
        out = self.p('out/r.xlsx')
        r = subprocess.run([sys.executable, SCRIPT, '--repo', self.dir, '--name', 'itest', '--out', out, *extra],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return out, r.stdout

    def sheets(self, out):
        return openpyxl.load_workbook(out).sheetnames

    def test_all_adapters_make_the_expected_sheets(self):
        out, line = self.run_build('--input', 'vitest:unit:web=' + self.p('v.json'),
                                   '--input', 'pytest:integration:svc=' + self.p('junit.xml'),
                                   '--input', 'playwright:e2e:main=' + self.p('pw.json'),
                                   '--gate-json', self.p('gate.json'), '--ledger-priority', 'P0')
        self.assertEqual(self.sheets(out), ['요약', '단위', '통합 DB', 'e2e', 'e2e 상세', 'gate 단계', '실패 목록', '간헐 실패', '원장 대조'])
        self.assertIn('판정 실패', line)
        wb = openpyxl.load_workbook(out)
        ws = wb['요약']
        self.assertEqual(ws['A3'].value, '종합 판정')
        self.assertTrue(ws['B3'].value.startswith('실패'))
        fails = [r[2].value for r in wb['실패 목록'].iter_rows(min_row=2)]
        self.assertIn('cart > totals', fails)
        self.assertIn('PAY-002 · 003 refund', fails)
        self.assertIn('npm run typecheck', fails)
        flaky = [r[2].value for r in wb['간헐 실패'].iter_rows(min_row=2)]
        self.assertEqual(flaky, ['PAY-004 slow network'])
        ledger = {r[1].value: r[0].value for r in wb['원장 대조'].iter_rows(min_row=2)}
        self.assertEqual(set(ledger), {'PAY-002', 'PAY-004', 'PAY-005', 'PAY-006', 'PAY-999'})
        gate = [(r[1].value, r[3].value) for r in wb['gate 단계'].iter_rows(min_row=2)]
        self.assertEqual(gate, [('lint', '통과'), ('typecheck', '실패'), ('build', '미실행')])

    def test_sheets_without_data_are_not_created(self):
        out, _ = self.run_build('--input', 'vitest:unit:web=' + self.p('v.json'))
        self.assertEqual(self.sheets(out), ['요약', '단위', '실패 목록', '간헐 실패'])

    def test_summary_json(self):
        out, _ = self.run_build('--input', 'playwright:e2e:main=' + self.p('pw.json'))
        with open(out.replace('.xlsx', '.json'), encoding='utf-8') as fh:
            data = json.load(fh)
        self.assertEqual(data['verdict'], 'failed')
        self.assertEqual(data['meta']['ledgerCases'], 6)
        self.assertTrue(data['meta']['ledgerCompared'])
        self.assertEqual(len(data['ledger']), 4)  # 002 fail, 004 flaky, 005 skipped, 999 missing
        self.assertEqual(len(data['e2eResults']), 5)

    def test_rerun_marks_flaky_by_rerun(self):
        rerun = {'suites': [{'title': 'specs/cart.spec.ts', 'file': 'specs/cart.spec.ts', 'specs': [
            {'title': 'PAY-002 · 003 refund', 'file': 'specs/cart.spec.ts', 'line': 30, 'tests': [
                {'projectName': 'chromium', 'status': 'expected', 'results': [{'status': 'passed', 'duration': 5}]}]}]}]}
        F.write(self.p('rerun.json'), rerun)
        out, _ = self.run_build('--input', 'playwright:e2e:main=' + self.p('pw.json'), '--rerun', 'playwright=' + self.p('rerun.json'))
        wb = openpyxl.load_workbook(out)
        flaky = {r[2].value: r[4].value for r in wb['간헐 실패'].iter_rows(min_row=2)}
        self.assertEqual(flaky['PAY-002 · 003 refund'], '별도 재실행')
        self.assertEqual(flaky['PAY-004 slow network'], '같은 실행 안 재시도')

    def test_results_dir_with_manifest(self):
        d = self.p('runs/itest-20260101-0900')
        F.write(os.path.join(d, 'unit', 'result.json'), F.VITEST_JSON)
        F.write(os.path.join(d, 'logs', 'unit.log'), 'log')
        F.write(os.path.join(d, 'gate.json'), F.GATE_JSON)
        F.write(os.path.join(d, 'manifest.json'), {'name': 'itest', 'startedAt': '2026-01-01T09:00:00', 'commit': 'abc1234', 'host': 'h',
                                                   'results': [{'adapter': 'vitest', 'kind': 'unit', 'suite': 'web', 'file': os.path.join(d, 'unit', 'result.json'),
                                                                'log': os.path.join(d, 'logs', 'unit.log'), 'exit': 1},
                                                               {'adapter': 'jest', 'kind': 'unit', 'suite': 'dead', 'file': os.path.join(d, 'nope.json'), 'exit': 1}]})
        out, _ = self.run_build('--results-dir', d, '--out-template', 'docs/test-results/{date}/{name}-{HHMM}.xlsx')
        self.assertTrue(out.endswith('r.xlsx'))
        wb = openpyxl.load_workbook(out)
        names = [r[1].value for r in wb['단위'].iter_rows(min_row=2)]
        self.assertEqual(names, ['dead', 'web', '2개'])  # a stage with no output is a failed suite row
        self.assertEqual(wb['요약']['B7'].value, 'abc1234')

    def test_out_template_default_location(self):
        r = subprocess.run([sys.executable, SCRIPT, '--repo', self.dir, '--name', 'My Run', '--started', '2026-03-04T05:06:00',
                            '--out-template', 'docs/test-results/{date}/{name}-{HHMM}.xlsx', '--input', 'vitest:unit:web=' + self.p('v.json')],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(self.p('docs/test-results/2026-03-04/My-Run-0506.xlsx')))
        self.assertTrue(os.path.isfile(self.p('docs/test-results/2026-03-04/My-Run-0506.json')))

    def test_coverage_and_mutation_sheets(self):
        F.write(self.p('cov.json'), {'total': {'lines': {'pct': 81.5, 'total': 100}, 'statements': {'pct': 80}, 'branches': {'pct': 70}, 'functions': {'pct': 90}}})
        F.write(self.p('mut.json'), {'files': {'a.js': {'mutants': [{'status': 'Killed'}, {'status': 'Survived'}, {'status': 'Timeout'}]}}})
        out, _ = self.run_build('--input', 'vitest:unit:web=' + self.p('v.json'), '--coverage', 'web=' + self.p('cov.json'), '--mutation', 'web=' + self.p('mut.json'))
        wb = openpyxl.load_workbook(out)
        self.assertEqual(wb['커버리지']['B2'].value, 81.5)
        self.assertEqual(wb['변이']['B2'].value, 66.7)

    def test_bad_kind_is_reported(self):
        r = subprocess.run([sys.executable, SCRIPT, '--repo', self.dir, '--out', self.p('o.xlsx'), '--input', 'vitest:weird:web=' + self.p('v.json')],
                           capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('unknown kind', r.stderr)


if __name__ == '__main__':
    unittest.main()
