## Privacy protection (add before the existing task-run section)

### 1. Cold open — privacy, before anything else runs
- Load a page with a face photo + password/PII fields (`demo-form.html` or similar)
- **Do not touch the extension icon or popup yet**
- Wait ~1 second, let it auto-blur
- Say: *"Before I do anything — no task typed, nothing clicked — Orbitveil already redacted this page. That's not a demo trick, that's always on."*

### 2. Confidential-portal moment (MOSDAC)
- Navigate to the MOSDAC-style page
- Same auto-blur happens on load
- Say: *"Same thing on a confidential government-style portal — sensitive fields protected the instant the page loads."*

### 3. Phishing moment
- Navigate to the phishing test page
- Auto-blur triggers again
- Say: *"And it doesn't just protect your data leaving the device — it protects you from a malicious page trying to get data out of you, before you type anything. Same local pipeline, doing double duty."*
- **If you click "I trust this site — dismiss warning" on camera:** narrate that this only dismisses the phishing-specific banner. The PII fields stay blurred regardless — say explicitly *"Notice the fields are still protected even after I dismiss the warning — that's deliberate. PII protection never depends on whether a site claims to be trustworthy."* Do NOT imply the button reveals the redacted fields; it doesn't, on purpose.

> **Note for whoever presents:** steps 1-3 require zero clicks on the extension icon. That's the whole point — don't reach for the popup out of habit.

---