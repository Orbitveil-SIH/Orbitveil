import base64
import json
from google import genai
from google.genai import types
from app.core.config import GEMINI_API_KEY, GEMINI_MODEL
from app.vlm.prompts import build_prompt

client = genai.Client(api_key=GEMINI_API_KEY)

def get_next_action(
    task_description: str,
    dom_summary: str,
    redacted_image_b64: str,
    history_text: str = "(no actions taken yet)",
) -> dict:
    prompt_text = build_prompt(task_description, dom_summary, history_text)
    image_bytes = base64.b64decode(redacted_image_b64)

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
            prompt_text,
        ],
    )

    raw_text = response.text.strip()
    # strip accidental markdown fences if the model adds them
    raw_text = raw_text.replace("```json", "").replace("```", "").strip()

    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        return {
            "type": "wait",
            "target": None,
            "value": None,
            "reasoning": f"Failed to parse model output: {raw_text[:200]}",
        }
