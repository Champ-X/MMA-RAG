from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from nexus.bootstrap import NexusContainer
from nexus.modules.sources.application import IngestionService
from nexus.shared.domain.enums import Modality


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("scan.bmp", Modality.IMAGE),
        ("recording.aac", Modality.AUDIO),
        ("archive.wma", Modality.AUDIO),
        ("clip.flv", Modality.VIDEO),
        ("clip.wmv", Modality.VIDEO),
        ("clip.m4v", Modality.VIDEO),
    ],
)
def test_legacy_media_extensions_are_classified_without_reliable_mime(
    filename: str,
    expected: Modality,
) -> None:
    assert IngestionService.classify_modality(filename, "application/octet-stream") == expected


def test_legacy_xls_is_routed_to_a_real_table_parser(
    nexus: NexusContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeSheet:
        name = "Legacy"
        nrows = 3
        ncols = 2
        values = [["Metric", "Value"], ["budget", 42.0], ["headcount", 64.0]]

        def cell_value(self, row: int, column: int) -> object:
            return self.values[row][column]

    class FakeWorkbook:
        @staticmethod
        def sheet_names() -> list[str]:
            return ["Legacy"]

        @staticmethod
        def sheet_by_name(_name: str) -> FakeSheet:
            return FakeSheet()

        @staticmethod
        def release_resources() -> None:
            return None

    fake_xlrd = SimpleNamespace(open_workbook=lambda **_kwargs: FakeWorkbook())
    monkeypatch.setitem(sys.modules, "xlrd", fake_xlrd)
    space = nexus.spaces.create(name="Legacy spreadsheet", slug="legacy-spreadsheet")

    result = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="budget.xls",
        content=b"legacy-biff-workbook",
        mime_type="application/vnd.ms-excel",
    )

    assert result.job.status == "completed"
    assert result.source_version.modality == Modality.TABLE
    evidence, _ = nexus.control_plane.list_evidence(
        space_id=space.id,
        source_id=result.source_version.source_id,
        modality=Modality.TABLE,
        cursor=None,
        limit=20,
    )
    assert len(evidence) == 4
    assert any("budget | 42" in item.text_content for item in evidence)
    value_profile = next(
        item
        for item in evidence
        if item.evidence_type == "table_column_profile"
        and item.locator.extra["column_name"] == "Value"
    )
    assert value_profile.locator.extra["data_type"] == "numeric"
    assert "min 42" in value_profile.text_content
    assert all(item.locator.locator_type == "cell_range" for item in evidence)
