# Plan: service / contract shapes

**Status:** partial Eng (2026-07-26); remainder owner-gated.  
**Agent:** 4 (`cursor/hyperservice-open-deps-5679`).  
**Prior art:** [`service-shape-redesign.md`](../handoffs/archive/2026-07/features/service-shape-redesign.md) (2026-07-01/02), [`client-adapters-design.md`](../handoffs/client-adapters-design.md).  
**Orthogonal:** wire RpcGroup identity — [`wire-groups-and-identity.md`](./wire-groups-and-identity.md) (W1–W3 Eng’d; do not conflate with handle taxonomy).  
**Paused Eng:** `default` / `defaults` adornments (named **LOCKED** 2026-07-27; not coded). Creating polish after Eng.

Goal: support the **widest useful variety** of service shapes without silent local↔remote divergence, and without turning the Spec into every host-language return type (Promise, sync fn, …).

---

## The law (unchanged)

A field behaves **identically** local and remote, **or** its divergence is **loud** (type / capability error), like `local`. Same-looking-but-different is banned.

Wire leaves stay **Schema-serializable**. Non-Effect host APIs (Promise, TanStack, …) are **adapters over the handle**, not Spec builders.

---

## Three axes (the real design space)

Every leaf is a point in:

### 1. Resolve timing (when the consumer-visible value is produced)

| Timing | Meaning | Re-`yield* Tag`? |
|--------|---------|------------------|
| **Tag-baked** | Literal lives on the Spec / Tag | Same forever (both sides import the Tag) |
| **Materialize** | Resolved when the service object is built (layer / client acquire) | **No** — same service object; new materialization can differ |
| **Pull** | Resolved each call / each `yield*` of that member | Yes, per use |
| **Push cell** | Cell filled at acquire, then patched by a background stream | Cheap re-read of cell; updates arrive async |
| **Subscribe** | Consumer opens a Stream / Subscribable | Continuous |

Today’s `constant(Schema)` is **materialize**, not Tag-baked and not push. That is why `yield* Tag` again does not refresh it.

### 2. Handle surface (what TypeScript / the caller sees)

| Surface | Today |
|---------|-------|
| plain `A` | `constant` (materialize) |
| `Effect<A>` | `effect` |
| `(In) => Effect<A>` | `effectFn` / `mutatePair` |
| `Stream<A>` | `stream` |
| `Subscribable<A>` (`.get` Effect + `.changes` Stream) | `ref` |
| `Effect<T, …, Local>` / interface locals | `local` / `fromService` |
| `Promise<A>`, sync `(In) => A`, live plain `A` cell | **not Spec** (adapters or parked) |

### 3. Wire role

| Role | Meaning |
|------|---------|
| **Wire** | Schema + RPC procedure(s); must round-trip |
| **Tag metadata** | No procedure; client reads Spec (Tag-baked only) |
| **Local-only** | Loud if used through a client |
| **Adapter** | Outside Spec; wraps an Effect handle |

---

## What is Eng’d today

| Builder | Timing | Surface | Wire |
|---------|--------|---------|------|
| `effect` / `effectFn` / `mutatePair` | pull | Effect / fn→Effect | yes |
| `stream` | subscribe | Stream | yes |
| `ref` | subscribe (+ cached get) | Subscribable | yes (stream wire) |
| `constant(Schema)` | **materialize** | plain `A` | yes (one query at acquire) |
| `local` / `fromService` | n/a | local shapes | loud remote |
| Nested groups | — | nested object | path-keyed wire |
| Client override (`effectFn<Client>()`, `unsafe*`) | — | **type-only** phantom | runtime still Effect |

**Not Eng’d (from the 2026-07-02 lock, names collide with today):**

- Live **plain** `p.x: A` updated by a merged delta stream (`value` in that doc).
- Tag-baked literals.
- Client→server streaming (`sink` / upload).
- `queue` / `pubsub` push fields.
- True sub-resources (child HyperService in Spec).
- Fallible materialize fields (`E ≠ never` at acquire).
- Promise / sync-fn Spec leaves.

**Docs gap:** getting-started lists effect / effectFn / ref / stream only; `constant` is omitted.

---

## Naming collision to resolve

| Name | 2026-07-02 lock | Eng’d today | This discussion |
|------|-----------------|-------------|-----------------|
| `constant` | materialize plain | materialize plain | free for **Tag-baked** literal |
| `value` | **live** plain cell | unused public builder | owner lean: rename today’s materialize → **`value`** |
| `ref` | parked then | **Subscribable** (Eng’d) | keep |

**Proposal to lock (owner):**

1. Rename today’s `constant(Schema)` → **`value(Schema)`** = materialize plain `A`.
2. Reserve **`constant(literal)`** = Tag-baked plain `A` (no impl, no wire round-trip).
3. Keep **`ref`** = Subscribable (explicit get + changes).
4. If we still want **live plain** `p.x: A` (cell patched in place, `yield* Tag` stays cheap), that is a **fourth** shape — do not overload `value`. Candidate names: `cell`, `live`, `state` (pick later; only if Subscribable is not enough).

---

## Target taxonomy (wide, still lawful)

### In-Spec (Effect-native, Schema where wired)

```
Tag-baked     constant(literal)     → plain A          (no wire)
Materialize   value(Schema)         → plain A          (resolve at acquire; rename of today)
Pull          effect / effectFn     → Effect / fn
Subscribe     stream                → Stream
Subscribe+get ref                   → Subscribable
Local         local / fromService   → loud remote
Group         { … }                 → nested service
```

Optional later in-Spec (only if a real product need beats `ref`):

```
Push cell     cell(Schema)          → plain A, patched by delta stream
              (old lock’s “value”; acquire blocks on first delta)
Upload        sink / streamFn       → client→server (needs transport)
Sub-resource  child Tag embed       → nested HyperService identity
```

### Outside Spec (adapters)

```
Promise / async     wrap handle methods with runPromise / async iterables
TanStack hooks      Hyperlink.useQuery / useMutation (see client-adapters-design)
Effect-reactive     atoms / AsyncResult for dashboards
```

Adapters must not invent wire semantics the Spec lacks (no polling live fields).

---

## Materialize vs pull vs push (why this talk happened)

```
materialize (today’s constant / proposed value)
  Layer build ──resolve Effect──► plain A stuck on service object
  yield* Tag  ──reads Context──► same object, same A

pull (effect)
  yield* p.x  ──RPC / local Effect──► fresh A every time

push cell (parked live plain)
  acquire ──first delta──► cell
  background stream patches cell
  yield* Tag reads cell (cheap); A changes without new materialize

ref (Eng’d)
  like push, but surface is Subscribable, not plain A
```

**Product question for owner:** is “plain `A` that stays live” required, or is `ref` + adapters enough for dashboards? That single answer decides whether `cell`/`live` is in scope or parked forever.

---

## Eng’d (2026-07-26)

- `Tag<Self, I>()` + overload arity; `value(Schema)` (materialize, fallible OK); `Hyperlink.promise`; `Hyperlink.pure`.
- Wire identity W1–W3 Eng’d (orthogonal) — [`wire-groups-and-identity.md`](./wire-groups-and-identity.md).

## LOCKED — `default` / `defaults` (2026-07-27 bake)

Placeholder name was `Hyperlink.handle`. **Rejected** as the public noun.

| API | Shape | Role |
|-----|--------|------|
| **`Hyperlink.default(…)`** | Spec leaf (singular) | One default field **in the contract** |
| **`Hyperlink.defaults({…})`** | Piped bag (plural) | Add **multiple** defaults: `Tag(…).pipe(Hyperlink.defaults({…}))` |

Design substance (Jul 26 chat — not Eng’d yet):

- Spec stays branded builders; `defaults` bag merges onto the service (local + client).
- Overrides via Effect / `Layer.updateService` (not `client(Tag, { handle })`).
- `layer(Tag, ImplOf<Spec> & Partial<Defaults>)` — wire required; default keys optional.
- Construction-time adorn OK; post-construction adorn → **new** named Context key.
- Hard lean: also a Prototype pipe feature (`Prototype({spec}).pipe(defaults({…}))` then mint).
- Name bikeshed discarded: `handle` / `with` / `adorn` / `features` / `aspect` / `stock`.

**Still open before Eng:** what `default` accepts (literals only vs fns/`Effect` too); fate of shipped `Hyperlink.pure`; deep-merge / same-key loudness details; Prototype-only vs Tag.pipe first slice.

## Open decisions (owner)

1. ~~Rename `constant` → `value`~~ **done**.
2. ~~Tag-baked / handle bag naming~~ **done** — `default` (Spec) / `defaults` (pipe).
3. Live plain cell (`cell`): Eng, park, or reject in favor of `ref`?
4. ~~Fallible materialize~~ **done** (`value` + `E`).
5. ~~Promise adapter~~ **done** (`Hyperlink.promise`).
6. Getting-started polish — after `default`/`defaults` Eng + names settle.
7. **`default` payload + `pure` fate** — baking now.

---

## Suggested remaining slices

| Slice | Scope |
|-------|--------|
| **S2** | Eng `default` / `defaults` (+ `pure` migrate or keep) |
| **S3** | Docs: Creating / Core Concepts taxonomy |
| **S5** | Live plain `cell` (only if decision 3 = Eng) |
| **S6** | Upload / sink (transport-gated) |

---

## Non-goals

- Spec builders that return `Promise` or sync `(In) => A` as the native handle shape.
- Silent divergence (local plain vs remote Effect for the “same” field).
- Polling adapters for “live” dashboard data.
- Replacing `ref` with plain cells for TUI/web unless decision 3 says so.

---

## References

- Eng’d builders: `src/Hyperlink.ts` (`effect`, `effectFn`, `stream`, `ref`, `value`, `local`, `pure`, `promise`).
- Materialize resolve: `buildLocalContext` / `buildClientService` (`isValueMethod` branches).
- Tests: `test/resource-value-plain.test.ts`, `resource-pure*`, `resource-promise*`, nesting / stream suites.
- Adapters: [`client-adapters-design.md`](../handoffs/client-adapters-design.md); wire identity: [`wire-groups-and-identity.md`](./wire-groups-and-identity.md).
