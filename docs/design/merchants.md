# Merchants
- **Merchant Key Rule.** A merchant is `merchantFor(description).key`: lowercase, cut at the first `*`, the first token with three or more digits, then a trailing country and city, `.nl` stripped. It must stay a substring of the lowercase description because it is used verbatim as a rule pattern; under 4 characters it never gets a rule.
- **One rule per shop.** The sheet creates the rule with `POST /rules` and the key (never `create-rule`, which pins the whole description), then settles only that merchant's unconfirmed purchases. Confirmed history is never recategorised.
- **The rule button is vermilion** only when the shop is sorted one way; plain when it is sorted several ways or the key is too short.
- **No zero for a missing month:** a financial month without bank data shows an empty track and a dash, never a zero or a bar.
