# Reports and export
- **The Paper Rule.** Print is one A4 page via the named `@page report`, so other pages keep the browser's print setup. Tokens switch to system `Canvas` and `CanvasText` on `html:root[data-theme]:has(.report)` (a plain `:root[data-theme=night]` rule would win otherwise); shadows go off and the shell chrome is hidden through `.shell:has(.report)`.
- Figures are whole euros except the whole-month block (cents). Spending over plan reads "€55 over", never negative.
- A comparison with the month before shows only when that month has bank data.
- CSV: `;` separator, decimal comma, UTF-8 BOM, an `amount_cents` column; text starting `=`, `+`, `-` or `@` gets a leading apostrophe.
- **Panel width, not viewport.** `.rep-group` is a size container: the four By category columns show from 32rem of panel, below that the phone layout (name over change, figures right) stays, so larger text never squeezes the name to nothing. Any new table rule in the report goes in that `@container`, not a viewport query. "What moved" is auto-fit columns of at least 17rem: one list takes the full panel, two sit side by side.
- Phone action chips (under 720px) share the row equally but never get narrower than their words (`min-width: max-content`), so scaled text wraps them rather than clipping; under 380px Print takes a row of its own.
- The report's period label drops "day N of M" up to 430px (the year makes it longer than Month's).
