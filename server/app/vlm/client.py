import base64
from google import genai
from google.genai import types
from app.core.config import GEMINI_API_KEY, GEMINI_MODEL
from app.vlm.prompts import build_prompt
from app.schema.action_schema import Action

client = genai.Client(api_key=GEMINI_API_KEY)

# Gemini enforces this schema at generation time (constrained decoding), so
# the model is structurally incapable of returning malformed or off-schema
# JSON — no markdown fences, no prose, no missing/extra fields to guard
# against after the fact.
GENERATE_CONFIG = types.GenerateContentConfig(
    response_mime_type="application/json",
    response_schema=Action,
)

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
        config=GENERATE_CONFIG,
    )

    # response.parsed is already an Action instance (the SDK validates it
    # against response_schema for us); .text is the same data as raw JSON
    # if you ever need the string form instead.
    action: Action = response.parsed
    return action.model_dump()
