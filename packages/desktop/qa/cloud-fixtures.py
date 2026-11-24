"""Explicit, metered acceptance of the two generated fixtures. Use an isolated workspace."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

from dotenv import dotenv_values
import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("runtime", "fixtures", "credential-env", "output"):
        parser.add_argument("--" + key, type=Path, required=True)
    parser.add_argument("--model-cache", type=Path)
    parser.add_argument("--allow-metered-fixtures", action="store_true", required=True)
    args = parser.parse_args()
    runtime = args.runtime.resolve(strict=True)
    files = args.fixtures.resolve(strict=True)
    frozen = json.loads((files / "manifest.json").read_text("utf-8"))
    for name in ("manual.pdf", "recording.mp4"):
        row = next(i for i in frozen["files"] if i["path"] == name)
        assert row["bytes"] < 2_000_000 and hashlib.sha256((files / name).read_bytes()).hexdigest() == row["sha256"]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    workspace = Path(tempfile.mkdtemp(dir=output, prefix="workspace-"))
    identity = str(uuid4())
    (workspace / "workspace.json").write_text(json.dumps({"format": 1, "id": identity}))
    if args.model_cache:
        hub = workspace / "state/models/huggingface/hub"
        hub.mkdir(parents=True)
        for name in ("models--BAAI--bge-m3", "models--openai--clip-vit-large-patch14", "models--laion--clap-htsat-fused"):
            src = args.model_cache.resolve() / "hub" / name
            if sys.platform == "darwin":
                subprocess.run(["/bin/cp", "-cR", str(src), str(hub / name)], check=True)
            else:
                import shutil
                shutil.copytree(src, hub / name, symlinks=True)
    env = {k: v for k, v in os.environ.items() if k.lower() in {
        "home", "path", "tmpdir", "tmp", "temp", "lang", "https_proxy", "http_proxy", "all_proxy", "no_proxy",
        "systemroot", "userprofile", "localappdata", "appdata", "windir"}}
    py = runtime / json.loads((runtime / "runtime.json").read_text())["executables"]["python"]
    host = subprocess.Popen([py, "-E", "-s", "-B", runtime / "backend/desktop_host.py"], cwd=runtime,
                            env=env, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    report = {"fixtureHashes": {r["path"]: r["sha256"] for r in frozen["files"] if r["path"] in ("manual.pdf", "recording.mp4")}, "ingestion": {}, "answers": {}}
    def record():
        (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        host.stdin.write(json.dumps({"workspaceDir": str(workspace)}) + "\n")
        host.stdin.flush()
        for line in host.stdout:
            event = json.loads(line)
            if event["phase"] == "ready":
                break
            if event["phase"] == "error":
                raise RuntimeError(event["message"])
        assert event["phase"] == "ready"
        with httpx.Client(base_url=event["url"], headers={"authorization": "Bearer " + event["token"],
                          "x-tessmora-setup-token": event["token"]}, trust_env=False, timeout=300) as client:
            values = dotenv_values(args.credential_env, interpolate=False)
            credentials = {provider: values[name] for provider, name in (
                ("siliconflow","SILICONFLOW_API_KEY"), ("deepseek","DEEPSEEK_API_KEY"), ("aliyun_bailian","ALIYUN_BAILIAN_API_KEY")
            ) if values.get(name)}
            draft = {"capabilities": ["text", "video"], "credentials": credentials}
            tested = client.post("/api/setup/test", json=draft).raise_for_status().json()
            report["connectionChecks"] = [{k: r[k] for k in ("task", "model", "provider", "success", "capability") if k in r}
                                          for r in tested["results"]]
            record()
            if not tested["success"]:
                raise RuntimeError("Configured model connection checks did not all pass")
            client.post("/api/setup/config", json={**draft, "test_receipt": tested["test_receipt"]}).raise_for_status()
            client.post("/api/setup/prepare", json={"capabilities": draft["capabilities"]}).raise_for_status()
            until = time.monotonic() + 600
            while time.monotonic() < until:
                state = client.get("/api/setup/status").raise_for_status().json()
                if state["ready"]:
                    break
                if state["progress"]["state"] in ("error","interrupted"):
                    raise RuntimeError("Model preparation " + state["progress"]["state"])
                time.sleep(2)
            assert state["ready"]
            for name, question in (("manual.pdf", "What recovery code is printed in the manual? Cite its page."),
                                   ("recording.mp4", "What color is the rectangle in the recording, and at what time does it appear? Cite the video segment.")):
                kb = client.post("/api/knowledge/", json={"name": "Synthetic " + name}).raise_for_status().json()["id"]
                with (files / name).open("rb") as src:
                    receipt = client.post("/api/upload/batch/start", data={"kb_id":kb}, files={"files": (name, src)}).raise_for_status().json()
                assert receipt["accepted_count"] == 1
                job = receipt["results"][0]["processing_id"]
                until = time.monotonic() + 600
                while time.monotonic() < until:
                    jobstate = client.get("/api/upload/progress/" + job).raise_for_status().json()
                    summary = {k: jobstate.get(k) for k in ("status","stage","error_code","file_id","file_type")}
                    if report["ingestion"].get(name) != summary:
                        report["ingestion"][name] = summary
                        record()
                    if jobstate.get("status") in ("completed", "failed", "cancelled"):
                        break
                    time.sleep(2)
                if jobstate.get("status") != "completed":
                    continue
                answer = client.post("/api/chat/message", json={"message":question, "knowledgeBaseIds":[kb], "agentMode":"direct", "language":"en-US"}).raise_for_status().json()
                citations = answer.get("citations", [])
                # Keep source identity/locators only, never expiring media signatures.
                safe = []
                for citation in citations:
                    meta = {**(citation.get("metadata") or {}), **(citation.get("debug_info") or {}), **citation}
                    safe.append({k: meta[k] for k in ("id", "file_id", "file_name", "kb_id", "page", "page_number", "page_end",
                                 "start_sec", "end_sec", "shot_start_time", "shot_end_time", "type") if k in meta})
                # Reopen the original by its durable file ID, independently of the generated answer.
                from urllib.parse import quote
                original = client.get(f"/api/knowledge/{quote(kb, safe='')}/files/{quote(jobstate['file_id'], safe='')}/stream").raise_for_status()
                hash_matches = hashlib.sha256(original.content).digest() == hashlib.sha256((files / name).read_bytes()).digest()
                report["answers"][name] = {"text":answer.get("message"), "model":answer.get("metadata",{}).get("model_used"),
                                            "citations":safe, "originalHashMatches":hash_matches,
                                            "hasExpectedText": ("cedar-17" if name.endswith("pdf") else "blue") in str(answer.get("message","")).lower()}
                record()
    finally:
        host.stdin.close()
        host.wait(timeout=90)
        setup = workspace / "state/setup.json"
        if setup.is_file():
            saved = json.loads(setup.read_text())
            if saved.get("credential_ref"):
                if sys.platform == "darwin":
                    from keyring.backends.macOS import Keyring
                else:
                    from keyring.backends.Windows import WinVaultKeyring as Keyring
                Keyring().delete_password("Tessmora/" + identity, saved["credential_ref"])
                saved.pop("credential_ref")
                setup.write_text(json.dumps(saved))
        record()
    assert len(report["answers"]) == 2 and all(row["hasExpectedText"] and row["citations"] and row["originalHashMatches"] for row in report["answers"].values()), "Some answer or citation gates failed; see report"


if __name__ == "__main__":
    main()
