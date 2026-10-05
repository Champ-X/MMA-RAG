"""Keep semantic review attribution and negative/incomplete judgments honest."""
import importlib.util
from pathlib import Path
import sys

import pytest

spec = importlib.util.spec_from_file_location("pi_semantic_review", Path(__file__).resolve().parents[2] / "scripts/pi_semantic_review.py")
review = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = review
spec.loader.exec_module(review)


def job_and_verdict():
    job = {"reference_facts": ["增幅为7.3个百分点"], "answers": [{"answer_id": "blind-a", "answer": "增加7.3个百分点[1]。",
        "citations": [{"id": 1, "content": "Pass@1 rises from 69.7% to 77.0%."}]}]}
    verdict = {"answers": [{"answer_id": "blind-a", "facts": [{"index": 1, "status": "covered", "answer_quote": "增加7.3个百分点", "reason": "数值一致"}],
        "claims": [{"answer_quote": "增加7.3个百分点", "kind": "factual", "support": "supported", "source_quotes": [{"citation_id": 1,
            "quote": "69.7% to 77.0%"}], "reason": "差值7.3个百分点"}], "complete": True}]}
    return job, verdict


@pytest.mark.parametrize("mutation", ["answer_id", "answer_quote", "citation_id", "source_quote", "missing_fact", "missing_support"])
def test_review_cannot_invent_identity_evidence_or_skip_required_facts(mutation):
    job, value = job_and_verdict()
    answer = value["answers"][0]
    if mutation == "answer_id":
        answer["answer_id"] = "other-condition"
    elif mutation == "answer_quote":
        answer["claims"][0]["answer_quote"] = "增加70个百分点"
    elif mutation == "citation_id":
        answer["claims"][0]["source_quotes"][0]["citation_id"] = 2
    elif mutation == "source_quote":
        answer["claims"][0]["source_quotes"][0]["quote"] = "model was retrained"
    elif mutation == "missing_fact":
        answer["facts"] = []
    else:
        answer["claims"][0]["source_quotes"] = []
    with pytest.raises(ValueError):
        review.validate_review(job, value)


def dataset():
    job, value = job_and_verdict()
    template = review.validate_review(job, value).answers[0]
    assignments, judgments = {}, {}
    for mode in ("auto", "direct", "agent"):
        for loaded in (False, True):
            key = f"{mode}-{loaded}"
            assignments[key] = {"case_id": "q", "engine": "legacy", "mode": mode, "loaded": loaded,
                "checks": {"execution_succeeded": True, "markers_resolve": True, "no_unused_citations": True, "unanswerable_has_no_citations": True}}
            judgments[key] = template.model_copy(deep=True, update={"answer_id": key})
    assignments["pi"] = {"case_id": "q", "engine": "pi", "mode": None, "loaded": None, "checks": {"execution_succeeded": True}}
    judgments["pi"] = template.model_copy(deep=True, update={"answer_id": "pi"})
    return assignments, judgments


def test_missing_or_uncertain_judgment_cannot_count_as_no_decline():
    assignments, judgments = dataset()
    del judgments["auto-False"]
    judgments["direct-True"].claims[0].support = "uncertain"
    judgments["pi"].complete = False
    report = review.aggregate(assignments, judgments)
    assert not report["legacy_pass"] and not report["pi_pass"]
    assert [p["evaluable"] for p in report["legacy_pairs"]] == [False, False, True]


def test_a_lost_fact_or_new_unrelated_citation_fails_the_paired_gate():
    assignments, judgments = dataset()
    judgments["auto-True"].facts[0].status = "missing"
    assignments["agent-True"]["checks"]["unanswerable_has_no_citations"] = False
    report = review.aggregate(assignments, judgments)
    assert [p["pass"] for p in report["legacy_pairs"]] == [False, True, False]


def test_preexisting_citation_defect_is_reported_without_claiming_pi_introduced_it():
    assignments, judgments = dataset()
    for loaded in (False, True):
        assignments[f"auto-{loaded}"]["checks"]["unanswerable_has_no_citations"] = False
    report = review.aggregate(assignments, judgments)
    assert report["legacy_pass"]
    assert report["legacy_pairs"][0]["baseline_check_failures"] == ["unanswerable_has_no_citations"]


def test_scope_uses_source_identity_instead_of_matching_display_names():
    case = {"selected_files": [{"kbId": "one", "fileId": "first"}]}
    correct = [{"id": 1, "file_name": "资料.pdf", "file_path": "documents/first_资料.pdf"}]
    wrong = [{"id": 1, "file_name": "资料.pdf", "file_path": "documents/second_资料.pdf"}]
    assert review.identity_checks(case, "one", "事实[1]", correct)["selected_file_ids"]
    assert not review.identity_checks(case, "one", "事实[1]", wrong)["selected_file_ids"]
    assert not review.identity_checks(case, "one", "事实[1]", correct, pi_evidence=[{"source_id": "outside"}])["selected_file_ids"]
