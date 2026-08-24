---
"hyperlink-ts": minor
---

Add `hyperlink-ts/Address` factories (`http` / `ws` / `unix` / `unixFromKey`) and
`Node.make(key, Address | Address[], opts?)` with `.pipe(Address.*, NodePolicy.*)`.
Address lists accumulate (unlabeled ≠ primary; primary set is
`NodePolicy.primaryAddress`). Same concrete dial twice → `Address.DialOverlap`.
