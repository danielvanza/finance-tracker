# Reports and export
- **The Paper Rule.** Print is one A4 page via the named `@page report`, so other pages keep the browser's print setup. Tokens switch to system `Canvas` and `CanvasText` on `html:root[data-theme]:has(.report)` (a plain `:root[data-theme=night]` rule would win otherwise); shadows go off and the shell chrome is hidden through `.shell:has(.report)`.
- Figures are whole euros except the whole-month block (cents). Spending over plan reads "€55 over", never negative.
- A comparison with the month before shows only when that month has bank data.
- CSV: `;` separator, decimal comma, UTF-8 BOM, an `amount_cents` column; text starting `=`, `+`, `-` or `@` gets a leading apostrophe.
- **Panel width, not viewport.** `.rep-group` is a size container: the four By category columns show from 32rem of panel, below that the phone layout (name over change, figures right) stays, so larger text never squeezes the name to nothing. Any new table rule in the report goes in that `@container`, not a viewport query. "What moved" is auto-fit columns of at least 17rem: one list takes the full panel, two sit side by side.
- Phone action chips (under 720px) are one row of three equal chips that never wrap (`flex: 1 1 0; min-width: 0`), down to 320px.
- **Folds are screen-only.** Rows with nothing spent and nothing different from the month before fold into one "Nothing spent in N categories" line per group (only when there are two or more), and "What moved" sits behind one row, closed. Both stay in the DOM, hidden by `.is-open` classes, so print forces them shown: the statement lists every category.
- The report's period label drops "day N of M" up to 430px (the year makes it longer than Month's).
