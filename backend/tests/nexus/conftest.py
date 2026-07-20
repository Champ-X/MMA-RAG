from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nexus.api import create_app
from nexus.bootstrap import NexusContainer, build_container
from nexus.config import NexusSettings


@pytest.fixture
def nexus(tmp_path: Path) -> Iterator[NexusContainer]:
    container = build_container(NexusSettings.for_test(tmp_path))
    try:
        yield container
    finally:
        container.database.engine.dispose()


@pytest.fixture
def api(nexus: NexusContainer) -> Iterator[TestClient]:
    with TestClient(create_app(container=nexus)) as client:
        yield client
