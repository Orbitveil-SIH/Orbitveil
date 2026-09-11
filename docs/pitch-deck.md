# Pitch Deck Outline — Orbitveil (SIH 26171)

---

## Slide 1 — Title

**Orbitveil**
Redact locally, reason remotely.

Team Brain.exe · SIH 26171
---

## Slide 2 — The Problem

AI browser agents need to *see* the screen to act on it.

Today, "seeing the screen" means sending the whole screenshot to a remote model —
faces, passwords, card numbers and all.

The problem statement's core requirement: **only anonymized, unidentifiable data may reach the
central server.**

---

## Slide 3 — The Idea

**Redact locally, reason remotely.**

Every sensitive element — faces, passwords, emails, phone numbers, card numbers — is detected
and blacked out *inside the browser*, before any network request is even built.

The server is architecturally incapable of seeing raw sensitive data. Not a policy. A guarantee.

---

## Slide 4 — How It Works

1. **Capture** — screenshot the tab
2. **Detect** — MediaPipe finds faces; a scanner finds PII fields
3. **Redact** — blur/black-box, entirely on-device
4. **Send** — only the redacted image + stripped DOM summary leave the browser
5. **Reason** — server + vision-language model decide the next action
6. **Execute** — extension performs it on the real page, loop repeats until done

*Walk this as a loop diagram if you have one — it's the whole architecture in one slide.*

---

## Slide 5 — What Makes It Reliable

Early on, the agent kept re-deciding the same first action forever.

Fix: feed the session's action history back into every step, so the model knows what it's
already done — not just what the task is.

*This is a good "we hit a real bug and fixed it" moment — judges like evidence of iteration.*

---

## Slide 6 — Results (so far)

On our ground-truth test form:

- **5/5** sensitive fields correctly redacted
- **2/2** control fields correctly left untouched
- **100% precision, 100% recall** on this run
- Task completed end-to-end, self-terminated correctly, zero sensitive fields ever touched

*Say "on this run" — one clean test isn't a claim of universal accuracy, and being precise about
that builds more credibility than overclaiming.*

---

## Slide 7 — Honest Limitations

- Model-provider latency can spike under free-tier load (several seconds/action, worst case) —
  a provider choice, not a design flaw
- Spatial redaction accuracy and client resource usage are still being measured — methodology is
  defined, numbers are pending

*Judges respond well to teams who know exactly what's unproven vs proven. Don't hide this slide.*

---

## Slide 8 — Why It Matters

- Solves the core privacy trade-off of agentic browsing: help on your screen without your data
  leaving your device
- Provider-agnostic — the privacy guarantee holds no matter which model reasons over the redacted
  data
- Same pattern extends to any agent workflow that currently needs full-screen capture

---

## Slide 9 — Team & Ask

[Team members, roles]

[What you're asking for: funding / mentorship / next milestone — fill in per SIH round]

---

## Appendix (backup slides, only if asked)

- Component ownership table (from `docs/architecture.md`)
- Full latency breakdown (from `eval/results.md`)