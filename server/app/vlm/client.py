import base64
import json
import time
from groq import Groq
from app.core.config import GROQ_API_KEY, GROQ_MODEL
from app.vlm.prompts import build_prompt

client = Groq(api_key=GROQ_API_KEY)

MAX_RETRIES = 2
RETRY_DELAY_SECONDS = 2

# Qwen on Groq doesn't always follow tool-call schemas strictly (it may
# rename/drop fields), and Groq validates tool calls server-side BEFORE
# our code ever sees them - so a malformed tool call fails outright with
# no chance for us to fix it up. JSON mode instead returns the raw text,
# which we parse and normalize ourselves - more forgiving for this model.
KEY_ALIASES = {
    "action": "type",
    "action_type": "type",
    "selector": "target",
    "element": "target",
    "som": "target",
    "text": "value",
    "input": "value",
    "reason": "reasoning",
}

def normalize_action(raw: dict) -> dict:
    normalized = {}
    for key, val in raw.items():
        canonical_key = KEY_ALIASES.get(key, key)
        normalized[canonical_key] = val if val not in ("", None) else None
    if "type" not in normalized:
        normalized["type"] = "wait"
    normalized.setdefault("target", None)
    normalized.setdefault("value", None)
    normalized.setdefault("reasoning", None)
    return normalized

def get_next_action(task_description: str, dom_summary: str, redacted_image_b64: str, history_text: str = None) -> dict:
    prompt_text = build_prompt(task_description, dom_summary, history_text=history_text)

    last_error = None
    for attempt in range(1, MAX_RETRIES + 2):
        try:
            response = client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt_text},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{redacted_image_b64}",
                                },
                            },
                        ],
                    }
                ],
                response_format={"type": "json_object"},
                # Non-thinking mode - this is a single quick action decision,
                # not a task that needs deep reasoning. Thinking mode was
                # burning the entire token budget on an internal reasoning
                # trace before ever writing the JSON, causing both timeouts
                # (20-30s) and outright json_validate_failed errors.
                reasoning_effort="none",
                temperature=0.7,
                top_p=0.8,
                presence_penalty=1.5,
                max_completion_tokens=2048,
                timeout=15,
            )

            raw_text = response.choices[0].message.content.strip()
            raw_text = raw_text.replace("```json", "").replace("```", "").strip()

            try:
                parsed = json.loads(raw_text)
                return normalize_action(parsed)
            except json.JSONDecodeError:
                return {
                    "type": "wait",
                    "target": None,
                    "value": None,
                    "reasoning": f"Failed to parse model output: {raw_text[:200]}",
                }

        except Exception as e:
            last_error = e
            print(f"[VLM] Attempt {attempt} failed: {e}")
            if attempt <= MAX_RETRIES:
                time.sleep(RETRY_DELAY_SECONDS)
            continue

    return {
        "type": "wait",
        "target": None,
        "value": None,
        "reasoning": f"VLM call failed after {MAX_RETRIES + 1} attempts: {last_error}",
    }
