---
"hyperlink-ts": minor
---

Nameless / address-less `Node.http` and `Node.ws` accept `options.port` or `options.url` for a fixed loopback listen address (omit for ephemeral). Prefer these over `httpServer` / `wsServer` when the battery bind is enough.
