from __future__ import annotations

from fastapi.testclient import TestClient


def test_streamable_http_mcp_lifecycle_and_scoped_search(api: TestClient) -> None:
    initialized = api.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "contract", "version": "1"},
            },
        },
    )
    assert initialized.status_code == 200
    assert initialized.json()["result"]["protocolVersion"] == "2025-11-25"
    assert initialized.json()["result"]["capabilities"] == {"tools": {}, "resources": {}}

    tools = api.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    ).json()["result"]["tools"]
    assert {tool["name"] for tool in tools} == {
        "knowledge_search",
        "open_evidence",
        "list_sources",
        "compare_versions",
    }
    assert all(tool["annotations"]["readOnlyHint"] for tool in tools)

    space = api.post("/api/v1/spaces", json={"name": "MCP Scope"}).json()
    upload = api.post(
        "/api/v1/sources/upload",
        data={"space_id": space["id"]},
        files={"file": ("mcp.md", b"# MCP\n\nScoped evidence value is 42.", "text/markdown")},
    )
    assert upload.status_code == 202
    searched = api.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "knowledge_search",
                "arguments": {
                    "query": "Scoped evidence 42",
                    "space_ids": [space["id"]],
                },
            },
        },
    ).json()
    assert searched["result"]["isError"] is False
    assert searched["result"]["structuredContent"]["hits"]


def test_mcp_rejects_browser_origin_outside_allowlist(api: TestClient) -> None:
    response = api.post(
        "/mcp",
        headers={"Origin": "https://attacker.invalid"},
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
    )
    assert response.status_code == 403
