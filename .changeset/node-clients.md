---
"hyperlink-ts": minor
---

Rename **`Node.clientsFor` → `Node.clients`** (no shim). Overloads:

- `Node.clients(Worker, [Jobs, Emails])` / `Node.clients(Worker, Jobs, Emails)` — explicit node; tags cover `ROut`
- `Node.clients([Jobs, Emails])` / `Node.clients(Jobs, Emails)` — node from bound tags (`andNode` / `{ node }`); mismatch → `ClientsNodeMismatch`
