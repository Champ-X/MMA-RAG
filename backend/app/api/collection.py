"""Collection endpoints share a fixed target space; the model cannot change it."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.pi_agent import workspace_owner_for
from app.modules.collection.models import CollectSelection, CreateRun
from app.modules.collection.service import get_collection_service
from app.modules.collection.store import CollectionConflict, CollectionNotFound

# This service uses the same single-workspace access boundary as Pi, without
# requiring question-answering Agent mode to be enabled.
router = APIRouter(dependencies=[Depends(workspace_owner_for)])


async def call(operation):
    try:
        return await operation
    except CollectionNotFound as error:
        raise HTTPException(404, str(error)) from None
    except CollectionConflict as error:
        raise HTTPException(409, str(error)) from None
    except ValueError as error:
        raise HTTPException(422, str(error)) from None


@router.get("/capabilities")
async def capabilities():
    return await call(get_collection_service().capabilities())


@router.post("/runs", status_code=202)
async def create_run(body: CreateRun):
    return await call(get_collection_service().create(body))


@router.get("/runs")
async def list_runs(kb_id: str = Query(min_length=1)):
    return await call(get_collection_service().list(kb_id))


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    return await call(get_collection_service().get(run_id))


@router.post("/runs/{run_id}/collect", status_code=202)
async def collect(run_id: str, body: CollectSelection):
    return await call(get_collection_service().collect(run_id, body.candidate_ids))


@router.post("/runs/{run_id}/cancel")
async def cancel(run_id: str):
    return await call(get_collection_service().cancel(run_id))


@router.post("/runs/{run_id}/retry", status_code=202)
async def retry(run_id: str):
    return await call(get_collection_service().retry(run_id))
