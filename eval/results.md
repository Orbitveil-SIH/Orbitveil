# Evaluation Results — SIH 26171

Ground truth fixture: `demo/demo-form.html`
Task: "Fill in the bio and favorite color fields, then submit."

---

## 1. Face Detection

| Metric | Result |
|---|---|
| Face present in fixture | 1 (`#profile-photo`) |
| Face detected | Yes |
| Face correctly blurred before leaving browser | Yes (visual check on `demo-form.html`) |
| Detection latency (ms) | 410.1 |

---

## 2. PII Redaction — Precision & Recall

**Ground truth — 5 fields that MUST be redacted:**
- full_name
- email
- phone
- password
- card_number

**Ground truth — 2 control fields that must NOT be redacted (precision test):**
- bio
- favorite_color

| Metric | Result |
|---|---|
| True Positives (sensitive fields correctly redacted) | 5 / 5 |
| False Negatives (sensitive fields missed) | 0 / 5 |
| False Positives (control fields wrongly redacted) | 0 / 2 |
| True Negatives (control fields correctly left alone) | 2 / 2 |
| **Recall** (TP / (TP + FN)) | 100% |
| **Precision** (TP / (TP + FP)) | 100% |

Notes: All 5 sensitive fields (full_name, email, phone, password, card_number) were correctly
black-boxed before leaving the browser. Both control fields (bio, favorite_color) were left
untouched and correctly filled/selected by the agent. No misses, no over-redaction observed
in this run.

---

## 3. Redaction Precision (spatial accuracy)

| Metric | Result |
|---|---|
| Face blur correctly aligned to bounding box | TBD |
| PII black-box correctly aligned to field region | TBD |
| Any visible leakage at redaction edges | TBD |

---

## 4. Task Completion (agentic correctness)

| Metric | Result |
|---|---|
| bio field filled | Yes (step 1) |
| favorite_color field filled | Yes (steps 2–4: open dropdown, select option) |
| Form submitted | Yes (step 5) |
| Any sensitive field touched/modified (should be NO) | No — agent never targeted password/email/phone/card fields |
| Task completed without human intervention | Yes — agent self-terminated with "done" at step 6 |

---

## 5. Latency

| Stage | Time (ms) |
|---|---|
| Screenshot capture | 60.1 |
| Local face detection | 410.1 |
| Local PII scan | 4.6 |
| Redaction (draw + re-encode) | 60.0 |
| **Local processing subtotal** | **535.3** |
| Action execution (on page, post-decision) | 3.0 |
| Network round trip (real extension run, live capture) | 4,477.9 (single sample) |
| Network round trip (`benchmark.py`, blank image, Groq free-tier under load) | 561–25,666 ms, avg ~15,000 ms across 6-step run |
| Total end-to-end (per action, best observed) | ~5,020 ms (535.3 local + 4,477.9 network + 3.0 execute) |
| Total end-to-end (per action, worst observed) | ~26,200 ms under free-tier queuing |

Note: the two network-round-trip numbers come from different runs (one live extension call,
one `benchmark.py` batch run) and are reported separately rather than averaged — the spread is
real and driven by Groq free-tier queuing, not a measurement bug. See `docs/architecture.md`
for the known provider-side cause.

---

## 6. Steps to Completion

| Metric | Result |
|---|---|
| Number of actions taken to complete task | 6 (type bio, click dropdown, click option, click option, click submit, done) |
| Number of actions wasted/incorrect | 0 direct errors, but steps 3–4 both spent an action clicking a dropdown option — worth a closer look at whether the first click actually registered a selection (see notes) |

---

## 7. Client-side Resource Utilization

| Metric | Result |
|---|---|
| Peak CPU usage during pipeline | TBD |
| Peak memory usage during pipeline | TBD |
| Measured on (device spec) | TBD |

---

## Summary (fill in last, once all numbers are in)

One paragraph, honest assessment: what worked, what didn't, biggest gap.