# Demo Script — Orbitveil (SIH 26171)

**Total target time:** [fill in per round's slot, e.g. 3–5 min]
**Fixture used:** `demo/demo-form.html`
**Task given to the agent:** "Fill in the bio and favorite color fields, then submit."

**Before you start:** free-tier model latency can spike unpredictably (seen up to ~30s on a
single step). Have the recorded backup ready and be prepared to cut to it if a live step stalls
past ~15 seconds — don't let dead air eat your slot.

---

## 1. Cold open (15s)

*Say:* "AI agents that browse the web for you need to see your screen. That usually means your
face, your passwords, your card number — all sent to a remote server. Orbitveil redacts all of
that locally, before anything is sent anywhere."

## 2. Show the form (15s)

Open `demo/demo-form.html`. Point out on screen, without dwelling:
- A profile photo (face)
- Full name, email, phone, password, card number fields (sensitive)
- Bio and favorite color fields (not sensitive — these are what the agent will actually touch)

*Say:* "This form has both sensitive fields and two harmless ones. Watch which ones the agent
is even able to see."

## 3. Trigger the agent (5s)

Kick off the task via the extension: *"Fill in the bio and favorite color fields, then submit."*

## 4. While it runs, narrate the pipeline (30–45s, overlapping with agent steps)

*Say, pointing at whichever step is live:*
- "Right now the extension is capturing the screen and redacting it — faces blurred, PII
  blacked out — entirely on this device."
- "Only that redacted image and a stripped-down DOM summary go to the server."
- "The server asks the model for one action at a time, and feeds back what's already happened
  so it doesn't repeat itself."
- "The extension executes that action on the real page and loops."

## 5. Show the redacted screenshot side-by-side (15s)

Pull up the raw vs. redacted screenshot (prepared ahead of time, don't generate live unless
you're confident on timing). Point at:
- Face fully blurred
- Password/card/email/phone fields fully blacked out
- Bio and favorite color left untouched and correctly filled

## 6. Task completes (10s)

Let the agent hit `done`. *Say:* "Bio filled, color selected, form submitted — and the agent
never had access to a single sensitive field, because it never received one."

## 7. Numbers slide (15s)

*Say:* "On our test run: 5 out of 5 sensitive fields correctly redacted, 2 out of 2 safe fields
correctly left alone — 100% precision and recall on this run." (Say "on this run" — don't
overclaim.)

## 8. Close (10s)

*Say:* "Redact locally, reason remotely. The server is never even capable of seeing raw
sensitive data — because it's never sent."

---

## If something breaks live

- **Model step stalls (>15s):** narrate "this is exactly the free-tier queuing we flagged as a
  known limitation" and cut to the recorded backup.
- **Redaction visibly wrong on the day:** don't improvise a fix on stage — acknowledge it plainly
  ("that's not matching our tested run, we'll flag it") and continue with the backup recording
  rather than debugging live.
- **Extension crashes:** go straight to backup recording, no narration needed beyond "let's use
  our recorded run for this part."

## Backup recording checklist (record ahead of time, don't skip this)

- [ ] Full pipeline run captured end-to-end, ideally on a fast (non-queued) model response
- [ ] Raw vs. redacted screenshot comparison visible in the recording
- [ ] Final "done" state and submitted form visible
- [ ] Recording is under [time limit] and doesn't need narration to make sense on its own