# Reports and export
- **The Paper Rule.** Print is one A4 page via the named `@page report`, so other pages keep the browser's print setup. Tokens switch to system `Canvas` and `CanvasText` on `html:root[data-theme]:has(.report)` (a plain `:root[data-theme=night]` rule would win otherwise); shadows go off and the shell chrome is hidden through `.shell:has(.report)`.
- Figures are whole euros except the whole-month block (cents). Spending over plan reads "€55 over", never negative.
- A comparison with the month before shows only when that month has bank data.
- CSV: `;` separator, decimal comma, UTF-8 BOM, an `amount_cents` column; text starting `=`, `+`, `-` or `@` gets a leading apostrophe.
