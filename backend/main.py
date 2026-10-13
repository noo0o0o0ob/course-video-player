# -*- coding: utf-8 -*-
import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.auth import router as auth_router
from api.accounts import router as accounts_router
from api.courses import router as courses_router
from api.playback import router as playback_router
from api.events import router as events_router
from api.profiles import router as profiles_router
from core.security import LocalAccessMiddleware, access_policy


app = FastAPI(title="Course Auto Player Backend")
app.add_middleware(LocalAccessMiddleware, policy=access_policy)

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(access_policy.browser_origins | {"null"}),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
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


@app.post("/api/client-session", include_in_schema=False)
def client_session(request: Request):
    if not access_policy.trusted_origin(request.scope, dict(request.headers), browser_session=True) or not request.headers.get("content-type", "").lower().startswith("application/json"):
        raise HTTPException(status_code=403, detail="仅允许可信本地页面建立客户端会话")
    return JSONResponse({"token": access_policy.token}, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    details = [{"loc": item["loc"], "msg": item["msg"], "type": item["type"]} for item in exc.errors()]
    return JSONResponse({"detail": details}, status_code=422)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("COURSE_BACKEND_PORT", "8765")), access_log=False)
