import csv
import io
from decimal import Decimal
from datetime import datetime
from .base import BaseImporter, ParsedTransaction, make_hash

class DEGIROImporter(BaseImporter):
    source = "degiro"

    def parse(self, file) -> list[ParsedTransaction]:
        reader = csv.DictReader(io.StringIO(self._read_content(file)))
        results = []
        for row in reader:
            raw_date = row.get("Date", "").strip()
            if not raw_date:
                continue
            tx_date = datetime.strptime(raw_date, "%d-%m-%Y").date()
            description = row.get("Product", "").strip()
            # DEGIRO CSV has duplicate/empty headers; "Change" maps directly to the amount column
            raw_amount = row.get("Change", "").strip()
            if not raw_amount:
                continue
            amount = Decimal(raw_amount.replace(",", "."))
            results.append(ParsedTransaction(
                date=tx_date,
                amount=amount,
                description=description,
                source=self.source,
                import_hash=make_hash(self.source, tx_date, amount, description),
            ))
        return results
