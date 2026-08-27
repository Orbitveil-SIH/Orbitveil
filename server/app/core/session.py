"""
In-memory session store.

A "session" tracks one browser-automation task end-to-end: the task
description plus a running history of (dom_summary, action) pairs so the
VLM has context across multiple /step calls instead of deciding each
action in a vacuum.

This is intentionally a plain in-process dict -- good enough for a
hackathon / single-server demo. If this needs to survive restarts or run
behind multiple server processes, swap SessionStore's internals for Redis
(or similar) without changing its public methods, and nothing else in the
app needs to change.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

# Cap on how much history we keep/send to the VLM. Long tasks would
# otherwise grow the prompt unboundedly and blow past context/latency
# budgets. Older steps are dropped, oldest first.
MAX_HISTORY_STEPS = 20


class SessionStatus(str, Enum):
    ACTIVE = "active"
    DONE = "done"
    ERROR = "error"


@dataclass
class HistoryStep:
    dom_summary: str
    action_type: str
    action_target: Optional[str]
    action_value: Optional[str]
    action_reasoning: Optional[str]
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class Session:
    id: str
    task_description: str
    status: SessionStatus = SessionStatus.ACTIVE
    history: list[HistoryStep] = field(default_factory=list)
    error_message: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def add_step(self, dom_summary: str, action: dict) -> None:
        self.history.append(
            HistoryStep(
                dom_summary=dom_summary,
                action_type=action.get("type", "unknown"),
                action_target=action.get("target"),
                action_value=action.get("value"),
                action_reasoning=action.get("reasoning"),
            )
        )
        if len(self.history) > MAX_HISTORY_STEPS:
            self.history = self.history[-MAX_HISTORY_STEPS:]
        self.updated_at = datetime.now(timezone.utc)

        if action.get("type") == "done":
            self.status = SessionStatus.DONE

    def mark_error(self, message: str) -> None:
        self.status = SessionStatus.ERROR
        self.error_message = message
        self.updated_at = datetime.now(timezone.utc)

    def history_as_text(self) -> str:
        """Render prior steps as a compact log for the VLM prompt."""
        if not self.history:
            return "(no actions taken yet)"
        lines = []
        for i, step in enumerate(self.history, start=1):
            detail = f"{step.action_type}"
            if step.action_target:
                detail += f" target={step.action_target!r}"
            if step.action_value:
                detail += f" value={step.action_value!r}"
            lines.append(f"{i}. {detail}")
        return "\n".join(lines)


class SessionStore:
    """Process-local session registry keyed by session id."""

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self, task_description: str) -> Session:
        session_id = uuid.uuid4().hex
        session = Session(id=session_id, task_description=task_description)
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> Optional[Session]:
        return self._sessions.get(session_id)

    def delete(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None


# Single shared instance used across the app (imported by routes).
session_store = SessionStore()
