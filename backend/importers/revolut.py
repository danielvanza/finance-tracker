import csv
import io
from decimal import Decimal
from datetime import datetime
from .base import BaseImporter, ParsedTransaction, make_hash

class RevolutImporter(BaseImporter):
    source = "revolut"

    def parse(self, file) -> list[ParsedTransaction]:
        content = file.read() if hasattr(file, 'read') else file
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        reader = csv.DictReader(io.StringIO(content))
        results = []
        for row in reader:
            if row.get("State", "").strip() == "REVERTED":
                continue
            raw_date = row.get("Started Date", "").strip()
            if not raw_date:
                continue
            tx_date = datetime.fromisoformat(raw_date).date()
            description = row.get("Description", "").strip()
            amount = Decimal(row.get("Amount", "0").strip())
            results.append(ParsedTransaction(
                date=tx_date,
                amount=amount,
                description=description,
                source=self.source,
                import_hash=make_hash(self.source, tx_date, amount, description),
            ))
        return results
