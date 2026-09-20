# docs/submission.md

## Problem Statement
**PS 26171** — On-device Visual Perception for Lightweight Browser Agents (ISRO, Software, Miscellaneous theme)

AI browser agents that automate tasks on a screen currently have to send the raw screen — passwords, personal data, faces, internal dashboards — to a cloud model just to understand what's on it. Orbitveil removes that requirement: all sensitive-data detection and redaction happens on-device, before anything reaches a server.

## Our Solution
Orbitveil is a Chrome extension (Manifest V3) paired with a FastAPI reasoning server:
1. Captures the screen locally
2. Detects faces (MediaPipe, on-device) and PII (pattern matching + DOM heuristics, on-device)
3. Redacts both before any network call
4. Sends only the sanitized screenshot + sanitized DOM summary to the server
5. Server (Groq-backed reasoning) returns a structured action — click, type, scroll
6. Extension executes the action locally via `executor.js`
7. Loop repeats until the task completes

A separate, always-on layer runs independently of the task loop: on-device detection blurs sensitive fields/faces the moment any page loads or is switched to — no task typed, no button clicked, no server call. Confirmed working on both a confidential-portal-style page (MOSDAC) and a phishing test page.

## Requirement-Mapping Table

| PS 26171 requirement | Our implementation | Status |
|---|---|---|
| On-device visual perception | `face-detector.js` (MediaPipe, runs in an Offscreen Document since service workers can't load WASM/canvas) | ✅ Built & tested |
| Local, privacy-preserving processing | Redaction happens client-side before any network call (`redactor.js` / `redactScreenshotViaOffscreen`) | ✅ Built & tested |
| Understanding UI elements | DOM element scan — `getDomSummaryFromActiveTab()` in `service-worker.js` | ✅ Built & tested |
| Local text/PII filtering | `getPiiDetectionsFromActiveTab()` — regex (email/phone/card w/ Luhn check) + DOM attribute heuristics, `service-worker.js` | ✅ Built & tested |
| Bounding-box tracking | Face + PII bounding boxes computed in-page, scaled to screenshot coordinates, passed to redactor | ✅ Built & tested |
| "Privacy Preserving Filter... clearly demonstrated" | On-page visible blur overlay (`applyLiveRedaction`) — separate from the actual screenshot redaction, exists specifically so judges can see it happen live | ✅ Built & tested |
| Resource-constrained client | No GPU required; runs at ~0.2–1.1% CPU, ~86.6 MB memory on a normal laptop | ✅ Measured |
| Only sanitized data reaches the server | Server only ever receives `redacted_image_b64` + sanitized `dom_summary` — never a raw screenshot | ✅ Built & tested |
| Server-side LLM/VLM integration, returns actionable command | FastAPI + Groq reasoning, returns `{type, target, value}` action consumed by `executor.js` | ✅ Built & tested |
| End-to-end task demonstrated | Full loop (capture → detect → redact → reason → act → repeat) run against `demo-form.html` | ✅ Confirmed working |
| (Beyond PS scope, differentiator) Always-on protection independent of task execution | `alwaysOnPrivacyProtect()` — fires on page load / tab switch, no task required, no server call | ✅ Built & tested |

## Evaluation Metrics (real numbers, from `eval/results.md`)

| Metric | Result |
|---|---|
| Face detection recall | 1/1 |
| PII detection recall (5 sensitive fields) | 5/5 |
| PII detection precision (2 control fields) | 0/2 false positives |
| Redaction spatial accuracy | Qualitative / visual |
| Local processing latency (capture → redact) | 535.30 ms |
| Server round-trip latency | 4477.90 ms *(Groq free-tier constraint, not architectural)* |
| CPU / memory usage | ~0.2–1.1% CPU, ~86.6 MB memory (Chrome Task Manager; workload completes faster than the 1s sampling interval, so this likely understates true peak — see `eval/results.md` §7) |

## Known Limitations (stated honestly, not hidden)
- `chrome.tabs.captureVisibleTab` only works on the currently visible/focused tab — protection is "on view," not blanket coverage of background tabs
- PII detection is pattern/heuristic-based, not a trained ML classifier — fast and resource-light, but may miss unusual field-naming conventions
- Server round-trip latency is dependent on Groq's free-tier response time during the demo