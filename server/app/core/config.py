import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = "gemini-3.6-flash"

if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set. Add it to server/.env")

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
