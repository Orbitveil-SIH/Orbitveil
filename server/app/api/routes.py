from fastapi import APIRouter, HTTPException

from app.schema.action_schema import (
    AnalyzeRequest,
    AnalyzeResponse,
    Action,
    StartSessionRequest,
    StartSessionResponse,
    StepRequest,
    StepResponse,
    SessionStateResponse,
)
from app.vlm.client import get_next_action
from app.core.session import session_store

router = APIRouter()


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(payload: AnalyzeRequest):
    """Legacy, unscoped, single-shot endpoint (no history). Prefer /session/*."""
    try:
        result = get_next_action(
            task_description=payload.task_description,
            dom_summary=payload.dom_summary,
            redacted_image_b64=payload.redacted_image_b64,
        )
        return AnalyzeResponse(action=Action(**result))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/start", response_model=StartSessionResponse)
async def start_session(payload: StartSessionRequest):
    session = session_store.create(payload.task_description)
    return StartSessionResponse(session_id=session.id, status=session.status.value)


@router.post("/session/{session_id}/step", response_model=StepResponse)
async def step_session(session_id: str, payload: StepRequest):
    session = session_store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status.value != "active":
        raise HTTPException(
            status_code=409,
            detail=f"Session is {session.status.value}, cannot take further steps",
        )

    try:
        result = get_next_action(
            task_description=session.task_description,
            dom_summary=payload.dom_summary,
            redacted_image_b64=payload.redacted_image_b64,
            history_text=session.history_as_text(),
        )
        action = Action(**result)
    except Exception as e:
        session.mark_error(str(e))
        raise HTTPException(status_code=500, detail=str(e))

    session.add_step(payload.dom_summary, result)
    return StepResponse(session_id=session.id, status=session.status.value, action=action)


@router.get("/session/{session_id}", response_model=SessionStateResponse)
async def get_session(session_id: str):
    session = session_store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionStateResponse(
        session_id=session.id,
        task_description=session.task_description,
        status=session.status.value,
        step_count=len(session.history),
        error_message=session.error_message,
    )


@router.delete("/session/{session_id}")
async def delete_session(session_id: str):
    deleted = session_store.delete(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted"}
