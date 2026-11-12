# Transactions
- **Position Rule.** Select mode adds a first tick column: the phone grid and the 721–1180 px column hiding have `.has-pick` variants, so every cell index shifts by one.
- **Queue counts** ("N to review", "N remaining") come from the queue's own query, never from the filtered or loading list.
- **A row's description** is the merchant name over at most two lines of bank text (`.mer-raw`); without a merchant provider it falls back to the two-line clamp that opens on tap.
- **Fixed bars** (the selection bar) clear the chat button: on desktop they stop one button short, on a phone they sit above the tab slab at a higher z-index.
- **Bulk actions** run one PATCH per row and report "1 of 3 saved", keeping the failed rows ticked. Delete only appears when every ticked row is manual. Confirm stays plain so the page keeps one vermilion mark.
- **"This month"** uses the pace endpoint's `start_date`/`end_date`, never the calendar. `?q=` sets the search on arrival.
- Remember this shop for next time is a tick box under Confirm, unticked by default: a rule is only made when it is ticked. The line under it says the shop's other waiting payments follow either way.
