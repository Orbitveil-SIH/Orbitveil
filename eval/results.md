# Evaluation Results — SIH 26171

Ground truth fixture: `demo/demo-form.html`
Task: "Fill in the bio and favorite color fields, then submit."

---

## 1. Face Detection

| Metric | Result |
|---|---|
| Face present in fixture | 1 (`#profile-photo`) |
| Face detected | TBD |
| Face correctly blurred before leaving browser | TBD |
| Detection latency (ms) | TBD |

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
| True Positives (sensitive fields correctly redacted) | TBD / 5 |
| False Negatives (sensitive fields missed) | TBD / 5 |
| False Positives (control fields wrongly redacted) | TBD / 2 |
| True Negatives (control fields correctly left alone) | TBD / 2 |
| **Recall** (TP / (TP + FN)) | TBD |
| **Precision** (TP / (TP + FP)) | TBD |

Notes: (list which specific field, if any, was missed or wrongly flagged — be specific, not "works well")

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
| bio field filled | TBD (yes/no) |
| favorite_color field filled | TBD (yes/no) |
| Form submitted | TBD (yes/no) |
| Any sensitive field touched/modified (should be NO) | TBD |
| Task completed without human intervention | TBD |

---

## 5. Latency

| Stage | Time (ms) |
|---|---|
| Screenshot capture | TBD |
| Local face detection | TBD |
| Local PII scan + redaction | TBD |
| Network round trip (`/analyze`) | TBD |
| Total end-to-end (per action) | TBD |

---

## 6. Steps to Completion

| Metric | Result |
|---|---|
| Number of actions taken to complete task | TBD |
| Number of actions wasted/incorrect | TBD |

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
