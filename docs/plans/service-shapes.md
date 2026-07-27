# Plan: service / contract shapes

**Status:** `default` / `defaults` Eng’d (2026-07-27); **construction adornments A1–A2 Eng’d** (`defaults` remaps `Svc` via `remapTagService`); `cell` parked lean.  
**Agent:** 4 (`cursor/hyperservice-open-deps-5679`).  
**Prior art:** [`service-shape-redesign.md`](../handoffs/archive/2026-07/features/service-shape-redesign.md) (2026-07-01/02), [`client-adapters-design.md`](../handoffs/client-adapters-design.md).  
**Orthogonal:** wire RpcGroup identity — [`wire-groups-and-identity.md`](./wire-groups-and-identity.md) (W1–W3 Eng’d; do not conflate with handle taxonomy).

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
| Tag-baked plain / sync fn | `default` (Spec) / `defaults` (pipe) |
| `Promise<A>`, live plain `A` cell | **not Spec** (adapters or parked) |

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

## Eng’d (2026-07-26 / 27)

- `Tag<Self, I>()` + overload arity; `value(Schema)` (materialize, fallible OK); `Hyperlink.promise`.
- Wire identity W1–W3 Eng’d (orthogonal) — [`wire-groups-and-identity.md`](./wire-groups-and-identity.md).
- **`Hyperlink.default` / `Hyperlink.defaults`** — Tag-baked defaults; **`Hyperlink.pure` retired** (same job; never the long-term noun).

## LOCKED + Eng’d — `default` / `defaults` (2026-07-27)

Placeholder name was `Hyperlink.handle`. **Rejected** as the public noun. Short-lived `Hyperlink.pure` **retired**.

| API | Shape | Role |
|-----|--------|------|
| **`Hyperlink.default(…)`** | Spec leaf (singular) | One default field **in the contract** — literal or sync fn (Promise-returning fn → type error) |
| **`Hyperlink.defaults({…})`** | Piped bag (plural) | Add **multiple** defaults: `Tag(…).pipe(Hyperlink.defaults({…}))` — bag on Tag (`DefaultsOf`); **`Svc` remapped** so `yield* Tag` includes bag keys |

Shipped rules:

- Spec stays branded builders; `defaults` bag merges onto the service (local + client).
- Spec `default` leaves are fully typed on `Service`. Piped bag keys widen `Service` at construction via licensed `remapTagService` (`test/defaults-handle.test-d.ts`); `WithDefaults` kept as escape/migration.
- Spec∩bag key collision → `DuplicateDefaultKey` (also duplicate bag keys across pipes).
- Layer/serve: wire `ImplOf` required; default/bag keys optional overrides (`ImplWithDefaultOverrides`).
- Post-hoc overrides also via `Layer.updateService`.
- Construction-time adorn OK; post-construction adorn → **new** named Context key (not yet a sugar API).
- Hard lean (superseded): two-step Prototype mint — **rejected for product** (owner: no separate const; one-shot class mint).

---

## Construction adornments (A1–A2 Eng’d — safe handle widen, one-shot)

### Goal

Modify the **handle** during Tag construction so `yield* Tag` is typed correctly — **one expression**, no intermediate `const Proto = …`.

```ts
class Jobs extends WorkPool.Tag<Jobs>()("@app/Jobs", jobSpec).pipe(
  Hyperlink.defaults({ label: (n: number) => `job=${n}` }),
) {}

const jobs = yield* Jobs
jobs.label(1) // on Service — no WithDefaults cast
```

Same pattern must compose with existing pipes (`withReadiness`, node bind, …) without a second mint stage.

### Why the bag needed a cast (fixed)

Previously `defaults` stamped runtime keys on `defaultsSym` but **did not remap** `HyperlinkTag`’s `Svc`. `yield* Tag` stayed Spec-only; `WithDefaults` papered over it at use sites. Spec `default` leaves were already fine (in Spec → in `ServiceOf`). **A1 Eng’d:** `defaults` remaps `Svc → Svc & Bag` via `remapTagService`.

### Constraint (class Self)

`class X extends Tag<X>()(…).pipe(…)` always mentions `X` in the heritage. Remapping `Svc` cannot be *proved* through that cycle for arbitrary bags — same wall as Gate/WorkPool named handles.

**Precedent that works:** `nameRunService` / `nameQueueService` — mint builds the Tag, then **one licensed cast** remaps `Svc` (`ServiceOf ⇄ Gate<…>` / `WorkPool<…>`), guarded by `.test-d.ts` bidirectional equality. Construction finishes **before** the class body closes; no separate const.

### Design lock (Eng’d A1–A2)

**Adornments are construction pipes that remap `Svc` via the same licensed-cast pattern — not a Prototype noun, not use-site casts.**

| Rule | Choice |
|------|--------|
| Shape | One-shot: `class X extends Factory<X>()(…).pipe(adorners…) {}` |
| No separate const | Rejected two-step Prototype mint as the product API |
| Type safety | Pipe return type is `HyperlinkTag<Self, S, Svc & Bag>` (etc.), not `T & { [defaultsSym]: Bag }` alone |
| Soundness | One cast at adornment apply; `.test-d.ts` proves `ServiceOf<S> & Bag` ⇄ widened `Svc` for representatives |
| Spec vs bag | Spec `default` stays for contract fields; piped `defaults` for extras — both end on `Svc` after adorn |
| Compose | Adorners chain: each widens/stamps; order defined (defaults → readiness → …) or commutative where possible |
| Toolkit Tags | `WorkPool.Tag` / `Gate.Tag` / `Daemon.Tag` already return remapped `Svc`; further `.pipe(defaults)` must widen **that** `Svc`, not erase the named handle |
| Post-construction | Still: new Context key / `Layer.updateService` — not silent mutate of an existing Tag class |

### Primary API (one-shot pipe)

```ts
class Jobs extends WorkPool.Tag<Jobs>()("@app/Jobs", jobSpec).pipe(
  Hyperlink.defaults({ label: (n: number) => `job=${n}` }),
  // future adorners: same Svc-remap contract
) {}
```

`Hyperlink.defaults` implementation (Eng’d):

1. Keep runtime stamp on `defaultsSym` + collision checks.
2. Return type: remap `Svc` to `Svc & D` (NodeBoundTag / HyperlinkTag branches).
3. Licensed cast via internal `remapTagService` (`as unknown as`).
4. `test/defaults-handle.test-d.ts`: bidirectional `yield* Tag` ⇄ `ServiceOf & Bag`; toolkit keeps `WorkPool` / `Gate` ∧ bag.
5. `WithDefaults` kept as escape / migration (identity once Svc is remapped).

### Optional sugar (same semantics, still one-shot)

Third-arg / config nest — equivalent to piping `defaults` inside the factory (no second const):

```ts
class Jobs extends WorkPool.Tag<Jobs>()("@app/Jobs", jobSpec, {
  defaults: { label: (n: number) => `job=${n}` },
}) {}
```

Desugar: factory applies the same adornment before return. Pipe remains the composable core; options are sugar for the common case.

### What is an “adorner”

A construction-time combinator with this contract:

- **In:** `PipeableTag` (or toolkit Tag) + adornment payload  
- **Out:** same Tag identity (`Self`, wire key, Spec) with **updated `Svc` and/or stamps**  
- **Runtime:** install extras onto every local/client handle (like today’s defaults bag)  
- **Fail-loud:** collisions / illegal adorn → TaggedError at construction  
- **Not:** post-hoc mutate of a live Context service; not Spec wire leaves (those stay Spec builders)

Today’s candidates under this umbrella:

| Adorner | Remaps `Svc`? | Stamp |
|---------|---------------|--------|
| `defaults(bag)` | **yes** — `Svc & Bag` | `defaultsSym` |
| `withReadiness` | no (keep shallow `PipeableTag`) | `readinessSym` |
| `default` Spec leaf | n/a — in Spec | — |
| future: more handle extras | yes if surface changes | TBD |

### Eng slices

| Slice | Scope |
|-------|--------|
| **A1** | ~~Remap `Svc` in `defaults` + licensed cast + `.test-d.ts`~~ **done** (`remapTagService`) |
| **A2** | ~~Toolkit Tags keep named handle ∧ bag~~ **done** (`test/defaults-handle.test-d.ts`) |
| **A3** | Optional factory `{ defaults }` sugar (desugars to A1) |
| **A4** | Docs polish / getting-started migrate (partial — demo off `WithDefaults`) |
| **A5** | Further adorners share `remapTagService` |

### Non-goals

- Separate `const Proto = Prototype(…).pipe(…)` then mint  
- Use-site `as WithDefaults` as the long-term safe story  
- Putting wire RPC fields into the defaults bag  
- Silent local/remote divergence  

## Open decisions (owner)

1. ~~Rename `constant` → `value`~~ **done**.
2. ~~Tag-baked / handle bag naming~~ **done** — `default` (Spec) / `defaults` (pipe).
3. Live plain cell (`cell`): **lean park/reject** (ref + adapters enough) — confirm lock.
4. ~~Fallible materialize~~ **done** (`value` + `E`).
5. ~~Promise adapter~~ **done** (`Hyperlink.promise`).
6. Getting-started / Core Concepts polish for the taxonomy (optional).
7. ~~`default` payload + `pure` fate~~ **done** — literals + sync fns; `pure` removed.
8. ~~**Construction adornments A1–A2**~~ **Eng’d** — optional A3 sugar still open.

---

## Suggested remaining slices

| Slice | Scope |
|-------|--------|
| **S2** | ~~Eng `default` / `defaults`~~ **done** (`pure` retired) |
| **S3** | ~~Docs: Creating / Core Concepts taxonomy~~ **done** (light polish with `default`/`defaults`) |
| **S5** | Live plain `cell` — lean park/reject pending owner lock |
| **S6** | Upload / sink (transport-gated) |
| **S7** | ~~Prototype mint~~ **replaced** by construction adornments A1–A4 above |

---

## Non-goals

- Spec builders that return `Promise` or sync `(In) => A` as the native handle shape.
- Silent divergence (local plain vs remote Effect for the “same” field).
- Polling adapters for “live” dashboard data.
- Replacing `ref` with plain cells for TUI/web unless decision 3 says so.

---

## References

- Eng’d builders: `src/Hyperlink.ts` (`effect`, `effectFn`, `stream`, `ref`, `value`, `local`, `default`, `defaults`, `promise`).
- Materialize resolve: `buildLocalContext` / `buildClientService` (`isValueMethod` / `isDefaultMethod` branches).
- Tests: `test/hyperlink-value-plain.test.ts`, `resource-default*`, `resource-promise*`, nesting / stream suites.
- Demo: `examples/forms/hyperlink/default-defaults.ts`.
- Adapters: [`client-adapters-design.md`](../handoffs/client-adapters-design.md); wire identity: [`wire-groups-and-identity.md`](./wire-groups-and-identity.md).
