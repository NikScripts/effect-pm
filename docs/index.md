{#index title="Introduction" appliesTo=all}
# effect-pm

**Build cross-runtime services on Effect.**

An Effect service lives inside one runtime. A *cross-runtime service* doesn't: define it once, run it
on one process or node, and call it from another over RPC — the same typed handle whether it's local
or across the network.

Normally, moving a queue or a background job to another process means rewriting the call site — an
HTTP client, serialization, its own error handling. A cross-runtime service erases that: you build it
in-process, then serve it, and **the call site never changes.** Local and remote are the same code —
only the layer you provide differs.

``` ts
// define once
class Emails extends QueueResource.Tag<Emails>()("app/Emails", EmailJob) {}

// the call site never changes — local or remote
const emails = yield* Emails
yield* emails.add(job)
```

``` ts
// only the layer you provide differs:
QueueResource.layer(Emails, { effect: send })          // ▸ runs here, in this process
Resource.client(Emails).pipe(Layer.provide(transport)) // ▸ reaches it on another runtime
```
