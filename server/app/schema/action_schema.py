from pydantic import BaseModel
from typing import Optional, Literal

class Action(BaseModel):
    type: Literal["click", "type", "scroll", "wait", "done"]
    target: Optional[str] = None      # e.g. a DOM selector or element description
    value: Optional[str] = None       # e.g. text to type
    reasoning: Optional[str] = None   # why the VLM chose this action

class AnalyzeRequest(BaseModel):
    dom_summary: str                  # sanitized structural DOM info
    task_description: str             # what the user wants done
    redacted_image_b64: str           # base64 redacted screenshot

class AnalyzeResponse(BaseModel):
    action: Action


# --- Session-scoped schema ------------------------------------------------

class StartSessionRequest(BaseModel):
    task_description: str

class StartSessionResponse(BaseModel):
    session_id: str
    status: str

class StepRequest(BaseModel):
    dom_summary: str
    redacted_image_b64: str

class StepResponse(BaseModel):
    session_id: str
    status: str
    action: Action

class SessionStateResponse(BaseModel):
    session_id: str
    task_description: str
    status: str
    step_count: int
    error_message: Optional[str] = None
