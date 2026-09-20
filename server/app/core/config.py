import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
# meta-llama/llama-4-scout-17b-16e-instruct was deprecated and retired by
# Groq on 2026-06-17 - requests to it now 404 with "model_not_found".
# qwen/qwen3.8-27b is Groq's current recommended vision-capable successor
# (qwen/qwen3.6-27b also still works as of this writing but is itself
# being phased out in favor of 3.8 - see https://console.groq.com/docs/deprecations).
GROQ_MODEL = "qwen/qwen3.8-27b"

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY not set. Add it to server/.env")

# --- CORS ---------------------------------------------------------------
# Manifest V3 extensions send an Origin header of the form
# "chrome-extension://<extension-id>". The extension ID is random for
# unpacked/dev extensions and only becomes stable once published (or if
# you pin a "key" in manifest.json). Two ways to configure this:
#
# 1. Set EXTENSION_ID in server/.env once you know it (recommended once
#    you've loaded the unpacked extension once - copy the ID from
#    chrome://extensions).
# 2. Leave it unset and rely on ALLOW_ANY_EXTENSION_ORIGIN (dev only) which
#    matches any chrome-extension:// origin via regex. Never ship this to
#    prod - lock it down to EXTENSION_ID once you have one.
EXTENSION_ID = os.getenv("EXTENSION_ID")
ALLOW_ANY_EXTENSION_ORIGIN = os.getenv("ALLOW_ANY_EXTENSION_ORIGIN", "true").lower() == "true"

EXTRA_CORS_ORIGINS = [
    o.strip() for o in os.getenv("EXTRA_CORS_ORIGINS", "").split(",") if o.strip()
]