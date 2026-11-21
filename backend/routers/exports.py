"""A file made in the chat (exports.py), downloaded from its link in the bubble or sent by the Telegram bot."""
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from db import get_db
from models import Export

router = APIRouter(prefix="/exports", tags=["exports"])


@router.get("/{export_id}")
def download_export(export_id: int, db: Session = Depends(get_db)) -> Response:
    export = db.get(Export, export_id)
    if export is None:
        raise HTTPException(404, "That file is no longer kept. Ask for it again in the chat.")
    plain = export.filename.encode("ascii", "replace").decode().replace("?", "_").replace('"', "_")
    return Response(content=export.content, media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f"attachment; filename=\"{plain}\"; filename*=UTF-8''{quote(export.filename)}",
        "Cache-Control": "private, no-store",
    })
