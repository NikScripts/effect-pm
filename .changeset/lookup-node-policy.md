---
"hyperlink-ts": minor
---

Rename `hyperlink-ts/Policy` → **`hyperlink-ts/LookupPolicy`** (plural constructable
`LookupPolicies`; Context keys `hyperlink-ts/LookupPolicy/…`). Add
**`hyperlink-ts/NodePolicy`** (`NodePolicies`) for `PrimaryAddress` / listen /
advertise / proxy / as. Owned modes are PascalCase (`AllUnlabeled`, `All`,
`Primary`, `Prefer`). Both modules share `PolicyBuilder`. No `Policy` subpath.
