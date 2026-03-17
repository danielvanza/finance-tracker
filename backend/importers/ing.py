import csv
import io
from decimal import Decimal
from datetime import datetime
from .base import BaseImporter, ParsedTransaction, make_hash

class INGImporter(BaseImporter):
    source = "ing"

    def parse(self, file) -> list[ParsedTransaction]:
        reader = csv.DictReader(io.StringIO(self._read_content(file)), delimiter=";")
        results = []
        for row in reader:
            raw_date = row.get("Date", "").strip().strip('"')
            if not raw_date:
                continue
            tx_date = datetime.strptime(raw_date, "%Y%m%d").date()

            description = row.get("Name / Description", "").strip().strip('"')

            raw_amount = row.get("Amount (EUR)", "0").strip().strip('"').replace(",", ".")
            amount = Decimal(raw_amount)
            if row.get("Debit/credit", "").strip().strip('"').lower() == "debit":
                amount = -amount

            results.append(ParsedTransaction(
                date=tx_date,
                amount=amount,
                description=description,
                source=self.source,
                import_hash=make_hash(self.source, tx_date, amount, description),
            ))
        return results
