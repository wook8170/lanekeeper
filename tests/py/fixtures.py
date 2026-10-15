"""Synthetic result files for the adapter and workbook tests."""
import json
import os
import sys

CORE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'templates', 'test-results', 'core')
sys.path.insert(0, os.path.abspath(CORE))


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text if isinstance(text, str) else json.dumps(text))
    return path


VITEST_JSON = {
    'startTime': 1000, 'numTotalTests': 5,
    'testResults': [
        {'name': '/p/src/a.test.ts', 'startTime': 1000, 'endTime': 1500, 'status': 'failed', 'assertionResults': [
            {'ancestorTitles': ['cart'], 'title': 'adds', 'status': 'passed'},
            {'ancestorTitles': ['cart'], 'title': 'totals', 'status': 'failed', 'duration': 12,
             'failureMessages': ['AssertionError: expected 3 to be 4\n    at /p/src/a.test.ts:21:9']},
            {'ancestorTitles': [], 'title': 'later', 'status': 'skipped'},
        ]},
        {'name': '/p/src/b.test.ts', 'startTime': 1100, 'endTime': 2000, 'status': 'passed', 'assertionResults': [
            {'ancestorTitles': [], 'title': 'one', 'status': 'passed'}, {'ancestorTitles': [], 'title': 'two', 'status': 'passed'}]},
    ],
}

VITEST_LOG = """
 RUN  v2.0.0 /p

 FAIL  src/a.test.ts > cart > totals
AssertionError: expected 3 to be 4
 ❯ src/a.test.ts:21:9

⎯⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 3 passed | 1 skipped (5)
   Duration  1.52s (transform 20ms)
"""

JEST_JSON = {
    'startTime': 5000, 'numTotalTests': 4,
    'testResults': [
        {'name': '/p/x.test.js', 'status': 'failed', 'startTime': 5000, 'endTime': 6000, 'assertionResults': [
            {'ancestorTitles': ['math'], 'title': 'adds', 'status': 'passed'},
            {'ancestorTitles': ['math'], 'title': 'divides', 'status': 'failed', 'failureMessages': ['Error: boom\n    at x.test.js:9:3']},
            {'ancestorTitles': ['math'], 'title': 'todo item', 'status': 'todo'},
            {'ancestorTitles': ['math'], 'title': 'off', 'status': 'pending'},
        ]},
        {'name': '/p/broken.test.js', 'status': 'failed', 'message': 'Cannot find module ./nope', 'assertionResults': []},
    ],
}

JEST_LOG = """
FAIL ./x.test.js
  ● math › divides

    Error: boom

      at x.test.js:9:3

Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 1 skipped, 2 passed, 4 total
Time:        2.4 s
"""

JUNIT = """<?xml version="1.0"?>
<testsuites><testsuite name="pytest" tests="4">
<testcase classname="tests.test_a" name="test_ok" time="0.01"/>
<testcase classname="tests.test_a" name="test_bad" file="tests/test_a.py" line="14" time="0.5"><failure message="assert 1 == 2">trace</failure></testcase>
<testcase classname="tests.test_a" name="test_skip" time="0"><skipped message="later"/></testcase>
<testcase classname="tests.test_b" name="test_err" time="0.2"><error message="fixture db not found">trace</error></testcase>
</testsuite></testsuites>"""

PYTEST_LOG = """
FAILED tests/test_a.py::test_bad - assert 1 == 2
ERROR tests/test_b.py::test_err - fixture db not found
=== 2 failed, 1 passed, 1 skipped in 0.71s ===
"""


def pw_test(project, title, line, results, status, file='specs/cart.spec.ts'):
    return {'title': title, 'file': file, 'line': line, 'tests': [{'projectName': project, 'status': status, 'results': results}]}


PLAYWRIGHT_JSON = {'suites': [{'title': 'specs/cart.spec.ts', 'file': 'specs/cart.spec.ts', 'specs': [
    {'title': 'PAY-001 checkout works', 'file': 'specs/cart.spec.ts', 'line': 10, 'tests': [
        {'projectName': 'chromium', 'status': 'expected', 'results': [{'status': 'passed', 'duration': 900}]}]},
    {'title': 'PAY-002 · 003 refund', 'file': 'specs/cart.spec.ts', 'line': 30, 'tests': [
        {'projectName': 'chromium', 'status': 'unexpected', 'results': [
            {'status': 'failed', 'duration': 500, 'errors': [{'message': 'Timeout 5000ms exceeded'}]}]}]},
    {'title': 'PAY-004 slow network', 'file': 'specs/cart.spec.ts', 'line': 50, 'tests': [
        {'projectName': 'chromium', 'status': 'flaky', 'results': [
            {'status': 'failed', 'duration': 100, 'errors': [{'message': 'net'}]}, {'status': 'passed', 'duration': 120}]}]},
    {'title': 'PAY-005 later', 'file': 'specs/cart.spec.ts', 'line': 60, 'tests': [
        {'projectName': 'chromium', 'status': 'skipped', 'results': [{'status': 'skipped'}]}]},
    {'title': 'PAY-999 unlisted', 'file': 'specs/cart.spec.ts', 'line': 70, 'tests': [
        {'projectName': 'chromium', 'status': 'expected', 'results': [{'status': 'passed', 'duration': 5}]}]},
]}]}

PLAYWRIGHT_LOG = """
  ✓  1 [chromium] › specs/cart.spec.ts:10:3 › PAY-001 checkout works (0.9s)
  ✘  2 [chromium] › specs/cart.spec.ts:50:3 › PAY-004 slow network (0.1s)
  ✓  3 [chromium] › specs/cart.spec.ts:50:3 › PAY-004 slow network (retry #1) (0.1s)
  ✘  4 [chromium] › specs/cart.spec.ts:30:3 › PAY-002 refund (0.5s)
  -  5 [chromium] › specs/cart.spec.ts:60:3 › PAY-005 later

  1) [chromium] › specs/cart.spec.ts:30:3 › PAY-002 refund ────

    Error: Timeout 5000ms exceeded
"""

GATE_JSON = {'steps': [
    {'name': 'lint', 'cmd': 'npm run lint', 'status': 'passed', 'exit': 0, 'durationMs': 1200},
    {'name': 'typecheck', 'cmd': 'npm run typecheck', 'status': 'failed', 'exit': 2, 'durationMs': 800, 'detail': 'TS2322'},
    {'name': 'build', 'cmd': 'npm run build', 'status': 'notRun', 'detail': 'not run: an earlier step failed'},
]}

LEDGER = {'version': 1, 'module': 'pay', 'prefix': 'PAY', 'retired_ids': ['PAY-007'], 'cases': [
    {'id': 'PAY-001', 'title': 'checkout', 'priority': 'P0', 'status': 'active', 'steps': [], 'expected': 'ok'},
    {'id': 'PAY-002', 'title': 'refund', 'priority': 'P1', 'status': 'active', 'steps': [], 'expected': 'ok'},
    {'id': 'PAY-003', 'title': 'partial refund', 'priority': 'P1', 'status': 'fixme', 'defect': 'D-001', 'steps': [], 'expected': 'ok'},
    {'id': 'PAY-004', 'title': 'slow network', 'priority': 'P2', 'status': 'active', 'steps': [], 'expected': 'ok'},
    {'id': 'PAY-005', 'title': 'later', 'priority': 'P2', 'status': 'active', 'steps': [], 'expected': 'ok'},
    {'id': 'PAY-006', 'title': 'never run', 'priority': 'P0', 'status': 'active', 'steps': [], 'expected': 'ok'},
]}
