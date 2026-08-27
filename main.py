from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router

app = FastAPI(title="SIH Browser Agent Server")

# Allow the extension to call this server from a browser context.
# Tighten allow_origins once we know the extension's exact origin scheme.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: restrict to chrome-extension://<id> before submission
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

@app.get("/")
def health_check():
    return {"status": "ok"}
