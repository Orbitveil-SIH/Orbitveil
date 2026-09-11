# Submission — Orbitveil (SIH 26171)

**Team Name:** Team Brain.exe
**Problem Statement ID:** SIH 26171
**Problem Statement Title:** On-device Visual Perception for Light-weight Browser Agents
**Team Members:** Aparna Dhiraj , AryaKrishna CS, Danwin Sajith , Harisha Pal , Dilkush M , Aakash Singh Chandel

---

## 1. Idea Title

**Orbitveil** — a browser extension that lets an AI agent see and act on a web page without
ever sending sensitive data off the device.

## 2. Problem Statement

AI browser agents need visual context — screenshots of the page — to decide what to click, type,
or select next. Today that means the full screenshot, faces and personal data included, gets sent
to a remote model. The problem statement requires that only anonymized, unidentifiable data reach
the central server.

## 3. Proposed Solution

Orbitveil's core idea: **redact locally, reason remotely.** Every sensitive element — faces,
passwords, card numbers, emails, phone numbers — is detected and blacked out or blurred inside
the browser, before any network request is built. The server (and the model it calls) only ever
receives a screenshot that has already been redacted, plus a DOM summary stripped of sensitive
values. Nothing sensitive is ever transmitted — not because the server promises not to look, but
because it is never sent in the first place.

## 4. Technical Approach

**Pipeline (runs once per agent action):**

1. **Capture** — extension screenshots the current tab
2. **Detect** — MediaPipe finds faces; a regex + DOM-attribute scanner finds PII fields
3. **Redact** — faces are blurred and PII fields are blacked out, entirely on-device (canvas)
4. **Send** — only the redacted image and a stripped DOM summary go to the server
5. **Reason** — the server appends this to the session's history and asks the vision-language
   model: given the task, the history so far, and the current state, what's the single next
   action? (`click | type | scroll | wait | done`)
6. **Execute** — the extension runs that action on the real page, and the loop repeats until the
   model signals `done`

Feeding the action history back into every step (rather than re-planning from scratch) was a
deliberate fix: early testing showed that without history, the model had no memory of what it had
already done and kept re-deciding the same first action indefinitely.

**Key components:**

| Component | Role |
|---|---|
| Screenshot capture | Grabs the current tab state |
| Face detection (MediaPipe) | Locates faces for blurring |
| PII scanner (regex + DOM attributes) | Locates sensitive form fields |
| Redaction (canvas) | Blurs/blacks-out sensitive regions before anything leaves the browser |
| Action executor | Carries out the model's chosen action on the live page |
| Server + session state | Holds per-task history, orchestrates the step loop |
| VLM integration | Vision-language model call that returns the next action |

**Stack:** MediaPipe (face detection), canvas-based redaction in the extension, FastAPI-style
server for session/step orchestration, a hosted vision-language model for action reasoning.

## 5. Feasibility and Viability

- The full loop (capture → detect → redact → send → execute) is implemented and has run
  end-to-end against a test form (`demo/demo-form.html`).
- Redaction correctness was measured directly against a ground-truth fixture: 5/5 sensitive
  fields correctly redacted, 2/2 control fields correctly left untouched (100% precision and
  recall on this run) — see `eval/results.md`.
- **Known constraint:** the current model provider's free tier can queue under load, adding
  several seconds of latency per action in the worst case (see Latency in `eval/results.md`).
  This doesn't affect correctness, only responsiveness, and is a swappable provider choice
  rather than a structural limitation of the approach.
- Spatial precision of redaction (pixel-level alignment) and client-side resource usage
  (CPU/memory) are the two remaining measurements to complete before final numbers are locked —
  both have defined, quick procedures in `eval/results.md` and don't require architecture changes.

## 6. Impact and Benefits

- Removes the core privacy trade-off of screen-sharing AI agents: you get agentic help on a page
  without sending faces, passwords, card numbers, or other PII to any third party.
- Architecture is provider-agnostic — the redaction layer works regardless of which
  vision-language model is used downstream, so the privacy guarantee doesn't depend on trusting
  a specific vendor.
- Applicable beyond form-filling: any browser-agent workflow that currently requires full-screen
  capture (support automation, accessibility tools, QA testing agents) can adopt the same
  redact-before-send pattern.

## 7. References

- `docs/architecture.md` — full pipeline design and component ownership
- `eval/results.md` — evaluation methodology and current results
- `demo/demo-form.html` — ground-truth test fixture used for evaluation