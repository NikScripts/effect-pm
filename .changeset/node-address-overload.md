---
"hyperlink-ts": minor
---

Add an address overload to `Resource.Node`, matching `clientHttp`'s `target`. A node can now carry its endpoint as a **port**, a `":port"`, or a full **url** — not only `{ url }`:

```ts
class Worker extends Resource.Node<Worker>("app/Worker", 3001) {}                   // → http://localhost:3001/rpc
class Mail   extends Resource.Node<Mail>("app/Mail", "https://mail.internal/rpc") {} // full url, as-is
```

Ports and `":port"` resolve to an `/rpc` url exactly as `clientHttp` does; a full url is used verbatim; `{ url }` still works. Since the node carries its address, `peersLayer`/`httpClient` reach it with no separate url to configure.
