"""Production entry: the API under /api and the built UI at /, on one port.

`uvicorn serve:app` with FRONTEND_DIST pointing at frontend/dist. The app has no sign-in of its own:
bind it to loopback and put something in front that signs people in (see README, "Deployment").
"""
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from main import app as api

dist = Path(os.environ["FRONTEND_DIST"]).resolve()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)


@app.get("/{rest:path}", include_in_schema=False)
def spa(rest: str):
    candidate = (dist / rest).resolve()
    if rest and candidate.is_relative_to(dist) and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})
