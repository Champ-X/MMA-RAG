"""Strong single-view evidence must survive fusion within the same budget."""

from copy import deepcopy

import pytest

from app.modules.knowledge.evidence_routing import select_evidence_anchors, select_prototype_routes


def candidate(identifier, score=0.01):
    return {"id": identifier, "score": score, "payload": {"kb_id": "allowed-kb", "content": identifier}}


def test_strong_speech_evidence_survives_consensus_bias_without_budget_growth():
    fused = [candidate("scene-a", .05), candidate("scene-b", .04), candidate("answer", .02)]
    original = deepcopy(fused)
    selection = select_evidence_anchors(fused, {
        "caption_dense": [{"id": "scene-a", "score": .59}],
        "asr_dense": [{"id": "answer", "score": .77}],
    }, 2)

    assert [row["id"] for row in selection.candidates] == ["scene-a", "answer"]
    assert selection.candidates[-1]["score"] == .02  # Native fusion score is not fabricated.
    assert selection.details["inserted_ids"] == ["answer"]
    assert selection.details["evicted_ids"] == ["scene-b"]
    assert selection.candidates[-1]["semantic_evidence_anchor"]["views"] == ["asr_dense"]
    assert fused == original


def test_both_strong_views_are_preserved_when_they_agree_in_score_not_identity():
    fused = [candidate("consensus"), candidate("other"), candidate("speech"), candidate("picture")]
    selection = select_evidence_anchors(fused, {
        "caption_dense": [{"id": "picture", "score": .82}],
        "asr_dense": [{"id": "speech", "score": .80}],
    }, 3)
    assert [row["id"] for row in selection.candidates] == ["consensus", "speech", "picture"]
    assert len(selection.details["anchor_ids"]) == 2


def test_duplicate_view_winners_occupy_one_slot():
    selection = select_evidence_anchors(
        [candidate("a"), candidate("b"), candidate("answer"), candidate("answer")],
        {"caption_dense": [{"id": "answer", "score": .8}], "asr_dense": [{"id": "answer", "score": .82}]},
        2,
    )
    assert [row["id"] for row in selection.candidates] == ["a", "answer"]
    assert selection.details["anchor_ids"] == ["answer"]
    assert selection.candidates[-1]["semantic_evidence_anchor"]["views"] == ["caption_dense", "asr_dense"]


def test_budget_one_uses_strongest_semantic_winner():
    selection = select_evidence_anchors(
        [candidate("consensus"), candidate("picture"), candidate("speech")],
        {"caption_dense": [{"id": "picture", "score": .8}], "asr_dense": [{"id": "speech", "score": .85}]},
        1,
    )
    assert [row["id"] for row in selection.candidates] == ["speech"]


@pytest.mark.parametrize("hits", [{}, {"asr_dense": []}, {"asr_dense": None}, {"asr_dense": [None]}])
def test_empty_or_failed_view_keeps_fusion_order(hits):
    selection = select_evidence_anchors([candidate("a"), candidate("b"), candidate("c")], hits, 2)
    assert [row["id"] for row in selection.candidates] == ["a", "b"]
    assert selection.details["inserted_ids"] == []


@pytest.mark.parametrize("score", [.1, .49, float("nan"), float("inf"), True, "0.9"])
def test_weak_or_invalid_semantic_noise_is_not_inserted(score):
    selection = select_evidence_anchors(
        [candidate("a"), candidate("b"), candidate("noise")],
        {"asr_dense": [{"id": "noise", "score": score}]}, 2,
    )
    assert [row["id"] for row in selection.candidates] == ["a", "b"]


def test_relative_threshold_rejects_weaker_view_even_above_absolute_floor():
    selection = select_evidence_anchors(
        [candidate("picture"), candidate("other"), candidate("speech")],
        {"caption_dense": [{"id": "picture", "score": .9}], "asr_dense": [{"id": "speech", "score": .6}]},
        2, min_score=.5, min_relative_score=.9,
    )
    assert [row["id"] for row in selection.candidates] == ["picture", "other"]


def test_unlisted_sparse_and_clip_scales_cannot_promote_a_candidate():
    selection = select_evidence_anchors(
        [candidate("a"), candidate("b"), candidate("sparse"), candidate("clip")],
        {"asr_sparse": [{"id": "sparse", "score": 24.0}], "clip": [{"id": "clip", "score": .9}]},
        2,
    )
    assert [row["id"] for row in selection.candidates] == ["a", "b"]


def test_a_probe_cannot_invent_source_metadata_or_expand_candidate_scope():
    selection = select_evidence_anchors(
        [candidate("a"), candidate("b")], {"asr_dense": [{"id": "unknown-outside-scope", "score": .99}]}, 2,
    )
    assert [row["id"] for row in selection.candidates] == ["a", "b"]
    assert selection.details["anchor_ids"] == []


def test_zero_anchor_budget_is_an_exact_selection_rollback():
    fused = [candidate("a"), candidate("b"), candidate("answer")]
    selection = select_evidence_anchors(fused, {"asr_dense": [{"id": "answer", "score": .99}]}, 2, max_anchors=0)
    assert selection.candidates == fused[:2]


def test_zero_candidate_budget_returns_no_evidence():
    selection = select_evidence_anchors([candidate("a")], {"asr_dense": [{"id": "a", "score": .99}]}, 0)
    assert selection.candidates == []


@pytest.mark.parametrize("options", [{"min_score": float("nan")}, {"min_relative_score": 1.2}, {"max_anchors": -1}])
def test_invalid_policy_parameters_fail_explicitly(options):
    with pytest.raises(ValueError):
        select_evidence_anchors([], {}, 2, **options)


def test_dominant_prototype_replaces_secondary_route_but_retains_primary_anchor():
    baseline = ["primary", "secondary"]
    scores = {"primary": .51, "secondary": .54, "content-winner": .75}
    selection = select_prototype_routes(baseline, scores)

    assert selection.targets == ["primary", "content-winner"]
    assert selection.details["reason"] == "dominant_content_prototype"
    assert selection.details["inserted_kb_ids"] == ["content-winner"]
    assert selection.details["evicted_kb_ids"] == ["secondary"]
    assert selection.details["absolute_gap"] == pytest.approx(.21)
    assert selection.details["relative_gap"] == pytest.approx(.28)
    assert baseline == ["primary", "secondary"]
    assert scores == {"primary": .51, "secondary": .54, "content-winner": .75}


def test_dominant_prototype_can_fill_second_route_within_budget():
    selection = select_prototype_routes(["primary"], {"primary": .5, "content-winner": .7})
    assert selection.targets == ["primary", "content-winner"]
    assert selection.details["evicted_kb_ids"] == []


@pytest.mark.parametrize("scores,reason", [
    ({"primary": .2, "new": .49}, "weak_prototype_score"),
    ({"primary": .69, "new": .72}, "weak_absolute_gap"),
    ({"primary": .71, "new": .8}, "weak_relative_gap"),
    ({"primary": .8, "new": .8}, "weak_absolute_gap"),
    ({"primary": .6, "new": .8, "competitor": .79}, "weak_absolute_gap"),
])
def test_weak_or_ambiguous_prototype_evidence_preserves_baseline(scores, reason):
    selection = select_prototype_routes(["primary", "secondary"], scores)
    assert selection.targets == ["primary", "secondary"]
    assert selection.details["reason"] == reason
    assert selection.details["inserted_kb_ids"] == []


@pytest.mark.parametrize("winner", ["primary", "secondary"])
def test_existing_winner_never_reorders_or_expands_routes(winner):
    selection = select_prototype_routes(
        ["primary", "secondary"], {"primary": .5, "secondary": .5, winner: .9, "third": .4},
    )
    assert selection.targets == ["primary", "secondary"]
    assert selection.details["reason"] == "winner_already_selected"


@pytest.mark.parametrize("scores", [
    {}, {"new": .99}, {"new": .99, "bad": float("nan")},
    {"new": .99, "bad": float("inf")}, {"new": .99, "bad": True},
    {"new": .99, "bad": "0.2"}, {"": .1, "new": .99},
])
def test_incomplete_or_invalid_prototype_scores_cannot_establish_dominance(scores):
    selection = select_prototype_routes(["primary", "secondary"], scores)
    assert selection.targets == ["primary", "secondary"]
    assert selection.details["reason"] == "insufficient_prototypes"


def test_prototype_policy_respects_single_target_budget():
    selection = select_prototype_routes(["primary"], {"primary": .2, "new": .9}, max_targets=1)
    assert selection.targets == ["primary"]
    assert selection.details["reason"] == "no_supplement_budget"


@pytest.mark.parametrize("baseline,budget", [([], 2), (["primary"], 0)])
def test_prototypes_cannot_create_a_route_without_a_baseline_anchor(baseline, budget):
    selection = select_prototype_routes(baseline, {"primary": .2, "new": .9}, max_targets=budget)
    assert selection.targets == []
    assert selection.details["reason"] == "no_baseline_anchor"


def test_policy_deduplicates_baseline_and_replaces_only_last_slot_in_larger_budget():
    selection = select_prototype_routes(
        ["primary", "secondary", "secondary", "third", "out-of-budget"],
        {"new": .9, "primary": .5, "secondary": .4, "third": .3}, max_targets=3,
    )
    assert selection.targets == ["primary", "secondary", "new"]
    assert selection.details["baseline_targets"] == ["primary", "secondary", "third"]
    assert selection.details["evicted_kb_ids"] == ["third"]


@pytest.mark.parametrize("scores", [
    {"new": .9, "other": .3},
    {"new": .9, "primary": .3},
    {"new": .9, "primary": .3, "secondary": float("nan")},
])
def test_partial_prototype_migration_cannot_evict_unmigrated_baseline(scores):
    selection = select_prototype_routes(["primary", "secondary"], scores)
    assert selection.targets == ["primary", "secondary"]
    assert selection.details["reason"] == "baseline_prototypes_incomplete"


def test_exact_thresholds_qualify_but_zero_gap_never_qualifies():
    selection = select_prototype_routes(
        ["primary"], {"primary": .5, "new": .75},
        min_score=.75, min_absolute_gap=.25, min_relative_gap=1 / 3,
    )
    assert selection.targets == ["primary", "new"]
    tied = select_prototype_routes(
        ["primary"], {"a-new": .8, "primary": .8}, min_absolute_gap=0, min_relative_gap=0,
    )
    assert tied.targets == ["primary"]
    assert tied.details["reason"] == "weak_absolute_gap"


@pytest.mark.parametrize("options", [
    {"max_targets": -1}, {"max_targets": True}, {"min_score": float("nan")},
    {"min_absolute_gap": -1}, {"min_relative_gap": 1.2}, {"min_relative_gap": True},
])
def test_invalid_prototype_policy_parameters_fail_explicitly(options):
    with pytest.raises(ValueError):
        select_prototype_routes([], {}, **options)
