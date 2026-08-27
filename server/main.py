from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import EXTENSION_ID, ALLOW_ANY_EXTENSION_ORIGIN, EXTRA_CORS_ORIGINS

app = FastAPI(title="SIH Browser Agent Server")

# --- CORS ---------------------------------------------------------------

allow_origins: list[str] = list(EXTRA_CORS_ORIGINS)
allow_origin_regex = None

if EXTENSION_ID:
    # Known, stable extension ID -> lock CORS down to exactly that origin.
    allow_origins.append(f"chrome-extension://{EXTENSION_ID}")
elif ALLOW_ANY_EXTENSION_ORIGIN:
    
    allow_origin_regex = r"^chrome-extension://.*$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=False,   # no cookies/auth headers in play; keep this false
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(router)


@app.get("/")
def health_check():
    return {"status": "ok"}