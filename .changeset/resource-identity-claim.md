---
"hyperlink-ts": minor
---

**Resource.identity (S1)** — claim-then-serve-or-client at Lookup.

- `Resource.identity` pipe stamps any Tag; `layer` / `serve` claim `tag.key` first.
- Winner runs the local impl (serve exposes handlers); loser becomes a client of `DuplicateIdentity.original`.
- Dialable `self` Node required (`options.self` or the tag's bound Node); fail-closed without Lookup.
- Identity Tags refuse multi-node fleets (`IdentityMultiNode`); single-node overwrite still OK.
