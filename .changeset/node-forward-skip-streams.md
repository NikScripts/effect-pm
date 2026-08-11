---
"hyperlink-ts": patch
---

`Node.forward` / `forwardAll` stub `stream: true` members as inert Subscribables
(`get` dies, `changes` never) so WorkPool one-shot methods (`add` / `release`)
can forward. Full ref/stream proxy + default client verify over forwarded
WorkPool remain follow-up.
