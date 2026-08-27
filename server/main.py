from fastapi import FastAPI
from app.api.routes import router

app = FastAPI(title="SIH Browser Agent Server")
app.include_router(router)

@app.get("/")
def health_check():
    return {"status": "ok"}
