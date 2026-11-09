from fastapi import APIRouter, HTTPException, UploadFile, Form, Depends
from sqlalchemy.orm import Session
from db import get_db
from importers.ing import INGImporter
from importers.revolut import RevolutImporter
from importers.degiro import DEGIROImporter
from models import Transaction
import import_service
from schemas import ImportPreviewResponse, ImportConfirmResponse, ParsedTransactionOut
import io

router = APIRouter(prefix="/import", tags=["import"])

IMPORTERS = {"ing": INGImporter, "revolut": RevolutImporter, "degiro": DEGIROImporter}

def _parse(file: UploadFile, source: str):
    if source not in IMPORTERS:
        raise HTTPException(status_code=422, detail=f"Unknown source '{source}'. Valid: {list(IMPORTERS)}")
    importer = IMPORTERS[source]()
    content = file.file.read()
    return importer.parse(io.StringIO(content.decode("utf-8", errors="replace")))

@router.post("/preview", response_model=ImportPreviewResponse)
def preview(source: str = Form(...), file: UploadFile = ..., db: Session = Depends(get_db)):
    rows = _parse(file, source)
    existing_hashes = {t[0] for t in db.query(Transaction.import_hash).all()}
    out = []
    for r in rows:
        is_dup = r.import_hash in existing_hashes
        existing_hashes.add(r.import_hash)
        out.append(ParsedTransactionOut(
            date=r.date, amount=r.amount, description=r.description,
            source=r.source, import_hash=r.import_hash,
            duplicate=is_dup,
        ))
    duplicates = sum(1 for r in out if r.duplicate)
    return ImportPreviewResponse(rows=out, total=len(out), duplicates=duplicates)

@router.post("/confirm", response_model=ImportConfirmResponse)
def confirm(source: str = Form(...), file: UploadFile = ..., db: Session = Depends(get_db)):
    rows = _parse(file, source)
    outcome = import_service.import_rows(rows, db)
    return ImportConfirmResponse(
        imported=outcome.imported, skipped_duplicates=outcome.skipped,
        categorised_by_rule=outcome.by_rule, categorised_by_ai=outcome.by_ai,
        uncategorised=outcome.uncategorised,
    )
