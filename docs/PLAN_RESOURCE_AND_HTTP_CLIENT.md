# Plan: Resource model, Run resource, and HttpApi client resource

This document consolidates design decisions and open questions for upcoming work on `@nikscripts/effect-pm`. It is a **plan**, not shipped behavior, except where noted as already implemented.

---

## 1. Goals

- Unify naming under **`Resource`** (umbrella) and focused **`*Resource`** modules (and **Processes** elsewhere) without unnecessary collision anxiety with Effect’s exports.
- Provide a **single HTTP API client entrypoint** that mirrors `HttpApiClient.make` from `@effect/platform`, adds **concurrency / optional throttle** around the full request effect (via `HttpClient.transform`), and matches the ergonomic pattern of existing examples (e.g. NWSL client + `layerNode` / `layerFetch`).
- Keep **one general `make`** for Http API clients; avoid multiple preset entrypoints (`makeRemoteJson`, etc.) for now—use **small helpers** (e.g. `acceptJson`) instead.
- Leave room for **monitoring / controls** in a later major refactor without locking in APIs prematurely.

---

## 2. Naming map (target)

**Umbrella (single object, full API):**

- **`Resource`** — `Resource.make`, `Resource.makeRunner`, `Resource.makeHttpApiClient`, `Resource.makeQueue`, …

**Focused modules (same functions, grouped by kind — optional import style / docs):**

| Module | Delegates to |
|--------|----------------|
| **`RunResource.make`** | **`Resource.make`** |
| **`RunResource.makeRunner`** | **`Resource.makeRunner`** |
| **`HttpApiResource.make`** | **`Resource.makeHttpApiClient`** |
| **`QueueResource.make`** | **`Resource.makeQueue`** |

**Kind names in prose:** **Run** + **HttpApi** + **Queue** (`**RunResource**`, **`HttpApiResource`**, **`QueueResource`**).

---

## 3. Run resource (`RunResource`) — shipped

- Tag value is a **callable** closed over **one** scoped gate (same idea as `mutex.withPermits(1)(task)`): repeated `yield*` does **not** allocate a new semaphore per call.
- **`make`**: configured effect → `yield* run()` or `yield* run(input)`.
- **`makeRunner`**: `yield* runner(effect)` for arbitrary effects (e.g. wrapping `HttpClient`).
- **`HttpClientRunGate`**: `withRunner` / `transformClient` using **`runner(effect)`** (callable runner).

---

## 4. `HttpApiResource.make` / `Resource.makeHttpApiClient` (planned)

### 4.1 Single entrypoint

- **`HttpApiResource.make(api, config)`** === **`Resource.makeHttpApiClient(api, config)`**.

### 4.2 Config shape

- **`client`**: mirrors **`HttpApiClient.make(api, options)`** — **`baseUrl?`**, **`transformClient?`**, **`transformResponse?`**. **`baseUrl`** is a **`string | URL` in config**; callers obtain it however they want (`Config`, env, constant) before calling **`make`**.
- **`limits`**: see **§6** (optional; when absent, no semaphores — wrapper only for future analytics).

**`transformClient` order:** user pipe **first**, then library gate on **`HttpClient.transform`**.

### 4.3 Tag identifier — **decided**

- Default: **`api/${api.identifier}`**.
- **Override** allowed (e.g. `name` / `tagId`) when collisions or app prefixes matter.

### 4.4 Return shape — **same as `QueueResource.make`** (decided)

**`HttpApiResource.make` behaves like `QueueResource.make`:** `Context.Service` keyed by config (default **`api/${api.identifier}`**, override **`name`**), then **`Object.assign(tag, { layer: Layer.effect(tag, _make) })`**. Callers use **`yield* Tag`** and **`Tag.layer`** like other resources—no separate “class vs factory” decision for this API.

**Effect v4** may simplify Tag/Layer ergonomics; **not upgrading now** (time). Revisit when bumping Effect.

**Optional extras** on the returned object (same spirit as convenience, not required for parity): **`layerNode` / `layerFetch`** via **`Layer.provideMerge(Tag.layer, …)`**, or document merges only.

**App-level `class extends Context.Tag`** (e.g. NWSL example) remains valid **outside** this factory when someone wants a named type; it is **not** what **`HttpApiResource.make`** emits.

### 4.5 Internal vs exposed gate — **decided: hidden**

Use a **single scoped `Layer.effect`** that allocates the runner **inside** and calls **`HttpApiClient.make`** with **`transformClient`** applying the gate (**§4.5** rationale kept below for history).

**Advanced:** users who need an injectable gate use **`RunResource.makeRunner`** + manual **`HttpApiClient.make`** (exposed pattern).

**A. Hidden gate (single layer)** — **chosen for `HttpApiResource`**

1. Allocates semaphores / throttler **inside** that scoped effect.
2. Builds **`runner`** from that closure.
3. **`yield* HttpApiClient.make(api, { transformClient: c => … gate(c) … })`**.

**B. Exposed gate (two layers)** — not used for **`HttpApiResource.make`** by default; optional for power users.

### 4.6 `baseUrl` — **decided**

- Only **`string | URL`** (or optional omit) in **`client`** config. No **`Effect` / Tag`** inside the factory for base URL.

---

## 5. `acceptJson` helper (planned)

- **`transformClient`**: `HttpClient.mapRequest(HttpClientRequest.setHeader("Accept", "application/json"))`.
- **Export:** **`acceptJson`** + **`HttpApiResource.acceptJson`** (same reference); optional on **`Resource`**.
- **`make`** does **not** enable it by default.

---

## 6. Limits semantics — **Run** + **HttpApi** (shipped in `RunResource` / `HttpApiResource`)

### 6.1 When **`limits` is omitted** (undefined / not passed)

- **Do not** allocate an **execution** semaphore and **do not** run the **throttler**.
- Effects pass through an **identity** wrapper so **analytics / tracing** can be added later without changing call sites.

### 6.2 When **`limits` is present** (object, possibly partial)

- **`concurrency`**: default **`1`** if omitted — **one** counting semaphore (max bodies running the inner effect at once).
- **`throttle`**: **off** if omitted — no minimum gap between **starts**. If provided, same formula as **`QueueResource`** (spread across execution slots).

### 6.3 Admission / `capacity`

- **Not used** for run or HTTP API resources. **Backpressure / queue depth** belongs to **`QueueResource`**, not the run gate.

---

## 7. Queued resource (`QueueResource`) — shipped

- **`Resource.makeQueue`** === **`QueueResource.make`**.
- Priority queues, enqueue-only, `forkWith`, refill/cache, ProcessManager integration.

---

## 8. Refactor / release order (status)

1. Done: **`HttpApiResource.make`** / **`Resource.makeHttpApiClient`** + **`acceptJson`**.
2. Done: shared **`makeRunResourceWrap`** for **Run** + **HttpApi**.
3. Done: **`RunResource`** + **`HttpClientRunGate`** (+ **`Resource`** umbrella).
4. Done: public API is **`QueueResource`** (implementation module `QueueResource.ts`); **`ResourcePool`** name removed.

---

## 9. Decided / closed

| Topic | Decision |
|--------|-----------|
| Umbrella HTTP method name | Keep **`makeHttpApiClient`**. |
| **`baseUrl`** | **`string \| URL`** in config only; caller supplies value. |
| Tag id | Default **`api/${identifier}`**, **override** allowed. |
| Gate in **`HttpApiResource`** | **Hidden** (single layer); see **§4.5**. |
| **`HttpApiResource.make` surface** | Same pattern as **`QueueResource.make`** (**§4.4**). Effect **v4** deferred. |
| Backwards compatibility | **Not a concern**; breaking changes OK. |

**Closed:** **`limits: {}`** → concurrency **1**, no throttle, single execution semaphore (**§6.2**).

---

## 10. Related docs

- `FUTURE.md` — unrelated enhancement ideas.
- `MIGRATION_0.4.0.md` — historical queue-resource callback API.
- `examples/http-client-run-gate.ts` — HTTP client + run gate pattern.
- `examples/nwslsoccer/client.ts` — `acceptJson` + `HttpApiClient.make` with config `baseUrl`.

---

## 11. Notes

- **`HttpApiClient.make`** does **not** default **`baseUrl`**; omitting it skips `prependUrl`.
- Omitting **`transformClient`** passes **`HttpClient`** through unchanged except **`baseUrl`** handling in platform.
