# -*- coding: utf-8 -*-
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.auth import router as auth_router
from api.accounts import router as accounts_router
from api.courses import router as courses_router
from api.playback import router as playback_router
from api.events import router as events_router
from api.profiles import router as profiles_router


app = FastAPI(title="Course Auto Player Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(accounts_router, prefix="/api")
app.include_router(courses_router, prefix="/api")
app.include_router(playback_router, prefix="/api")
app.include_router(events_router, prefix="/api")
app.include_router(profiles_router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": True, "message": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8765)
