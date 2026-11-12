from fastapi import APIRouter, HTTPException, UploadFile, Depends
from sqlalchemy.orm import Session
from db import get_db
from importers.ing import BadFile, parse_ing
import import_service
from schemas import ImportPreviewResponse, ImportConfirmResponse, ParsedTransactionOut

router = APIRouter(prefix="/import", tags=["import"])

ACCEPTED = "Only an ING export (a CSV file, with English or Dutch column names) can be imported."


def _parse(file: UploadFile):
    try:
        return parse_ing(file.file.read())
    except BadFile as e:
        raise HTTPException(status_code=422, detail=f"That file could not be used because {e}. {ACCEPTED}") from None


@router.post("/preview", response_model=ImportPreviewResponse)
def preview(file: UploadFile = ..., db: Session = Depends(get_db)):
    rows = _parse(file)
    out = [
        ParsedTransactionOut(
            date=r.date, amount=r.amount, description=r.description,
            source=r.source, import_hash=r.import_hash, duplicate=known,
        )
        for r, known in zip(rows, import_service.already_here(rows, db))
    ]
    return ImportPreviewResponse(rows=out, total=len(out), duplicates=sum(1 for r in out if r.duplicate))


@router.post("/confirm", response_model=ImportConfirmResponse)
def confirm(file: UploadFile = ..., db: Session = Depends(get_db)):
    from assistant import service as chat_service  # the chat asks about what Claude was not sure of

    rows = _parse(file)
    outcome = import_service.import_rows(rows, db)
    chat_service.after_import()
    return ImportConfirmResponse(
        imported=outcome.imported, skipped_duplicates=outcome.skipped,
        categorised_by_rule=outcome.by_rule, categorised_by_ai=outcome.by_ai,
        doubtful=outcome.doubtful, uncategorised=outcome.uncategorised, notes_added=outcome.noted,
    )
