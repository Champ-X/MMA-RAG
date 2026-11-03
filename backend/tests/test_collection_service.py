import asyncio
import subprocess
import sys
from types import SimpleNamespace

import pytest

from app.modules.collection.models import CreateRun
from app.modules.collection.service import CollectionService
from app.modules.collection.store import CollectionConflict, CollectionNotFound, CollectionStore
from app.modules.ingestion.sources.base import ContentSourceResult


class Providers:
    def __init__(self):
        self.fetches = []
        self.searches = []
        self.content = b"source content"

    def capabilities(self):
        return {"tavily": {"available": True, "configured": True, "kinds": ["webpage"]}}

    async def discover(self, query, limit):
        self.searches.append(query)
        return [{"title": "material", "url": "https://example.com/material", "source": "tavily", "kind": "webpage"}]

    async def fetch_candidate(self, candidate, max_bytes):
        self.fetches.append(candidate["url"])
        return ContentSourceResult(self.content, "material.md")


class Planner:
    async def plan_request(self, prompt, max_items, channels):
        return {"summary": "寻找资料", "queries": [{"channel": "tavily", "query": prompt}]}

    async def rank_candidates(self, prompt, candidates, limit):
        return [{**item, "selection_reason": "相关候选"} for item in candidates[:limit]]


class Bridge:
    def __init__(self):
        self.ingests = []
        self.receipts = {}
        self.complete = True
        self.cancels = []

    def ingestion_ids(self, kb_id, item_id):
        return f"file-{item_id}", f"processing-{item_id}"

    async def ingest_item(self, content, kb_id, item_id, provenance):
        self.ingests.append((kb_id, item_id, provenance))
        file_id, processing_id = self.ingestion_ids(kb_id, item_id)
        result = {"status": "completed" if self.complete else "processing", "file_id": file_id, "processing_id": processing_id}
        self.receipts[file_id] = result
        return result

    async def inspect_ingestion(self, kb_id, file_id, processing_id):
        return self.receipts.get(file_id, {"status": "not_found"})

    async def cancel_ingestion(self, kb_id, processing_id):
        self.cancels.append(processing_id)


def service(tmp_path, **kwargs):
    providers, planner, bridge = Providers(), Planner(), Bridge()
    host = CollectionService(CollectionStore(tmp_path / "runs.db"), providers=providers, planner=planner,
                             bridge=bridge, kb_check=lambda kb: kb == "kb", poll_interval=.001, **kwargs)
    return host, providers, bridge


async def settle(host, run_id):
    if run_id in host.jobs:
        await host.jobs[run_id]
    await asyncio.sleep(0)
    return await host.get(run_id)


def request(key="request-0001", prompt="https://example.com/material", mode="auto", **kwargs):
    return CreateRun(kb_id="kb", prompt=prompt, mode=mode, client_request_id=key, **kwargs)


@pytest.mark.asyncio
async def test_review_discovers_but_does_not_download_and_rejects_foreign_selection(tmp_path):
    host, providers, bridge = service(tmp_path)
    run = await host.create(request(mode="review", prompt="查找相关材料"))
    run = await settle(host, run["id"])
    assert run["status"] == "review"
    assert providers.searches and not providers.fetches and not bridge.ingests
    with pytest.raises(CollectionConflict):
        await host.collect(run["id"], ["another-run-item"])
    await host.collect(run["id"], [run["candidates"][0]["id"]])
    done = await settle(host, run["id"])
    assert done["counts"]["ready"] == 1
    assert done["status"] == "completed"


@pytest.mark.asyncio
async def test_direct_url_bypasses_planner_and_request_replay_does_not_write_twice(tmp_path):
    host, providers, bridge = service(tmp_path)
    run = await host.create(request())
    done = await settle(host, run["id"])
    assert done["status"] == "completed"
    assert not providers.searches
    assert (await host.create(request()))["id"] == run["id"]
    assert len(bridge.ingests) == 1


@pytest.mark.asyncio
async def test_url_and_content_duplicates_do_not_repeat_ingestion(tmp_path):
    host, providers, bridge = service(tmp_path)
    first = await host.create(request())
    await settle(host, first["id"])
    duplicate = await host.create(request(key="request-0002", prompt="https://example.com/material?utm_source=new"))
    duplicate = await settle(host, duplicate["id"])
    assert duplicate["counts"]["duplicate"] == 1
    assert len(providers.fetches) == 1
    same_content = await host.create(request(key="request-0003", prompt="https://example.com/another"))
    same_content = await settle(host, same_content["id"])
    assert same_content["counts"]["duplicate"] == 1
    assert len(providers.fetches) == 2
    assert len(bridge.ingests) == 1


@pytest.mark.asyncio
async def test_pending_ingestion_is_not_reported_ready_and_retry_reuses_receipt(tmp_path):
    host, providers, bridge = service(tmp_path, processing_timeout=.002)
    bridge.complete = False
    run = await host.create(request())
    run = await settle(host, run["id"])
    assert run["status"] == "interrupted"
    assert run["counts"]["ready"] == 0
    file_id = run["candidates"][0]["file_id"]
    bridge.receipts[file_id]["status"] = "completed"
    await host.retry(run["id"])
    done = await settle(host, run["id"])
    assert done["status"] == "completed"
    assert done["counts"]["ready"] == 1
    assert len(bridge.ingests) == len(providers.fetches) == 1


@pytest.mark.asyncio
async def test_scope_and_download_budget_are_enforced(tmp_path):
    host, providers, bridge = service(tmp_path, max_total_bytes=3)
    with pytest.raises(CollectionNotFound):
        await host.create(request().model_copy(update={"kb_id": "missing"}))
    run = await host.create(request())
    run = await settle(host, run["id"])
    assert run["status"] == "failed"
    assert run["counts"]["failed"] == 1
    assert not bridge.ingests


@pytest.mark.asyncio
async def test_cancellation_stops_processing_and_keeps_stable_receipts(tmp_path):
    host, providers, bridge = service(tmp_path)
    bridge.complete = False
    run = await host.create(request())
    for _ in range(100):
        if bridge.ingests:
            break
        await asyncio.sleep(.001)
    cancelled = await host.cancel(run["id"])
    assert cancelled["status"] == "cancelled"
    assert cancelled["counts"]["ready"] == 0
    assert cancelled["candidates"][0]["file_id"]
    assert bridge.cancels


@pytest.mark.asyncio
async def test_restart_reconciles_persisted_ingestion_before_any_new_write(tmp_path):
    host, providers, bridge = service(tmp_path, processing_timeout=.002)
    bridge.complete = False
    run = await host.create(request())
    run = await settle(host, run["id"])
    await host.shutdown()
    reopened = CollectionService(CollectionStore(tmp_path / "runs.db"), providers=providers, planner=Planner(),
                                 bridge=bridge, kb_check=lambda _: True, poll_interval=.001)
    bridge.receipts[run["candidates"][0]["file_id"]]["status"] = "completed"
    await reopened.retry(run["id"])
    completed = await settle(reopened, run["id"])
    assert completed["counts"]["ready"] == 1
    assert len(bridge.ingests) == 1


@pytest.mark.asyncio
async def test_empty_search_uses_another_available_channel_within_budget(tmp_path):
    host, providers, bridge = service(tmp_path)
    providers.capabilities = lambda: {
        "pixabay": {"available": True, "kinds": ["image"]},
        "internet_archive": {"available": True, "kinds": ["image"]}}

    async def plan(*args):
        return {"queries": [{"channel": "pixabay", "kind": "image", "query": "plants"}], "target_count": 1}

    async def discover(query, limit):
        providers.searches.append(query)
        return [] if query["channel"] == "pixabay" else [{"title": "Plant", "url": "https://example.com/plant.png", "source": "internet_archive", "kind": "image"}]

    host.planner.plan_request = plan
    providers.discover = discover
    run = await host.create(request(prompt="找植物图片", mode="review"))
    run = await settle(host, run["id"])
    assert run["status"] == "review"
    assert [q["channel"] for q in providers.searches] == ["pixabay", "internet_archive"]
    assert len(run["plan"]["queries"]) == 2
    assert any("补充搜索" in warning for warning in run["warnings"])


@pytest.mark.asyncio
async def test_no_relevant_ranked_candidates_is_typed_and_does_not_import(tmp_path):
    host, providers, bridge = service(tmp_path)

    async def irrelevant(*args):
        return []

    host.planner.rank_candidates = irrelevant
    run = await host.create(request(prompt="找素材"))
    run = await settle(host, run["id"])
    assert run["status"] == "failed"
    assert run["error_code"] == "no_relevant_results"
    assert not providers.fetches and not bridge.ingests


@pytest.mark.asyncio
async def test_previous_failed_write_is_not_counted_as_a_successful_duplicate(tmp_path):
    host, providers, bridge = service(tmp_path)
    first = await host.create(request())
    first = await settle(host, first["id"])
    bridge.receipts[first["candidates"][0]["file_id"]]["status"] = "failed"
    second = await host.create(request(key="request-0002"))
    second = await settle(host, second["id"])
    assert second["status"] == "failed"
    assert second["counts"]["duplicate"] == 0
    assert second["candidates"][0]["error_code"] == "duplicate_unavailable"
    assert len(bridge.ingests) == 1


@pytest.mark.asyncio
async def test_deleted_duplicate_can_be_collected_again(tmp_path):
    host, providers, bridge = service(tmp_path)
    first = await host.create(request())
    first = await settle(host, first["id"])
    bridge.receipts[first["candidates"][0]["file_id"]]["status"] = "deleted"
    second = await host.create(request(key="request-0002"))
    second = await settle(host, second["id"])
    assert second["status"] == "completed"
    assert second["counts"]["ready"] == 1
    assert len(bridge.ingests) == 2


@pytest.mark.asyncio
async def test_candidate_and_download_warnings_survive_into_public_state(tmp_path):
    host, providers, bridge = service(tmp_path)

    async def rank(prompt, candidates, limit):
        return [{**c, "warnings": ["智能筛选暂不可用"], "selection_reason": "搜索结果顺序"} for c in candidates]

    async def fetch(candidate, max_bytes):
        return ContentSourceResult(b"source", "source.md", meta={"warnings": ["内嵌图片未下载"], "kind": "file"})

    host.planner.rank_candidates = rank
    providers.fetch_candidate = fetch
    run = await host.create(request(prompt="找素材", max_items=1))
    run = await settle(host, run["id"])
    assert run["candidates"][0]["warnings"] == ["智能筛选暂不可用", "内嵌图片未下载"]
    assert run["candidates"][0]["kind"] == "file"
    assert run["warnings"] == ["智能筛选暂不可用", "内嵌图片未下载"]


@pytest.mark.asyncio
async def test_requested_quantity_shortfall_is_partial(tmp_path):
    host, providers, bridge = service(tmp_path)

    async def plan(*args):
        return {"queries": [{"channel": "tavily", "query": "plants"}], "target_count": 2}

    host.planner.plan_request = plan
    run = await host.create(request(prompt="找2份资料", max_items=5))
    run = await settle(host, run["id"])
    assert run["status"] == "partial"
    assert run["counts"]["ready"] == 1
    assert "尚缺 1 项" in run["message"]
    with pytest.raises(CollectionConflict, match="调整需求后重新查找"):
        await host.retry(run["id"])
    assert run["id"] not in host.jobs
    assert len(bridge.ingests) == 1


@pytest.mark.asyncio
async def test_shutdown_settles_owned_ingestion_and_preserves_resumable_receipt(tmp_path):
    host, providers, bridge = service(tmp_path)
    bridge.complete = False
    run = await host.create(request())
    for _ in range(100):
        if bridge.ingests:
            break
        await asyncio.sleep(.001)
    await host.shutdown()
    interrupted = await host.get(run["id"])
    assert interrupted["status"] == "interrupted"
    assert interrupted["candidates"][0]["error_code"] == "host_stopped"
    assert interrupted["candidates"][0]["file_id"]
    assert bridge.cancels


@pytest.mark.asyncio
async def test_second_supervisor_cannot_recover_live_runs_and_shutdown_releases_ownership(tmp_path):
    host, providers, bridge = service(tmp_path)
    run, _ = host.store.create(request().model_dump())
    host.store.update(run["id"], status="collecting")
    with pytest.raises(CollectionConflict, match="单个 API worker"):
        CollectionService(CollectionStore(tmp_path / "runs.db"), providers=providers, planner=Planner(),
                          bridge=bridge, kb_check=lambda _: True)
    child = subprocess.run([sys.executable, "-c", """
import sys
from app.modules.collection.store import CollectionStore, CollectionConflict
from app.modules.collection.service import CollectionService
try:
    CollectionService(CollectionStore(sys.argv[1]))
except CollectionConflict:
    sys.exit(0)
sys.exit(1)
""", str(tmp_path / "runs.db")], capture_output=True, text=True, timeout=10)
    assert child.returncode == 0, child.stderr
    assert host.store.get(run["id"])["status"] == "collecting"
    await host.shutdown()
    second = CollectionService(CollectionStore(tmp_path / "runs.db"), providers=providers, planner=Planner(),
                               bridge=bridge, kb_check=lambda _: True)
    assert second.store.get(run["id"])["status"] == "interrupted"
    await second.shutdown()


@pytest.mark.asyncio
async def test_download_budget_charges_raw_html_instead_of_extracted_markdown(tmp_path):
    host, providers, bridge = service(tmp_path, max_total_bytes=10)

    async def fetch(candidate, max_bytes):
        providers.fetches.append(max_bytes)
        return ContentSourceResult(b"x", "page.md", meta={"download_bytes": 10})

    providers.fetch_candidate = fetch
    run = await host.create(request(prompt="https://example.com/first https://example.com/second"))
    run = await settle(host, run["id"])
    assert run["status"] == "partial"
    assert run["counts"]["ready"] == 1
    assert run["counts"]["failed"] == 1
    assert providers.fetches == [10]
    assert host.store.get(run["id"])["_bytes"] == 10


@pytest.mark.asyncio
async def test_failed_download_bytes_reduce_next_item_budget_and_survive_retry(tmp_path):
    from app.modules.collection.providers import CollectionProviderError
    host, providers, bridge = service(tmp_path, max_total_bytes=10)

    async def fetch(candidate, max_bytes):
        providers.fetches.append(max_bytes)
        if len(providers.fetches) == 1:
            error = CollectionProviderError("download_failed", "下载中断")
            error.downloaded_bytes = 8
            raise error
        return ContentSourceResult(b"x", "page.md", meta={"download_bytes": 2})

    providers.fetch_candidate = fetch
    run = await host.create(request(prompt="https://example.com/first https://example.com/second"))
    run = await settle(host, run["id"])
    assert run["status"] == "partial"
    assert providers.fetches == [10, 2]
    assert host.store.get(run["id"])["_bytes"] == 10
    await host.retry(run["id"])
    retried = await settle(host, run["id"])
    assert retried["counts"]["failed"] == 1
    assert providers.fetches == [10, 2]
    assert host.store.get(run["id"])["_bytes"] == 10


@pytest.mark.asyncio
async def test_staged_payload_retry_does_not_charge_download_budget_twice(tmp_path):
    host, providers, bridge = service(tmp_path, max_total_bytes=10, processing_timeout=.002)
    bridge.complete = False

    async def fetch(candidate, max_bytes):
        providers.fetches.append(max_bytes)
        return ContentSourceResult(b"x", "page.md", meta={"download_bytes": 10})

    providers.fetch_candidate = fetch
    run = await host.create(request())
    run = await settle(host, run["id"])
    bridge.receipts[run["candidates"][0]["file_id"]]["status"] = "failed"
    bridge.complete = True
    await host.retry(run["id"])
    retried = await settle(host, run["id"])
    assert retried["counts"]["ready"] == 1
    assert providers.fetches == [10]
    assert host.store.get(run["id"])["_bytes"] == 10


@pytest.mark.asyncio
async def test_cancelled_download_consumption_is_persisted(tmp_path):
    host, providers, bridge = service(tmp_path, max_total_bytes=10)
    started = asyncio.Event()

    async def fetch(candidate, max_bytes):
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError as error:
            error.downloaded_bytes = 6
            raise

    providers.fetch_candidate = fetch
    run = await host.create(request())
    await asyncio.wait_for(started.wait(), 1)
    cancelled = await host.cancel(run["id"])
    assert cancelled["status"] == "cancelled"
    assert host.store.get(run["id"])["_bytes"] == 6
    assert not bridge.ingests


@pytest.mark.asyncio
async def test_seeded_public_page_works_without_search_api_and_uses_observed_resource(tmp_path):
    host, providers, bridge = service(tmp_path, max_total_bytes=20)
    providers.capabilities = lambda: {"open_web": {"available": True, "kinds": ["webpage", "document"]}}

    async def plan(*args):
        return {"queries": [], "target_count": 1}

    async def discover(query, limit):
        providers.searches.append(query)
        return [{"title": "Research paper", "url": "https://independent.example/papers", "download_url": "https://independent.example/paper.pdf",
                 "source": "open_web", "kind": "document", "_discovery_bytes": 8}]

    async def fetch(candidate, max_bytes):
        providers.fetches.append((candidate["download_url"], max_bytes))
        return ContentSourceResult(b"%PDF-1.7\n", "paper.pdf", "application/pdf", meta={"download_bytes": 9})

    host.planner.plan_request = plan
    providers.discover, providers.fetch_candidate = discover, fetch
    run = await host.create(request(prompt="从 https://independent.example/papers 帮我找一份论文"))
    run = await settle(host, run["id"])
    assert run["status"] == "completed"
    assert providers.searches[0]["seed_urls"] == ["https://independent.example/papers"]
    assert providers.searches[0]["_remaining_bytes"] == 20
    assert providers.fetches == [("https://independent.example/paper.pdf", 12)]
    assert host.store.get(run["id"])["_bytes"] == 17
    assert host.store.get(run["id"])["_discovery_bytes"] == 8


@pytest.mark.asyncio
async def test_model_cannot_invent_seed_pages_to_visit(tmp_path):
    host, providers, bridge = service(tmp_path)
    providers.capabilities = lambda: {"open_web": {"available": True, "kinds": ["webpage"]}}

    async def plan(*args):
        return {"queries": [{"channel": "open_web", "kind": "webpage", "query": "plants", "seed_urls": ["https://invented.example/"]}], "target_count": 1}

    host.planner.plan_request = plan
    run = await host.create(request(prompt="帮我找植物研究资料"))
    run = await settle(host, run["id"])
    assert run["status"] == "failed"
    assert not providers.searches and not providers.fetches


@pytest.mark.asyncio
async def test_rank_rejection_refines_queries_and_never_refills_rejected_sources(tmp_path):
    host, providers, bridge = service(tmp_path)
    rank_pools, refinements = [], []

    async def plan(*args):
        return {"queries": [{"channel": "tavily", "kind": "webpage", "query": "broad"}], "target_count": 1}

    async def discover(query, limit):
        providers.searches.append(query)
        return [{"title": query["query"], "url": "https://example.com/" + query["query"], "source": "tavily", "kind": "webpage"}]

    async def rank(prompt, candidates, limit):
        rank_pools.append([c["title"] for c in candidates])
        from app.modules.collection.planner import RankedCandidates
        return RankedCandidates([{**c, "ranking_status": "accepted"} for c in candidates if c["title"] == "specific"],
                                rejected_urls=[c["url"] for c in candidates if c["title"] != "specific"])

    async def refine(prompt, queries, feedback, available):
        refinements.append(feedback)
        return [{"channel": "tavily", "kind": "webpage", "query": "specific"}]

    host.planner.plan_request, host.planner.rank_candidates, host.planner.refine_queries = plan, rank, refine
    providers.discover = discover
    run = await host.create(request(prompt="找严格相关的研究"))
    run = await settle(host, run["id"])
    assert run["status"] == "completed"
    assert rank_pools == [["broad"], ["specific"]]
    assert len(refinements) == 1 and refinements[0]["rejected"][0]["title"] == "broad"
    assert providers.fetches == ["https://example.com/specific"]


@pytest.mark.asyncio
async def test_refinement_cannot_exceed_four_search_calls(tmp_path):
    host, providers, bridge = service(tmp_path)

    async def plan(*args):
        return {"queries": [{"channel": "tavily", "kind": "webpage", "query": str(i)} for i in range(3)], "target_count": 1}

    async def discover(query, limit):
        providers.searches.append(query)
        return [{"title": query["query"], "url": "https://example.com/" + query["query"], "source": "tavily", "kind": "webpage"}]

    async def rank(*args):
        return []

    async def refine(*args):
        return [{"channel": "tavily", "kind": "webpage", "query": str(i)} for i in (3, 4)]

    host.planner.plan_request, host.planner.rank_candidates, host.planner.refine_queries = plan, rank, refine
    providers.discover = discover
    run = await host.create(request(prompt="找严格相关的研究"))
    run = await settle(host, run["id"])
    assert run["error_code"] == "no_relevant_results"
    assert len(providers.searches) == 4
    assert not bridge.ingests and not providers.fetches


@pytest.mark.asyncio
@pytest.mark.parametrize("raises", [False, True])
async def test_auto_mode_requires_review_when_ranking_is_unavailable(tmp_path, raises):
    host, providers, bridge = service(tmp_path)

    async def rank(prompt, candidates, limit):
        if raises:
            raise RuntimeError("ranking unavailable")
        return [{**c, "ranking_status": "unavailable"} for c in candidates]

    host.planner.rank_candidates = rank
    run = await host.create(request(prompt="帮我找资料", mode="auto"))
    run = await settle(host, run["id"])
    assert run["status"] == "review"
    assert run["plan"]["review_required_reason"]
    assert not providers.fetches and not bridge.ingests


@pytest.mark.asyncio
async def test_discovery_failure_consumption_is_charged_before_refinement(tmp_path):
    from app.modules.collection.providers import CollectionProviderError
    host, providers, bridge = service(tmp_path, max_total_bytes=10)
    providers.capabilities = lambda: {"open_web": {"available": True, "kinds": ["webpage"]}}

    async def discover(query, limit):
        providers.searches.append(query)
        error = CollectionProviderError("download_failed", "网页读取失败")
        error.downloaded_bytes = 10
        raise error

    async def refine(*args):
        return [{"channel": "open_web", "kind": "webpage", "query": "retry", "seed_urls": ["https://example.com/page"]}]

    providers.discover = discover
    host.planner.refine_queries = refine
    run = await host.create(request(prompt="从 https://example.com/page 找资料"))
    run = await settle(host, run["id"])
    assert run["status"] == "failed"
    assert len(providers.searches) == 1
    assert host.store.get(run["id"])["_bytes"] == 10
    assert not bridge.ingests


@pytest.mark.asyncio
async def test_full_rejected_candidate_window_does_not_discard_repair_search_hits(tmp_path):
    host, providers, bridge = service(tmp_path)
    viewed = []

    async def plan(*args):
        return {"queries": [{"channel": "tavily", "kind": "webpage", "query": query} for query in ("first", "second")], "target_count": 1}

    async def discover(query, limit):
        providers.searches.append(query)
        names = ["relevant"] if query["query"] == "repair" else [query["query"] + str(i) for i in range(20)]
        return [{"title": name, "url": "https://example.com/" + name, "source": "tavily", "kind": "webpage"} for name in names]

    async def rank(prompt, candidates, limit):
        viewed.append([item["title"] for item in candidates])
        from app.modules.collection.planner import RankedCandidates
        return RankedCandidates([{**item, "ranking_status": "accepted"} for item in candidates if item["title"] == "relevant"],
                                rejected_urls=[item["url"] for item in candidates if item["title"] != "relevant"])

    async def refine(*args):
        return [{"channel": "tavily", "kind": "webpage", "query": "repair"}]

    host.planner.plan_request, host.planner.rank_candidates, host.planner.refine_queries = plan, rank, refine
    providers.discover = discover
    run = await host.create(request(prompt="找一份严格相关的素材", max_items=20))
    run = await settle(host, run["id"])
    assert run["status"] == "completed"
    assert [len(batch) for batch in viewed] == [30, 10, 1]
    assert viewed[-1] == ["relevant"]
    assert providers.fetches == ["https://example.com/relevant"]
    assert len(host.store.get(run["id"])["_rejected_urls"]) == 40


@pytest.mark.asyncio
async def test_unseen_rank_window_is_not_marked_rejected_after_target_is_satisfied(tmp_path):
    host, providers, bridge = service(tmp_path)
    run, _ = host.store.create(request().model_dump())
    raw = [{"title": str(i), "url": "https://example.com/" + str(i), "source": "tavily", "kind": "webpage"} for i in range(40)]
    viewed = []

    async def rank(prompt, candidates, limit):
        viewed.append(len(candidates))
        return [candidates[0]]

    host.planner.rank_candidates = rank
    ranked, unavailable = await host.rank_discovery(run["id"], raw, 1)
    assert len(ranked) == 1 and not unavailable
    assert viewed == [30]
    assert host.store.get(run["id"])["_rejected_urls"] == []


async def paper_service(tmp_path, *, response=None):
    host, providers, bridge = service(tmp_path)
    providers.capabilities = lambda: {"tavily": {"available": True, "kinds": ["webpage", "document"]}}

    async def plan(*args):
        # A stale/model-produced webpage plan must not override paper intent.
        return {"queries": [{"channel": "tavily", "kind": "webpage", "query": "agent research"}], "target_count": 1}

    async def discover(query, limit):
        providers.searches.append(query)
        return [{"title": "Agent research", "url": "https://example.com/abstract", "kind": "document", "source": "tavily"}]

    async def fetch(candidate, max_bytes):
        providers.fetches.append(candidate)
        return response or ContentSourceResult(b"%PDF-1.7\noriginal paper", "Agent research.pdf", "application/pdf",
            {"download_url": "https://example.com/fulltext", "kind": "document"})

    host.planner.plan_request = plan
    providers.discover, providers.fetch_candidate = discover, fetch
    return host, providers, bridge


@pytest.mark.asyncio
async def test_paper_delivery_contract_survives_plan_discovery_and_ingestion(tmp_path):
    host, providers, bridge = await paper_service(tmp_path)
    run = await host.create(request(prompt="最近前沿关于Agent RSI的论文", max_items=1))
    done = await settle(host, run["id"])
    assert done["status"] == "completed"
    assert providers.searches[0]["kind"] == "document"
    assert providers.searches[0]["required_format"] == "pdf"
    assert providers.fetches[0]["material_intent"] == "paper"
    candidate = done["candidates"][0]
    assert candidate["required_format"] == "pdf"
    assert candidate["download_url"] == "https://example.com/fulltext"
    assert candidate["kind"] == "document"
    assert bridge.ingests[0][2]["required_format"] == "pdf"
    assert host.store.get(run["id"])["candidates"][0]["_format_verified"] == "pdf"


@pytest.mark.asyncio
@pytest.mark.parametrize("content,filename,mime", [
    (b"<html>abstract</html>", "paper.pdf", "application/pdf"),
    (b"%PDF-1.7\n", "paper.md", "application/pdf"),
    (b"%PDF-1.7\n", "paper.pdf", "text/html"),
])
async def test_host_rejects_non_pdf_delivery_even_if_provider_claims_success(tmp_path, content, filename, mime):
    host, providers, bridge = await paper_service(tmp_path, response=ContentSourceResult(content, filename, mime))
    run = await host.create(request(prompt="获取一篇论文PDF", max_items=1))
    done = await settle(host, run["id"])
    assert done["status"] == "failed"
    assert done["counts"]["ready"] == 0
    assert done["candidates"][0]["error_code"] == "delivery_format_mismatch"
    assert not bridge.ingests
    assert host.store.get(run["id"])["_bytes"] == len(content)


@pytest.mark.asyncio
async def test_existing_abstract_does_not_suppress_original_pdf_and_pdf_still_deduplicates(tmp_path):
    host, providers, bridge = await paper_service(tmp_path)
    original_fetch = providers.fetch_candidate

    async def page(candidate, limit):
        return ContentSourceResult(b"abstract only", "abstract.md", "text/markdown")

    providers.fetch_candidate = page
    webpage = await host.create(request(prompt="https://example.com/abstract"))
    assert (await settle(host, webpage["id"]))["status"] == "completed"
    providers.fetch_candidate = original_fetch
    paper = await host.create(request(key="paper-0002", prompt="获取一篇论文PDF", max_items=1))
    done = await settle(host, paper["id"])
    assert done["counts"]["ready"] == 1
    assert done["counts"]["duplicate"] == 0
    duplicate = await host.create(request(key="paper-0003", prompt="获取一篇论文PDF", max_items=1))
    duplicate = await settle(host, duplicate["id"])
    assert duplicate["counts"]["duplicate"] == 1
    assert len(bridge.ingests) == 2
    assert len(providers.fetches) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("ingested", [False, True])
async def test_legacy_paper_checkpoint_never_fulfills_pdf_contract_with_markdown(tmp_path, ingested):
    host, providers, bridge = await paper_service(tmp_path)
    run, _ = host.store.create(request(prompt="最近关于Agent RSI的论文", max_items=1).model_dump())
    payload = host.store.save_payload("legacy-item", b"abstract only")
    item = {"id": "legacy-item", "title": "Agent research", "url": "https://example.com/abstract",
            "source": "tavily", "kind": "webpage", "status": "failed", "_selected": True,
            "_payload": payload, "_filename": "abstract.md", "_content_type": "text/markdown"}
    if ingested:
        item.update(_ingest_started=True, file_id="old-file", processing_id="old-processing")
        bridge.receipts["old-file"] = {"status": "completed"}
    host.store.update(run["id"], status="failed", candidates=[item])
    await host.retry(run["id"])
    done = await settle(host, run["id"])
    if ingested:
        assert done["counts"]["ready"] == 0
        assert done["candidates"][0]["error_code"] == "delivery_format_mismatch"
        assert not providers.fetches and not bridge.ingests
    else:
        assert done["counts"]["ready"] == 1
        assert providers.fetches[0]["required_format"] == "pdf"
        assert len(bridge.ingests) == 1


@pytest.mark.asyncio
async def test_repair_search_preserves_accepted_papers_and_can_reconsider_omitted_ones(tmp_path):
    host, providers, bridge = service(tmp_path)
    run, _ = host.store.create(request().model_dump())
    raw = [{"title": name, "url": "https://example.com/" + name, "source": "tavily", "kind": "document"}
           for name in ["accepted", "omitted"]]
    calls = []

    async def rank(prompt, candidates, limit):
        calls.append([item["title"] for item in candidates])
        # The first answer omits the second paper, without rejecting it.
        return [{**candidates[0], "ranking_status": "accepted"}]

    host.planner.rank_candidates = rank
    first, _ = await host.rank_discovery(run["id"], raw, 2)
    assert [item["title"] for item in first] == ["accepted"]
    assert host.store.get(run["id"])["_rejected_urls"] == []
    second, _ = await host.rank_discovery(run["id"], raw, 2)
    assert [item["title"] for item in second] == ["accepted", "omitted"]
    assert calls == [["accepted", "omitted"], ["omitted"]]
    assert host.store.get(run["id"])["_rejected_urls"] == []
