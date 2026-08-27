from fastapi import APIRouter, HTTPException
from app.schema.action_schema import AnalyzeRequest, AnalyzeResponse, Action
from app.vlm.client import get_next_action

router = APIRouter()

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(payload: AnalyzeRequest):
    try:
        result = get_next_action(
            task_description=payload.task_description,
            dom_summary=payload.dom_summary,
            redacted_image_b64=payload.redacted_image_b64,
        )
        return AnalyzeResponse(action=Action(**result))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
