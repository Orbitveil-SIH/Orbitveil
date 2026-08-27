import base64
import json
import time
from google import genai
from google.genai import types
from app.core.config import GEMINI_API_KEY, GEMINI_MODEL
from app.vlm.prompts import build_prompt

client = genai.Client(api_key=GEMINI_API_KEY)

MAX_RETRIES = 2
RETRY_DELAY_SECONDS = 2

# Gemini doesn't always use our exact field names - normalize known variants
KEY_ALIASES = {
    "action": "type",
    "action_type": "type",
    "selector": "target",
    "element": "target",
    "text": "value",
    "input": "value",
    "reason": "reasoning",
}

def normalize_action(raw: dict) -> dict:
    normalized = {}
    for key, val in raw.items():
        canonical_key = KEY_ALIASES.get(key, key)
        normalized[canonical_key] = val

    # ensure required field exists even if nothing matched
    if "type" not in normalized:
        normalized["type"] = "wait"
    normalized.setdefault("target", None)
    normalized.setdefault("value", None)
    normalized.setdefault("reasoning", None)
    return normalized

def get_next_action(task_description: str, dom_summary: str, redacted_image_b64: str) -> dict:
    prompt_text = build_prompt(task_description, dom_summary)
    image_bytes = base64.b64decode(redacted_image_b64)

    last_error = None
    for attempt in range(1, MAX_RETRIES + 2):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                    prompt_text,
                ],
            )
            raw_text = response.text.strip()
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
