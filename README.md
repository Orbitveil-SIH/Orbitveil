# SIH 26171 — On-device Visual Perception for Lightweight Browser Agents

Privacy-preserving browser AI agent: local vision model detects and redacts
sensitive screen content (faces, passwords, PII) before anything is sent to
a server-side VLM for reasoning and action planning.

## Structure
- `extension/` — Manifest V3 browser extension (local vision, redaction, action execution)
- `server/` — FastAPI backend, VLM integration
- `shared/` — action-schema contract used by both sides
- `demo/` — test page + demo script
- `eval/` — benchmarking against SIH rubric metrics
- `docs/` — architecture, pitch, submission docs

## Setup
See `docs/architecture.md` for how the pieces fit together.
