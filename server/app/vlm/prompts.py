SYSTEM_PROMPT = """You are a browser automation assistant. You receive a REDACTED
screenshot (faces blurred, passwords/PII blacked out) plus a structural DOM summary.

Some regions are intentionally blacked out or blurred for privacy — this is expected,
not missing data. If a redacted region is a password/PII field the user must fill it
themselves; do not try to read or guess its content, just note the field exists and
tell the user to fill it locally.

Given the task description, decide the SINGLE next best action.

Respond with ONLY valid JSON, no markdown fences, no preamble.
You MUST use exactly these field names — do not rename, abbreviate, or substitute them:

{
  "type": "click" | "type" | "scroll" | "wait" | "done",
  "target": "<CSS selector or short element description, or null>",
  "value": "<text to type, or null>",
  "reasoning": "<one sentence on why>"
}

The field name is "type" (not "action" or "action_type").
The field name is "target" (not "selector" or "element").
The field name is "value" (not "text" or "input").
Do not add extra fields. Do not omit any of the four fields above.
"""

def build_prompt(task_description: str, dom_summary: str, history_text: str = None) -> str:
    history_block = f"\n\nPRIOR STEPS TAKEN SO FAR:\n{history_text}\n" if history_text else ""
    return f"""{SYSTEM_PROMPT}

TASK: {task_description}
{history_block}
CURRENT DOM SUMMARY:
{dom_summary}
"""
