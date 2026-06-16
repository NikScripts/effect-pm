# Telemetry / State — API surface inventory

**Status:** Active bake (Jun 2026). Companion to [telemetry-redesign-decisions.md](./telemetry-redesign-decisions.md) (semantics = source of truth). **This doc = the complete method list**, organized by module / service class. Plan: (1) list every method [this doc], (2) go **class by class** documenting *every form* — where it's accepted + how to use, (3) **Bundle** last, once the surface is fully documented.

**Naming (numbering dropped):** `Telemetry.Tag` has two shapes — **Compose** (over a standalone `State.Tag`; telemetry-optional) and **Bundle** (single `Telemetry.Tag`, no standalone `State.Tag`). No "Form 1 / Form 2".

**Legend:** ✅ forms documented · 🔶 forms TBD (class pass) · 🕓 deferred · ⛔ dropped / not-a-thing

---

## A. Module functions

### `State`
| method | role | forms |
|---|---|---|
| `State.Scope(domain)(id, fields)` | declare a **root scope** class | 🔶 |
| `State.Tag<Self>(domain)(stateId, …parts)` | **structure-only** tag (ops/scopes/handles/spans; no schemas); own id `<Resource>/…State` | 🔶 |
| `State.operation(name, scope?, Input?)(…triad)` | **operation** anchor (start / `inner` / exit) | 🔶 |
| `State.inner(…)` | the `ctx.telemetry` surface (middle events, nested ops, group-import) | 🔶 |
| `State.leaf(name, fields)` | inline single-use leaf (as an op's scope arg) | 🔶 |
| `State.Root` | root handle | 🔶 |
| `State.Changed` | internal transition event (`Internal.State.Changed`) | 🔶 |

### `Telemetry`
| method | role | forms |
|---|---|---|
| `Telemetry.Tag<Self>(StateTag, GlobalBase?)(telId, tree)` | **Compose** — richer tag over a `State.Tag`; own required id `<Resource>/…Telemetry` | 🔶 |
| `Telemetry.Tag<Self>(domain, GlobalBase?)(telId, structure)` | **Bundle** — single self-contained tag; own required id | 🔶 (Bundle pass) |
| `Telemetry.Service(Tag, wiring)` | runtime = tag + wiring + layer | 🔶 |
| `Telemetry.Schema<Self>(ScopeTel?)((e) => …)` | reusable schema base (scope-bound, or scope-free global) | 🔶 |
| `Telemetry.namespace(name)(…parts)` | ref-shortener — enclosing namespace | 🔶 |
| `Telemetry.group(name, Default?)(…parts)` | group label + optional default base | 🔶 |
| `Telemetry.event(name, schema?)` | name an **inner** (middle) event | 🔶 |
| `Telemetry.declare(name, schema?)` | named cross-site event (name-only / schema-carrying) | 🔶 |
| `Telemetry.start(name, schema?)` | **start** leg | 🔶 |
| `Telemetry.exit(…outcomes)` | **exit** leg (success / interrupted / failure fold) | 🔶 |
| `Telemetry.success(name, schema?)` | exit outcome | 🔶 |
| `Telemetry.interrupted(name, schema?)` | exit outcome | 🔶 |
| `Telemetry.failure(name, schema?)` | exit outcome | 🔶 |
| `Telemetry.spread(group)` | flat group-import into `inner` (drops prefix) | 🔶 |
| `Telemetry.metric.*` (`gauge`, …) | telemetry-state field markers | 🔶 |
| `Telemetry.update(…)` | wiring-side state write | 🔶 (shape OPEN) |
| `Telemetry.import(…)` / `Telemetry.wires({…})` | cross-facet shared catalogs | 🕓 deferred |
| `Telemetry.Event(Tag, "id")` | per-event classes | ⛔ dropped (use the tree) |
| `Telemetry.default(…)` | leg-level default | ⛔ not-a-thing (default = `group(name, Default)` / `default:` key) |

---

## B. Service classes (methods on produced classes)

### Scope class — `State.Scope(...)` / `.withLeaf(...)` result
| method | role | forms |
|---|---|---|
| `.withLeaf(name, fields)(id)` | child scope (new identity + id) | 🔶 |
| `.telemetry(fields)` | telemetry half (same identity, **no new id**) | 🔶 |
| `.layer(values)` | provide the scope at a runtime boundary | 🔶 |

### Telemetry scope class — `.telemetry(...)` result (`…Tel`)
| method | role | forms |
|---|---|---|
| `.event((e) => …)` | inline scope-bound schema value (no base) | 🔶 |
| `.withLeaf(name, fields)(id)` | child scope from the Tel half | 🔶 |

### Schema base class — `Telemetry.Schema(...)` result
| method | role | forms |
|---|---|---|
| `.extend((e) => …)` | base + extras (the field-adding form; **never a bare arrow**) | 🔶 |
| `.Schema(ScopeTel)((e) => …)` | extend into another reusable base | 🔶 |

### `State.Tag` class instance
| member | role | forms |
|---|---|---|
| operation handles (`.enqueue`, `.processEntry`, …) | invoke ops (wrap work) | 🔶 |
| `.provide(scopeValues)` | bind scope to a call | 🔶 |

### `Telemetry.Tag` class instance
| member | role | forms |
|---|---|---|
| event handles (`.Lifecycle.Started`, …) | emit standalone events | 🔶 |
| operation handles | invoke ops (typed payloads) | 🔶 |
| `.provide(scopeValues)` | bind scope to a call | 🔶 |
| `ctx.telemetry.*` | nested ops + middle + imported events (inside an op) | 🔶 |

### `Telemetry.Service`
| member | role | forms |
|---|---|---|
| `.layer` | the runtime layer (wiring bound) | 🔶 |

---

## C. Class-by-class pass — checklist

Document **every form** (signature variants, accepted positions, usage) for each, then lock:

- [ ] `State.Scope` + Scope class (`.withLeaf`, `.telemetry`, `.layer`)
- [ ] `State.Tag` + its instance (handles, `.provide`)
- [ ] `State.operation` (scope/no-scope, input as TS type vs `Schema`, triad shapes)
- [ ] `State.inner` (+ group-import: `Telemetry.spread` / `Telemetry.group`)
- [ ] `State.leaf`
- [ ] `Telemetry.namespace` / `Telemetry.group` (default arg)
- [ ] legs — `Telemetry.start` / `exit` / `success` / `interrupted` / `failure` (name-only vs schema)
- [ ] `Telemetry.event` / `Telemetry.declare` (name-only vs schema-carrying)
- [ ] `Telemetry.Schema` (scope-bound / scope-free) + `.extend` / `.Schema` / `ScopeTel.event`
- [ ] `Telemetry.metric.*`
- [ ] `Telemetry.Tag` **Compose** + its instance (handles, `ctx.telemetry`, `.provide`)
- [ ] `State.Root` / `State.Changed` / `Telemetry.update` (wiring-side)
- [ ] **Bundle** — `Telemetry.Tag(domain,…)(facetId, structure)` (last)
- [ ] `Telemetry.Service`
