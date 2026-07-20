from __future__ import annotations

import ast
import json
from pathlib import Path

from nexus.api import create_app

FORBIDDEN_DOMAIN_IMPORTS = (
    "fastapi",
    "sqlalchemy",
    "qdrant_client",
    "langgraph",
    "celery",
    "minio",
)


def test_domain_modules_do_not_import_adapters_or_frameworks() -> None:
    root = Path(__file__).parents[2] / "src" / "nexus"
    domain_files = [
        *root.glob("modules/*/domain.py"),
        *root.glob("modules/*/ports.py"),
        *root.glob("shared/domain/*.py"),
    ]
    violations: list[str] = []
    for path in domain_files:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.append(node.module)
            for name in names:
                if name.startswith(FORBIDDEN_DOMAIN_IMPORTS) or name.startswith(
                    "nexus.infrastructure"
                ):
                    violations.append(f"{path.relative_to(root)}:{node.lineno}:{name}")
    assert not violations, "\n".join(violations)


def test_committed_openapi_matches_application_contract() -> None:
    contract = Path(__file__).parents[3] / "contracts" / "openapi" / "nexus-v1.json"
    expected = json.loads(contract.read_text(encoding="utf-8"))
    assert create_app().openapi() == expected


def test_legacy_runtime_and_static_contract_are_removed() -> None:
    root = Path(__file__).parents[3]
    assert not (root / "backend" / "app").exists()
    assert not (root / "static").exists()
    assert not (root / "qdrant_config.yaml").exists()
