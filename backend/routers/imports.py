from fastapi import APIRouter, UploadFile, Form, Depends
from sqlalchemy.orm import Session
from db import get_db
from importers.ing import INGImporter
from importers.revolut import RevolutImporter
from importers.degiro import DEGIROImporter
from categorizer.rules import apply_rules
from categorizer.ai import categorise_with_ai
from models import Transaction
from schemas import ImportPreviewResponse, ImportConfirmResponse, ParsedTransactionOut
import io

router = APIRouter(prefix="/import", tags=["import"])

IMPORTERS = {"ing": INGImporter, "revolut": RevolutImporter, "degiro": DEGIROImporter}

def _parse(file: UploadFile, source: str):
    importer = IMPORTERS[source]()
    content = file.file.read()
    return importer.parse(io.StringIO(content.decode("utf-8")))

@router.post("/preview", response_model=ImportPreviewResponse)
async def preview(source: str = Form(...), file: UploadFile = ..., db: Session = Depends(get_db)):
    rows = _parse(file, source)
    existing_hashes = {t[0] for t in db.query(Transaction.import_hash).all()}
    out = []
    for r in rows:
        out.append(ParsedTransactionOut(
            date=r.date, amount=r.amount, description=r.description,
            source=r.source, import_hash=r.import_hash,
            duplicate=r.import_hash in existing_hashes,
        ))
    duplicates = sum(1 for r in out if r.duplicate)
    return ImportPreviewResponse(rows=out, total=len(out), duplicates=duplicates)

@router.post("/confirm", response_model=ImportConfirmResponse)
async def confirm(source: str = Form(...), file: UploadFile = ..., db: Session = Depends(get_db)):
    rows = _parse(file, source)
    existing_hashes = {t[0] for t in db.query(Transaction.import_hash).all()}
    imported = skipped = by_rule = by_ai = uncategorised = 0

    for r in rows:
        if r.import_hash in existing_hashes:
            skipped += 1
            continue
        tx = Transaction(
            date=r.date, amount=r.amount, description=r.description,
            source=r.source, import_hash=r.import_hash, confirmed=False,
        )
        cat = apply_rules(r, db)
        if cat:
            tx.category_id = cat.id
            tx.confirmed = True
            tx.categorised_by = "rule"
            by_rule += 1
        else:
            result = categorise_with_ai(r, db)
            if result:
                cat, confidence = result
                tx.category_id = cat.id
                tx.ai_confidence = confidence
                tx.categorised_by = "ai"
                by_ai += 1
            else:
                uncategorised += 1
        db.add(tx)
        imported += 1

    db.commit()
    return ImportConfirmResponse(
        imported=imported, skipped_duplicates=skipped,
        categorised_by_rule=by_rule, categorised_by_ai=by_ai,
        uncategorised=uncategorised,
    )
