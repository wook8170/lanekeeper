import os
import tempfile
import unittest

import fixtures as F
import adapters as A
import ledger as L
from adapters import gate as G


def one(adapter, kind, suite, **kw):
    return A.parse(adapter, kind, suite, **kw)


class Adapters(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def f(self, name, body):
        return F.write(os.path.join(self.dir, name), body)

    def test_vitest_json(self):
        s, t = one('vitest', 'unit', 'web', file=self.f('v.json', F.VITEST_JSON))
        self.assertEqual((s[0]['total'], s[0]['passed'], s[0]['failed'], s[0]['skipped']), (5, 3, 1, 1))
        self.assertEqual(s[0]['durationMs'], 1000)  # wall clock 1000 -> 2000
        self.assertEqual(s[0]['status'], 'failed')
        self.assertEqual(len(t), 1)
        self.assertEqual((t[0]['name'], t[0]['line'], t[0]['file']), ('cart > totals', 21, '/p/src/a.test.ts'))
        self.assertIn('expected 3 to be 4', t[0]['error'])

    def test_vitest_log(self):
        s, t = one('vitest', 'unit', 'web', log=self.f('v.log', F.VITEST_LOG))
        self.assertEqual((s[0]['total'], s[0]['passed'], s[0]['failed'], s[0]['skipped']), (5, 3, 1, 1))
        self.assertEqual(s[0]['durationMs'], 1520)
        self.assertEqual((t[0]['file'], t[0]['name'], t[0]['line']), ('src/a.test.ts', 'cart > totals', 21))

    def test_vitest_log_without_summary_is_failed_when_a_fail_line_exists(self):
        s, t = one('vitest', 'unit', 'web', log=self.f('x.log', ' FAIL  src/a.test.ts > x\nboom\n'))
        self.assertEqual((s[0]['status'], s[0]['failed']), ('failed', 1))

    def test_jest_json(self):
        s, t = one('jest', 'unit', 'api', file=self.f('j.json', F.JEST_JSON))
        self.assertEqual((s[0]['total'], s[0]['passed'], s[0]['failed'], s[0]['skipped']), (5, 1, 2, 2))
        names = sorted(x['name'] for x in t)
        self.assertEqual(names, ['(suite failed to run)', 'math > divides'])
        self.assertEqual([x['line'] for x in t if x['name'] == 'math > divides'], [9])
        self.assertEqual(s[0]['durationMs'], 1000)

    def test_jest_log(self):
        s, t = one('jest', 'unit', 'api', log=self.f('j.log', F.JEST_LOG))
        self.assertEqual((s[0]['total'], s[0]['passed'], s[0]['failed'], s[0]['skipped']), (4, 2, 1, 1))
        self.assertEqual(t[0]['name'], 'math > divides')
        self.assertEqual(s[0]['durationMs'], 2400)

    def test_pytest_junit(self):
        s, t = one('pytest', 'unit', 'svc', file=self.f('junit.xml', F.JUNIT))
        self.assertEqual((s[0]['total'], s[0]['passed'], s[0]['failed'], s[0]['skipped']), (4, 1, 2, 1))
        by = {x['name']: x for x in t}
        self.assertEqual(by['tests.test_a::test_bad']['line'], 14)
        self.assertEqual(by['tests.test_a::test_bad']['error'], 'assert 1 == 2')
        self.assertIn('fixture db not found', by['tests.test_b::test_err']['error'])

    def test_pytest_log(self):
        s, t = one('pytest', 'unit', 'svc', log=self.f('p.log', F.PYTEST_LOG))
        self.assertEqual((s[0]['total'], s[0]['passed'], s[0]['failed'], s[0]['skipped']), (4, 1, 2, 1))
        self.assertEqual(s[0]['durationMs'], 710)
        self.assertEqual({x['file'] for x in t}, {'tests/test_a.py', 'tests/test_b.py'})

    def test_playwright_json(self):
        s, t = one('playwright', 'e2e', 'main', file=self.f('pw.json', F.PLAYWRIGHT_JSON))
        by = {x['line']: x for x in t}
        self.assertEqual([by[l]['status'] for l in (10, 30, 50, 60)], ['passed', 'failed', 'flaky', 'skipped'])
        self.assertEqual(by[50]['attempts'], ['failed', 'passed'])
        self.assertEqual(by[30]['error'], 'Timeout 5000ms exceeded')
        self.assertEqual(len(s), 1)
        self.assertEqual((s[0]['name'], s[0]['total'], s[0]['failed'], s[0]['flaky'], s[0]['skipped']), ('chromium', 5, 1, 1, 1))

    def test_playwright_log_retry_is_flaky(self):
        s, t = one('playwright', 'e2e', 'main', log=self.f('pw.log', F.PLAYWRIGHT_LOG))
        by = {x['line']: x for x in t}
        self.assertEqual(by[50]['status'], 'flaky')
        self.assertEqual(by[30]['status'], 'failed')
        self.assertIn('Timeout 5000ms exceeded', by[30]['error'])
        self.assertEqual(by[60]['status'], 'skipped')

    def test_gate_json_and_log(self):
        rows = G.parse_json(F.GATE_JSON, 'gate.json')
        self.assertEqual([r['status'] for r in rows], ['passed', 'failed', 'notRun'])
        self.assertEqual(rows[1]['detail'], 'TS2322')
        rows = G.parse_log('✓ lint\n✗ typecheck\nnoise\n', 'g.log')
        self.assertEqual([(r['step'], r['status']) for r in rows], [('lint', 'passed'), ('typecheck', 'failed')])

    def test_unknown_adapter_and_missing_input(self):
        with self.assertRaises(ValueError):
            A.parse('nope', 'unit', 'x', file='a')
        with self.assertRaises(ValueError):
            A.parse('vitest', 'unit', 'x')


class Ledger(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        F.write(os.path.join(self.dir, 'pay.cases.json'), F.LEDGER)
        self.cases, self.retired = L.load_cases(self.dir)
        _, self.tests = A.parse('playwright', 'e2e', 'main', file=F.write(os.path.join(self.dir, 'pw.json'), F.PLAYWRIGHT_JSON))

    def test_load_normalizes_legacy_status_and_list_form(self):
        c, r = L.load_cases(documents=['[{"id": "X-001", "status": "pass"}, {"id": "X-002", "status": "notImplemented"}]'])
        self.assertEqual((c['X-001']['status'], c['X-002']['status']), ('active', 'fixme'))
        self.assertEqual(self.retired, {'PAY-007'})

    def test_title_ids_expand_short_form(self):
        rx = L.id_regex(self.cases)
        self.assertEqual(L.title_case_ids('PAY-002 · 003 refund', rx), ['PAY-002', 'PAY-003'])
        self.assertEqual(L.title_case_ids('HTTP-200 is not a case', rx), [])
        self.assertIsNone(L.id_regex([]))

    def test_link_by_spec_and_title(self):
        cases = dict(self.cases)
        cases['PAY-008'] = {'id': 'PAY-008', 'status': 'active', 'spec': 'cart.spec.ts', 'testTitle': 'slow network', 'module': 'pay', 'scenario': ''}
        L.link_cases(self.tests, cases)
        ids = {t['line']: t['caseIds'] for t in self.tests}
        self.assertEqual(ids[30], ['PAY-002', 'PAY-003'])
        self.assertEqual(ids[50], ['PAY-004', 'PAY-008'])

    def test_compare_finds_each_kind(self):
        L.link_cases(self.tests, self.cases)
        rows = {r['caseId']: r['kind'] for r in L.compare(self.tests, self.cases, self.retired, 'P0')}
        self.assertEqual(rows['PAY-002'], '원장 활성 · 실행 실패')
        self.assertEqual(rows['PAY-004'], '원장 활성 · 실행 간헐')
        self.assertEqual(rows['PAY-005'], '원장 활성 · 실행 건너뜀')
        self.assertEqual(rows['PAY-999'], '원장 누락')
        self.assertIn('P0', rows['PAY-006'])
        self.assertNotIn('PAY-001', rows)

    def test_fixme_passing_and_retired(self):
        L.link_cases(self.tests, self.cases)
        for t in self.tests:
            if t['line'] == 30:
                t['status'] = 'passed'
            if t['line'] == 10:
                t['name'] = 'PAY-001 PAY-007 checkout'
                t['caseIds'] = ['PAY-001', 'PAY-007']
        rows = {r['caseId']: r['kind'] for r in L.compare(self.tests, self.cases, self.retired)}
        self.assertEqual(rows['PAY-003'], '원장 보류 · 실행 통과(원장 갱신 검토)')
        self.assertEqual(rows['PAY-007'], '폐기된 ID 참조')
        self.assertNotIn('PAY-002', rows)


if __name__ == '__main__':
    unittest.main()
