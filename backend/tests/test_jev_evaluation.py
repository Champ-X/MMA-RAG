import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.evaluate_jev import metrics, report


def test_ranking_metrics_use_graded_gain_and_cutoff():
    docs = [{'id': 'a', 'relevance': 3}, {'id': 'b', 'relevance': 1}, {'id': 'c', 'relevance': 0}]
    assert metrics(['a', 'b', 'c'], docs)['ndcg5'] == 1
    result = metrics(['c', 'b', 'a'], docs, k=2)
    assert result['recall5'] == .5
    assert result['mrr5'] == .5
    assert result['ndcg5'] == pytest.approx((1 / 1.584962500721156) / (7 + 1 / 1.584962500721156))


def test_missing_positives_are_not_reported_as_zero_quality():
    with pytest.raises(ValueError, match='undefined'):
        metrics(['a'], [{'id': 'a', 'relevance': 0}])


def test_report_retains_unanswerable_receipt_but_excludes_ranking_denominator(tmp_path):
    cases = [{'id': 'no-gold', 'suite': 'public_t2', 'split': 'test',
              'documents': [{'id': 'a', 'relevance': 0}]}]
    result = {'ranking': ['a'], 'pipeline_duration_s': .1, 'scores': [{'index': 0, 'relevance_score': .8}]}
    receipt = {'id': 'no-gold', 'suite': 'public_t2', 'split': 'test', 'candidate_ids': ['a'],
               'fingerprint': 'f', 'jev': result, 'qwen': result}
    receipts, output = tmp_path / 'rows.jsonl', tmp_path / 'summary.json'
    receipts.write_text(json.dumps(receipt) + '\n')
    report(SimpleNamespace(receipts=receipts, report=output), cases, 'f')
    summary = json.loads(output.read_text())
    assert summary['paired_successes'] == 1
    assert summary['ranking_ineligible_no_positive_qrels'] == ['no-gold']
    assert summary['groups'] == {}
    assert summary['pair_diagnostics']['public_t2']['brier'] == pytest.approx(.64)
