# Architecture — Orbitveil (SIH 26171)

## The problem this solves

AI browser agents need to see the screen to help with tasks — but "seeing the screen" today usually means sending the whole thing to a server, passwords and faces included. Orbitveil's core idea: **redact locally, reason remotely.** Nothing sensitive ever leaves the browser.

## Pipeline overview

## Why this satisfies the problem statement's core requirement

> "Only this anonymized, unidentifiable data should be transmitted to the central server"

Steps 1-5 happen **entirely in the browser, before any network request is constructed.** The server (and Groq, and anyone who intercepts the connection) only ever sees a screenshot that's already had faces blurred and PII blacked out, plus a DOM summary that's been stripped of sensitive values. The server is architecturally incapable of seeing raw sensitive data — not because it promises not to look, but because it's never sent.

## The action loop, concretely

Each step is one HTTP round trip:

1. Client captures + redacts the current screen state
2. Client sends `{dom_summary, redacted_image_b64}` to `/session/{id}/step`
3. Server appends this to the session's history and asks the VLM: "given the task, the history so far, and the current state, what's the single next action?"
4. VLM returns one `Action`: `{type, target, value, reasoning}` where `type` is one of `click | type | scroll | wait | done`
5. Server returns the action to the client; client executes it via `executor.js`
6. Loop repeats until `type == "done"`

This step-by-step design (rather than asking the VLM to plan the whole task upfront) is what let us catch and fix a real bug during testing: without session history, the model kept re-deciding the same first action forever since it had no memory of what it had already done. Feeding history back in on every step fixed this.

## Component ownership

| Component | Owner | Status |
|---|---|---|
| Screenshot capture | Person 1 | Built |
| Face detection (MediaPipe) | Person 2 | Built, standalone-tested |
| PII scanner (regex + DOM attributes) | Person 3 | Built |
| Redaction (canvas blur/black-box) | Person 3 | Built |
| Action executor (click/type/scroll on real page) | Person 1 | In progress |
| Server + session state | Person 4 (Aparna) | Built, tested end-to-end |
| VLM integration | Person 4 (Aparna) | Built, tested end-to-end |
| Protocol/orchestration | Person 5 | Built |
| Eval/demo/docs | Person 6 (Aparna) | In progress |

## VLM provider notes (for anyone picking this up later)

We went through two provider changes before landing on the current setup, worth knowing if debugging:

1. **Gemini** — initially used, but Google's ongoing key-format migration (`AIza` Standard keys being phased out in favor of `AQ.` Auth keys as of Sept 2026) currently breaks `generateContent` calls for many developers, including us, regardless of SDK version. This is a provider-side issue, not something fixable in our code.
2. **Claude (Anthropic)** — considered, but requires a paid credit balance to start, which wasn't viable on our timeline.
3. **Groq (`qwen/qwen3.6-27b`)** — what we're using now. Free tier, no credit card, genuine vision support, JSON mode. One thing worth knowing: this model defaults to "thinking mode," which burns its token budget on internal reasoning before writing the JSON response — this caused real failures (`json_validate_failed`, "max completion tokens reached") until we explicitly set `reasoning_effort="none"`. Also worth noting: free-tier requests can occasionally queue/slow down noticeably (seen up to ~30s on a request) — plan demo timing with a buffer, and have the recorded backup demo ready.

## Known gaps as of this write-up

- `extension/src/content/executor.js` is not yet implemented — this is the last piece blocking a true end-to-end test against the real extension (current server-side testing uses a blank placeholder image, not a real redacted screenshot)
- Latency numbers in `eval/results.md` are from server-only testing (blank test image); full pipeline numbers pending `executor.js` and integration with the real capture → redact → analyze → execute loop
