from fastapi import APIRouter, HTTPException, UploadFile, Form, Depends
from sqlalchemy.orm import Session
from db import get_db
from importers.ing import INGImporter
from importers.revolut import RevolutImporter
from importers.degiro import DEGIROImporter
from categorizer.rules import apply_rules
from categorizer.ai import batch_categorise_with_ai
from models import Transaction
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
async def preview(source: str = Form(...), file: UploadFile = ..., db: Session = Depends(get_db)):
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
async def confirm(source: str = Form(...), file: UploadFile = ..., db: Session = Depends(get_db)):
    rows = _parse(file, source)
    existing_hashes = {t[0] for t in db.query(Transaction.import_hash).all()}
    imported = skipped = by_rule = by_ai = uncategorised = 0

    # First pass: apply rules, collect uncategorised for batch AI
    new_transactions = []  # (ParsedTransaction, Transaction)
    ai_pending = []  # (index into new_transactions, ParsedTransaction)

    for r in rows:
        if r.import_hash in existing_hashes:
            skipped += 1
            continue
        existing_hashes.add(r.import_hash)
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
            ai_pending.append((len(new_transactions), r))
        new_transactions.append(tx)
        imported += 1

    # Batch AI categorisation for all uncategorised transactions
    if ai_pending:
        pending_txs = [r for _, r in ai_pending]
        ai_results = batch_categorise_with_ai(pending_txs, db)
        for ai_idx, (tx_idx, _) in enumerate(ai_pending):
            result = ai_results.get(ai_idx)
            if result:
                cat, confidence = result
                new_transactions[tx_idx].category_id = cat.id
                new_transactions[tx_idx].ai_confidence = confidence
                new_transactions[tx_idx].categorised_by = "ai"
                by_ai += 1
            else:
                uncategorised += 1

    for tx in new_transactions:
        db.add(tx)
    db.commit()
    return ImportConfirmResponse(
        imported=imported, skipped_duplicates=skipped,
        categorised_by_rule=by_rule, categorised_by_ai=by_ai,
        uncategorised=uncategorised,
    )
