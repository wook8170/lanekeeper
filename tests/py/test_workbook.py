import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

import fixtures as F
import build_xlsx as B
import xlsx_dump as X

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
        book = openpyxl.load_workbook(out)
        ws = book['요약']
        self.assertEqual(ws['A3'].value, '종합 판정')
        self.assertTrue(ws['B3'].value.startswith('실패'))
        fails = [r[2].value for r in book['실패 목록'].iter_rows(min_row=2)]
        self.assertIn('cart > totals', fails)
        self.assertIn('PAY-002 · 003 refund', fails)
        self.assertIn('npm run typecheck', fails)
        flaky = [r[2].value for r in book['간헐 실패'].iter_rows(min_row=2)]
        self.assertEqual(flaky, ['PAY-004 slow network'])
        ledger = {r[1].value: r[0].value for r in book['원장 대조'].iter_rows(min_row=2)}
        self.assertEqual(set(ledger), {'PAY-002', 'PAY-004', 'PAY-005', 'PAY-006', 'PAY-999'})
        gate = [(r[1].value, r[3].value) for r in book['gate 단계'].iter_rows(min_row=2)]
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
        book = openpyxl.load_workbook(out)
        flaky = {r[2].value: r[4].value for r in book['간헐 실패'].iter_rows(min_row=2)}
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
        book = openpyxl.load_workbook(out)
        names = [r[1].value for r in book['단위'].iter_rows(min_row=2)]
        self.assertEqual(names, ['dead', 'web', '2개'])  # a stage with no output is a failed suite row
        self.assertEqual(book['요약']['B7'].value, 'abc1234')

    def test_out_template_default_location(self):
        r = subprocess.run([sys.executable, SCRIPT, '--repo', self.dir, '--name', 'My Run', '--started', '2026-03-04T05:06:00',
                            '--out-template', 'docs/test-results/{date}/{name}-{HHMM}.xlsx', '--input', 'vitest:unit:web=' + self.p('v.json')],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(self.p('docs/test-results/2026-03-04/My-Run-0506.xlsx')))
        self.assertTrue(os.path.isfile(self.p('docs/test-results/2026-03-04/My-Run-0506.json')))

    def test_utc_start_names_the_file_in_local_time(self):
        # verify-all writes startedAt in UTC ('...Z'); the file name uses the local time zone (TZ)
        env = dict(os.environ, TZ='Asia/Seoul')
        r = subprocess.run([sys.executable, SCRIPT, '--repo', self.dir, '--name', 'integration', '--started', '2026-10-17T13:38:00.000Z',
                            '--out-template', 'docs/test-results/{date}/{name}-{HHMM}.xlsx', '--input', 'vitest:unit:web=' + self.p('v.json')],
                           capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(self.p('docs/test-results/2026-10-17/integration-2238.xlsx')), os.listdir(self.dir))
        env['TZ'] = 'UTC'
        r = subprocess.run([sys.executable, SCRIPT, '--repo', self.dir, '--name', 'late', '--started', '2026-10-17T15:30:00Z',
                            '--out-template', 'docs/test-results/{date}/{name}-{HHMM}.xlsx', '--input', 'vitest:unit:web=' + self.p('v.json')],
                           capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(self.p('docs/test-results/2026-10-17/late-1530.xlsx')))

    def test_result_line_follows_lang(self):
        _, line = self.run_build('--input', 'vitest:unit:web=' + self.p('v.json'), '--lang', 'en')
        self.assertIn('verdict failed', line)
        self.assertNotIn('판정', line)
        _, line = self.run_build('--input', 'vitest:unit:web=' + self.p('v.json'))
        self.assertIn('판정 실패', line)

    def test_korean_workbook_equals_the_recorded_one(self):
        # sheet names, headers, summary rows and notes: the Korean workbook must not change when the words move to the locale files
        out, line, tmp = X.build_full()
        with open(os.path.join(os.path.dirname(__file__), 'golden_ko.json'), encoding='utf-8') as fh:
            golden = json.load(fh)
        got = json.loads(json.dumps(X.dump(out, tmp), sort_keys=True, ensure_ascii=False))
        got['line'] = line.replace(tmp, '<TMP>')
        self.assertEqual(got['sheets'], golden['sheets'])
        self.assertEqual(got['line'], golden['line'])
        self.assertEqual(got['data'], golden['data'])
        out2, _, _ = X.build_full('ko')
        self.assertEqual(openpyxl.load_workbook(out2).sheetnames, golden['sheets'])

    def test_english_workbook_has_english_sheets_headers_and_notes(self):
        out, line, tmp = X.build_full('en')
        d = X.dump(out, tmp)
        self.assertEqual(d['sheets'], ['Summary', 'Unit', 'Integration DB', 'e2e', 'e2e detail', 'UI stability', 'Gate steps', 'Failures',
                                       'Flaky', 'Ledger comparison', 'Coverage', 'Mutation'])
        self.assertTrue(all(len(n) <= 31 for n in d['sheets']))
        self.assertIn('verdict failed', line)
        cells = d['data']['Summary']['cells']
        self.assertEqual(cells['A3'], 'Overall verdict')
        self.assertTrue(cells['B3'].startswith('Failed'))
        self.assertEqual([cells['%s17' % c] for c in 'ABCDEFGHIJKL'][:5], ['Type', 'Suite', 'Total', 'Passed', 'Failed'])
        self.assertIn('Details are on the "Flaky" sheet.', cells['A26'])
        self.assertEqual(d['data']['Gate steps']['cells']['D2'], 'Passed')
        self.assertEqual(d['data']['Gate steps']['cells']['D4'], 'Not run')
        self.assertIn('Ledger active · run failed', d['data']['Ledger comparison']['cells'].values())
        self.assertIn('Retry within the same run', d['data']['Flaky']['cells'].values())
        # no Hangul left anywhere in the English workbook except values taken from the inputs
        for sheet, body in d['data'].items():
            for coord, v in body['cells'].items():
                if isinstance(v, str) and re.search('[가-힣]', v):
                    self.fail('%s!%s still Korean: %r' % (sheet, coord, v))
        # the status colour rules follow the status words of the language
        self.assertTrue(any('SEARCH("Failed"' in c for c in d['data']['Failures']['cf']))

    def test_unknown_lang_value_is_rejected(self):
        r = subprocess.run([sys.executable, SCRIPT, '--repo', self.dir, '--out', self.p('o.xlsx'), '--lang', 'fr',
                            '--input', 'vitest:unit:web=' + self.p('v.json')], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)

    def test_coverage_and_mutation_sheets(self):
        F.write(self.p('cov.json'), {'total': {'lines': {'pct': 81.5, 'total': 100}, 'statements': {'pct': 80}, 'branches': {'pct': 70}, 'functions': {'pct': 90}}})
        F.write(self.p('mut.json'), {'files': {'a.js': {'mutants': [{'status': 'Killed'}, {'status': 'Survived'}, {'status': 'Timeout'}]}}})
        out, _ = self.run_build('--input', 'vitest:unit:web=' + self.p('v.json'), '--coverage', 'web=' + self.p('cov.json'), '--mutation', 'web=' + self.p('mut.json'))
        book = openpyxl.load_workbook(out)
        self.assertEqual(book['커버리지']['B2'].value, 81.5)
        self.assertEqual(book['변이']['B2'].value, 66.7)

    def test_bad_kind_is_reported(self):
        r = subprocess.run([sys.executable, SCRIPT, '--repo', self.dir, '--out', self.p('o.xlsx'), '--input', 'vitest:weird:web=' + self.p('v.json')],
                           capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('unknown kind', r.stderr)


if __name__ == '__main__':
    unittest.main()
