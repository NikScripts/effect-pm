# Proposal: make illegal states unrepresentable

**Status (2026-07-16):** clean wins SHIPPED to integration. **P1** (node↔protocol wiring bug → compile error) and **P5** (browser http transport dies) merged. **P2** skipped (needs a cast — `makeNode` typing complexity, same wall as reverted `connectFleet`; narrow win the runtime throw already covers). **P4** was ALREADY ENFORCED (loose-fields payload shorthand already rejected — mis-scoped here). **P3** deferred (`serverImpl` sees opaque serve layers → coupled). See `api-changes-2026-07-16.md`. Breaking changes were in scope (owner approved).
**Principle:** *the wrong thing shouldn't compile; the risky thing should be loud; the common thing should be one line.* This proposal is about the first clause — converting runtime footguns into compile errors.

Each item below shows **the wrong code that compiles today**, the change that makes it **not compile**, the breaking impact, and who owns it.

---

## P1 — Close the node↔protocol type-hole (the dashboard bug) ★ highest value

**Wrong code that compiles today:**
```ts
// NodeStatus is nodeless → its client needs an ambient RpcClient.Protocol.
// Providing a *node transport* instead type-checks as fully wired (requires `never`)…
Hyperlink.client(NodeStatus.Tag).pipe(Layer.provide(dropletTransport))
// …then throws at runtime: "Service not found: RpcClient/Protocol". The dashboard's
// "connecting… forever" bug, twice.
```

**Proven by probe:** `client(NodeStatus.Tag)` requires `RpcClient.Protocol`; `socketClient(Droplet)` provides `Droplet`; yet the composed layer requires `never`. **The type system reports the broken wiring as correct.**

**Root cause:** a node is `NodeKey<Self> = Context.Key<Self, NodeProtocol>` where `NodeProtocol` *is* `RpcClient.Protocol`'s service shape — so at the type level a node and the protocol are interchangeable (which is also what makes `connect` work: a node's value *is* the protocol). That structural identity is what collapses the requirement to `never`.

**The fix (breaking):** give a node a **type-distinct** value from a bare `RpcClient.Protocol` — a branded `NodeProtocol` (e.g. `RpcClient.Protocol['Service'] & { readonly [NodeBrand]: HSelf }`, or a thin wrapper). Then:
- `client(tag).pipe(provide(node))` **fails to compile** — a node doesn't satisfy a bare `RpcClient.Protocol` requirement.
- The only forms that compile are the correct ones: `client(tag, node)` (unwraps the node → protocol), `connect(node, …)`, or providing an actual protocol layer.
- `connect`/`clientLayer` internally unwrap the brand (one place), so runtime behavior is unchanged.

**Breaking impact:** `NodeKey`'s value type changes; `connect` / `client` / `socketClient` internals adjust to wrap/unwrap. Consumers who wired the *correct* way are unaffected; the *wrong* way now errors (the point). **First implementation step:** pin the exact `Layer.provide` collapse (narrowed to the node/protocol structural identity) and confirm the brand severs it.

**Owner:** `src/Hyperlink.ts` node/client core — **C's zone**; breaking-OK makes it doable, but it's the one piece that needs coordination.

## P2 — `connect(unaddressedNode)` → compile error ★ foundation, fully mine

**Wrong code that compiles today:**
```ts
class Bare extends Hyperlink.Node<Bare>("bare") {}   // no url/kind
Bare.pipe(Hyperlink.connect)                          // compiles; throws UnaddressedNode at runtime
```

**The fix:** overload `makeNode` so it returns `AddressedNode<Self>` (precise `url: string; kind: ProtocolKind`) when given an address, and a bare node otherwise; `connect`'s derived overload already wants `AddressedNode`. Then the derived form on an addressless node **doesn't compile**. (The `connectSocket(node, url)` runtime-url path — used by the browser dashboard — stays legal.)

**Breaking impact:** additive precision; only the genuinely-broken `connect(bareNode)` starts erroring. This also builds the **precise node-typing machinery** P1/P4 reuse.

**Owner:** `src/Hyperlink.ts` `makeNode` — **mine**, self-contained. Deferred earlier only because of `store`/`logs` return-type entanglement; tractable with overloads.

## P3 — Serve-time protocol mismatch → compile-or-boot error

**Wrong code that compiles today:**
```ts
class Live extends Hyperlink.Node<Live>("live", { kind: "socket" }) {}
// serving a socket-declared node's resource over an http server — no error anywhere:
Hyperlink.httpServer([WorkPool.serve(LiveQueue, cfg)])
```

**The fix:** with nodes carrying `kind` (shipped) and branded (P1), `wsServer`/`httpServer` assert each served tag's node `kind` matches — a boot-time `ProtocolKindMismatch`, or (if the served-tag type surfaces the kind) a **compile** error.

**Breaking impact:** serving a mis-declared node now fails at boot instead of silently. **Owner:** `serverImpl` — **C's zone**.

## P4 — Remove the loose-fields schema shorthand

**Wrong code that compiles today:**
```ts
// loose-fields shorthand for a payload/input — already bit the queues (silent shape drift):
WorkPool.Service<Q>()("q", { a: Schema.String, b: Schema.Number })   // vs { payload: Struct }
```

**The fix:** require a single `Struct` schema for payloads/inputs; drop the loose-fields form. The illegal state (ambiguous loose fields) becomes unrepresentable.

**Breaking impact:** call sites using the shorthand update to the struct form (mechanical). Broad but shallow. **Owner:** schema input types across resource tags — **mine + C overlap**; higher blast radius, so sequence after the others land.

## P5 — Make the browser starve-transport impossible

**Wrong code that compiles today:**
```ts
// in a browser: httpClient starves at ~6 HTTP/1.1 connections — blank dashboard, only a runtime warn:
Hyperlink.httpClient(node, { url })   // in a browser build
```

**The fix (breaking):** remove `httpClient`/`clientHttp` from the **browser-safe** surface (they stay on the node/CLI barrel), or hard-fail them in browser context. A browser build can only reach `socketClient`. The starving transport is not importable where it starves.

**Breaking impact:** browser code using `httpClient` moves to `socketClient` (the correct choice anyway). **Owner:** the barrel/subpath split — **mine** (browser-safety boundary is documented). Nuance retired: "few streams is fine" isn't worth a footgun that ships blank dashboards.

---

## Sequencing & recommended first task

```
P2 (bare-node, mine, foundation)  ──►  P1 (node↔protocol, C-coord, the big win)  ──►  P3 (serve assert)
                                                                                   └─►  P5 (browser surface, mine)
                                   P4 (loose-fields) last — broadest blast radius
```

**Recommended first task: P2.** It's fully mine, non-breaking-in-spirit (adds precision), converts a runtime throw I just shipped into a compile error, and — crucially — produces the **precise node-typing** (`AddressedNode` returned by `makeNode`) that P1 and P3 build on. So it's both a clean standalone win *and* the enabling step for the highest-value fix.

**Then P1** as the coordinated centerpiece with C: brand the node so the dashboard bug can't be typed. That's the one that pays off the whole "impossible" thesis.

**Open questions for the owner:**
1. P1 brand shape — a phantom brand on the service type vs a wrapper object (affects how much of `connect`/`client` touches). Pin during P1 step 1.
2. P4 timing — land it early (rip the band-aid) or last (least disruption to in-flight agent work)?
3. P5 — remove from browser surface vs hard-fail at runtime? Removal is the stronger "impossible."
