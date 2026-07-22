from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class SpaceRouteMethod(StrEnum):
    NO_SPACES = "no_spaces"
    NO_AUTO_ROUTE_SPACES = "no_auto_route_spaces"
    ALL_LOW_SAFE_BROADENING = "all_low_safe_broadening"
    DOMINANT_CLUSTER = "dominant_cluster"
    MULTI_SPACE_CLUSTER_MATCH = "multi_space_cluster_match"


@dataclass(frozen=True, slots=True)
class SpaceRouteDecision:
    method: SpaceRouteMethod
    reason: str


@dataclass(frozen=True, slots=True)
class SpaceRoutingPolicy:
    cluster_weight: float = 0.62
    metadata_weight: float = 0.18
    lexical_weight: float = 0.20
    policy_boost: float = 0.08
    low_confidence_threshold: float = 0.06
    dominant_gap_threshold: float = 0.22
    multi_space_relative_floor: float = 0.58
    max_selected_spaces: int = 2
    cluster_decay: float = 0.85
    max_cluster_scores: int = 5

    @property
    def base_weight_total(self) -> float:
        return self.cluster_weight + self.metadata_weight + self.lexical_weight

    def weighted_cluster_score(self, cluster_scores: list[float]) -> float:
        selected = cluster_scores[: self.max_cluster_scores]
        if not selected:
            return 0.0
        weights = [self.cluster_decay**index for index in range(len(selected))]
        return sum(score * weight for score, weight in zip(selected, weights, strict=True)) / sum(weights)

    def combined_score(
        self,
        *,
        cluster: float,
        lexical: float,
        metadata: float,
        policy_boost: float,
    ) -> float:
        return min(
            1.0,
            self.cluster_weight * cluster
            + self.metadata_weight * metadata
            + self.lexical_weight * lexical
            + policy_boost,
        )

    def score_contributions(
        self,
        *,
        cluster: float,
        lexical: float,
        metadata: float,
        policy_boost: float,
    ) -> dict[str, float]:
        contributions = {
            "cluster": self.cluster_weight * cluster,
            "lexical": self.lexical_weight * lexical,
            "metadata": self.metadata_weight * metadata,
            "policy": policy_boost,
        }
        total = sum(contributions.values())
        if total > 1.0:
            scale = 1.0 / total
            return {key: value * scale for key, value in contributions.items()}
        return contributions

    def selected_space_limit(self, requested_limit: int) -> int:
        return max(1, min(requested_limit, self.max_selected_spaces))

    def select_method(
        self,
        *,
        eligible_space_count: int,
        second_score: float,
        space_count: int,
        top_score: float,
    ) -> SpaceRouteMethod:
        if space_count == 0:
            return SpaceRouteMethod.NO_SPACES
        if eligible_space_count == 0:
            return SpaceRouteMethod.NO_AUTO_ROUTE_SPACES
        if top_score < self.low_confidence_threshold:
            return SpaceRouteMethod.ALL_LOW_SAFE_BROADENING
        if top_score - second_score >= self.dominant_gap_threshold:
            return SpaceRouteMethod.DOMINANT_CLUSTER
        return SpaceRouteMethod.MULTI_SPACE_CLUSTER_MATCH

    def select_decision(
        self,
        *,
        eligible_space_count: int,
        requested_limit: int,
        second_score: float,
        space_count: int,
        top_score: float,
    ) -> SpaceRouteDecision:
        method = self.select_method(
            eligible_space_count=eligible_space_count,
            second_score=second_score,
            space_count=space_count,
            top_score=top_score,
        )
        gap = max(0.0, top_score - second_score)
        selected_limit = self.selected_space_limit(requested_limit)
        if method == SpaceRouteMethod.NO_SPACES:
            reason = "No Spaces exist yet, so automatic routing cannot choose a scope."
        elif method == SpaceRouteMethod.NO_AUTO_ROUTE_SPACES:
            reason = "All available Spaces are manual-scope only; choose an explicit Space to search them."
        elif method == SpaceRouteMethod.ALL_LOW_SAFE_BROADENING:
            reason = (
                f"Top score {_percent(top_score)} is below the "
                f"{_percent(self.low_confidence_threshold)} confidence floor; "
                f"the highest-ranked eligible Spaces remain in scope, "
                f"capped at {selected_limit}."
            )
        elif method == SpaceRouteMethod.DOMINANT_CLUSTER:
            reason = (
                f"Top candidate leads by {_percent(gap)}, meeting the "
                f"{_percent(self.dominant_gap_threshold)} dominant gap; "
                "the route is narrowed to one Space."
            )
        else:
            reason = (
                f"Top candidate leads by {_percent(gap)}, below the "
                f"{_percent(self.dominant_gap_threshold)} dominant gap; "
                f"the highest-ranked Spaces scoring at least "
                f"{_percent(self.multi_space_relative_floor)} of the leader remain "
                f"in scope, capped at {selected_limit}."
            )
        return SpaceRouteDecision(method=method, reason=reason)


DEFAULT_SPACE_ROUTING_POLICY = SpaceRoutingPolicy()


def _percent(value: float) -> str:
    percent = round(value * 100, 1)
    if percent.is_integer():
        return f"{int(percent)}%"
    return f"{percent:.1f}%"
