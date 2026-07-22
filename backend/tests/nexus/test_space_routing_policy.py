from __future__ import annotations

import pytest

from nexus.modules.spaces.routing import DEFAULT_SPACE_ROUTING_POLICY, SpaceRouteMethod


def test_route_method_values_are_stable_contract() -> None:
    assert [method.value for method in SpaceRouteMethod] == [
        "no_spaces",
        "no_auto_route_spaces",
        "all_low_safe_broadening",
        "dominant_cluster",
        "multi_space_cluster_match",
    ]


def test_routing_policy_weights_are_named_and_normalized() -> None:
    policy = DEFAULT_SPACE_ROUTING_POLICY

    assert policy.base_weight_total == pytest.approx(1.0)
    assert policy.cluster_weight > policy.lexical_weight > policy.metadata_weight
    assert policy.low_confidence_threshold < policy.dominant_gap_threshold
    assert policy.multi_space_relative_floor > 0.5


def test_routing_policy_scores_clusters_with_recency_decay() -> None:
    policy = DEFAULT_SPACE_ROUTING_POLICY

    assert policy.weighted_cluster_score([]) == 0.0
    assert policy.weighted_cluster_score([1.0, 0.0]) == pytest.approx(
        1.0 / (1.0 + policy.cluster_decay),
    )
    assert policy.weighted_cluster_score([1.0] * 10) == pytest.approx(1.0)


def test_routing_policy_caps_selected_scope_separately_from_candidate_limit() -> None:
    policy = DEFAULT_SPACE_ROUTING_POLICY

    assert policy.max_selected_spaces == 2
    assert policy.selected_space_limit(1) == 1
    assert policy.selected_space_limit(3) == 2


def test_routing_policy_combined_score_is_capped() -> None:
    policy = DEFAULT_SPACE_ROUTING_POLICY

    assert policy.combined_score(
        cluster=0.5,
        lexical=0.5,
        metadata=0.5,
        policy_boost=0.0,
    ) == pytest.approx(0.5)
    assert policy.combined_score(
        cluster=1.0,
        lexical=1.0,
        metadata=1.0,
        policy_boost=policy.policy_boost,
    ) == 1.0


def test_routing_policy_contributions_sum_to_final_score() -> None:
    policy = DEFAULT_SPACE_ROUTING_POLICY

    contributions = policy.score_contributions(
        cluster=0.5,
        lexical=0.5,
        metadata=0.5,
        policy_boost=0.0,
    )
    assert contributions == {
        "cluster": pytest.approx(0.31),
        "lexical": pytest.approx(0.10),
        "metadata": pytest.approx(0.09),
        "policy": 0.0,
    }
    assert sum(contributions.values()) == pytest.approx(
        policy.combined_score(
            cluster=0.5,
            lexical=0.5,
            metadata=0.5,
            policy_boost=0.0,
        ),
    )

    capped = policy.score_contributions(
        cluster=1.0,
        lexical=1.0,
        metadata=1.0,
        policy_boost=policy.policy_boost,
    )
    assert sum(capped.values()) == pytest.approx(1.0)


def test_routing_policy_selects_route_method_from_thresholds() -> None:
    policy = DEFAULT_SPACE_ROUTING_POLICY

    assert policy.select_method(
        eligible_space_count=0,
        second_score=0.0,
        space_count=0,
        top_score=0.0,
    ) == SpaceRouteMethod.NO_SPACES
    assert policy.select_method(
        eligible_space_count=0,
        second_score=0.0,
        space_count=2,
        top_score=0.0,
    ) == SpaceRouteMethod.NO_AUTO_ROUTE_SPACES
    assert policy.select_method(
        eligible_space_count=2,
        second_score=0.0,
        space_count=2,
        top_score=policy.low_confidence_threshold - 0.001,
    ) == SpaceRouteMethod.ALL_LOW_SAFE_BROADENING
    assert policy.select_method(
        eligible_space_count=2,
        second_score=0.10,
        space_count=2,
        top_score=0.10 + policy.dominant_gap_threshold,
    ) == SpaceRouteMethod.DOMINANT_CLUSTER
    assert policy.select_method(
        eligible_space_count=2,
        second_score=0.20,
        space_count=2,
        top_score=0.20 + policy.dominant_gap_threshold - 0.001,
    ) == SpaceRouteMethod.MULTI_SPACE_CLUSTER_MATCH


def test_routing_policy_explains_route_method_selection() -> None:
    policy = DEFAULT_SPACE_ROUTING_POLICY

    low = policy.select_decision(
        eligible_space_count=2,
        requested_limit=3,
        second_score=0.0,
        space_count=2,
        top_score=policy.low_confidence_threshold - 0.001,
    )
    assert low.method == SpaceRouteMethod.ALL_LOW_SAFE_BROADENING
    assert "Top score 5.9%" in low.reason
    assert "6% confidence floor" in low.reason
    assert "confidence floor" in low.reason
    assert "highest-ranked eligible Spaces remain in scope" in low.reason
    assert "capped at 2" in low.reason

    dominant = policy.select_decision(
        eligible_space_count=2,
        requested_limit=3,
        second_score=0.10,
        space_count=2,
        top_score=0.10 + policy.dominant_gap_threshold,
    )
    assert dominant.method == SpaceRouteMethod.DOMINANT_CLUSTER
    assert "dominant gap" in dominant.reason
    assert "narrowed to one Space" in dominant.reason

    multi = policy.select_decision(
        eligible_space_count=2,
        requested_limit=3,
        second_score=0.20,
        space_count=2,
        top_score=0.20 + policy.dominant_gap_threshold - 0.001,
    )
    assert multi.method == SpaceRouteMethod.MULTI_SPACE_CLUSTER_MATCH
    assert "21.9%" in multi.reason
    assert "22% dominant gap" in multi.reason
    assert "below the" in multi.reason
    assert "highest-ranked Spaces" in multi.reason
    assert "capped at 2" in multi.reason

    single_limit = policy.select_decision(
        eligible_space_count=2,
        requested_limit=1,
        second_score=0.20,
        space_count=2,
        top_score=0.20 + policy.dominant_gap_threshold - 0.001,
    )
    assert "capped at 1" in single_limit.reason
