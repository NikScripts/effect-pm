# ProcessGroup endpoint DX (decision record)

**Status:** Approved design — not yet implemented  
**Date:** 2026-05-22 (updated: pre-1.0 removal policy, alternatives matrix)  
**Relates to:** [07-process-manager.md](./07-process-manager.md), [process-group-layer-unification handoff](../handoffs/process-group-layer-unification.md), [process-group.md](../guides/process-group.md), [process-manager.md](../guides/process-manager.md)

**Source of truth** for the third-argument endpoint API, `Transport`, consolidated `Endpoint.*` labels, child launcher, and TS2506 rules. Graduate to `docs/guides/process-manager.md` when shipped.

---

## Pre-1.0 policy

- **Remove legacy shapes** from `src/`, tests, and examples — **do not deprecate** or leave compatibility re-exports.
- **Breaking changes are expected** until 1.0; changeset notes removal, not “deprecated”.
- **Canonical DX** is the default story in docs and playground.
- **Alternatives** stay **public and documented** where a project cannot use the canonical path — not hidden “legacy”.

---

## Goals

1. **Single group file** — processes, queues, `ProcessGroup.Service`, and **every control target** in the **third argument** (inline array).
2. **Effect-style API** — function calls; **no object-shaped endpoint config** in app code.
3. **Protocol-agnostic** — `Transport.*` is swappable; labels (`local`, `production`, …) are not protocols.
4. **No TS2506** — no `() => import("./same-file.js")` in the group file for endpoints.
5. **No user boilerplate** — no `*-runtime.ts`, no `runChildEntry`, no app `LocalRuntime`, no `moduleLaunch`, no `*GroupEndpoints()` helper above the class.
6. **`group-start` never `load()`s the group module in the CLI** — package child launcher only.

## Non-goals

- Bundling unrelated app services into `ProcessGroup.Service.layer`.
- Changing the control protocol payload (REST aliases as today).
- Pattern 2 string module paths as the **primary** DX (`"path/to/file.ts"` + export name).

---

## Canonical API (default)

### Third argument

```typescript
export class WorkshopGroup extends ProcessGroup.Service<WorkshopGroup>()(
  "@app/WorkshopGroup",
  [Feeder, JobQueue] as const,
  [
    Endpoint.local(workshop, import.meta.url).default,
    Endpoint.production(workshop),
    Endpoint.define("preview", Transport.http("workshop.preview.internal", 443)),
  ],
) {}
```

### `Transport.http`

| Call | Result |
|------|--------|
| `Transport.http(port: number)` | `http://127.0.0.1:${port}` (local `ControlService`) |
| `Transport.http(host: string, port: number)` | `http://${host}:${port}` |
| `Transport.http(baseUrl: string)` | URL as-is (TLS, path, non-local host) |

Future: `Transport.rpc`, `Transport.memory`, etc. — same `Endpoint.local` / `production` / `define` call sites.

### Consolidated `Endpoint` (public)

| API | Role |
|-----|------|
| `Endpoint.local(transport, entry)` | Spawn child for `entry`; control via `transport` |
| `Endpoint.local(…).default` | Mark default CLI target |
| `Endpoint.production(transport)` | Remote; no spawn |
| `Endpoint.define(label, transport)` | Named remote; no spawn |

**Removed from public API (delete, do not deprecate):**

- `Endpoint.child`, `Endpoint.connect`
- `Endpoint.local(Endpoint.module(…))`, `Endpoint.production(Endpoint.http(…))` nesting
- Public `Endpoint.http` wrapper (transport goes directly to label helpers)
- App-authored `ProcessManager.LocalRuntime` + `Effect.never` runner files as the documented path
- `Endpoint.module` + self-import in the **same file** as the group class

Port for local spawn comes **only** from `transport` (no separate `port` on `Endpoint.local`).

---

## When canonical does not fit — alternatives matrix

Use the **smallest alternative** that solves the constraint. All are **supported**, not legacy.

| Constraint | Canonical problem | Alternative |
|------------|-------------------|-------------|
| **Bundled / Vite chunk URL** | `import.meta.url` is not a stable filesystem entry | `Endpoint.local(transport, entryUrlString)` with explicit `file://` or `dist/…` path; or `Endpoint.command(…)` |
| **No ESM / no `import.meta`** | Cannot pass module URL | `Endpoint.command` with full spawn spec; or split runner file + `Endpoint.runner(…)` (see below) |
| **Control already running** | `Endpoint.local` spawns again | `Endpoint.production(transport)` or `Endpoint.define("attached", transport)` only — no `local` |
| **Custom spawn (docker, pm2, foreman)** | Default child launcher wrong | `Endpoint.command(launchSpec, transport)` — user-owned `command` / `args`; readiness still via `transport` |
| **Typed import across packages** | Want TS to validate runner module path | **Separate runner module** (not same file as group): `Endpoint.runner(() => import("./billing.runner.js"), select)` — see TS2506 section |
| **All URLs in deployment config** | Don’t want remotes in source | Third arg: **only** `Endpoint.local(…).default`; remotes via `ProcessManager.Config.layer` / `ConnectionRegistry` at CLI bootstrap |
| **Multiple remotes / many labels** | — | `Endpoint.define("staging", transport)` per target (canonical) |
| **In-process tests** | Don’t spawn | `Transport.memory(…)` + `Endpoint.production` / `define`; test provides `ControlTransportClient` layer |
| **Non-HTTP control (future)** | HTTP unsuitable | `Transport.rpc(…)` (etc.) with same `Endpoint.production` / `define` |
| **TS2506 in one file** | Cannot use `import.meta.url` pattern | Split: **group file** (class + entries + remotes) + **runner file** (only `Endpoint.runner` or `Endpoint.command` re-export) — documented pattern |

### `Endpoint.command` (alternative local)

For full control of spawn:

```typescript
Endpoint.local.default(
  Endpoint.command(
    { command: "docker", args: ["compose", "up", "workshop"] },
    Transport.http(WORKSHOP_PORT),
  ),
)
```

Implement when `Effect` `ChildProcess` command shape is wired (per plan 07). Readiness probe uses `transport`, not ad-hoc HTTP types in launch config.

### `Endpoint.runner` (alternative local — split module only)

**Only when the group class and a typed `import()` must live in different modules** (avoids TS2506). Not the default.

```typescript
// workshop-group.ts — no import() in third arg
[
  Endpoint.local.default(Endpoint.runner(() => import("./workshop.runner.js"), (m) => m.run)),
  Endpoint.production(workshop),
]

// workshop.runner.ts — spawns via effect-pm-group-child or exports run effect
```

Prefer **`Endpoint.local(transport, import.meta.url)`** whenever the group file can carry `entry`.

### `ProcessManager.Config.layer` (alternative remotes)

Override or supply **all** remote targets without editing the group:

```typescript
ProcessManager.cli([WorkshopGroup] as const).pipe(
  Effect.provide(
    ProcessManager.Config.layer([
      ProcessManager.GroupConfig(WorkshopGroup, [
        Endpoint.production(Transport.http("https://workshop.internal")),
      ]),
    ]),
  ),
)
```

Group file keeps only local line; production/staging live in CLI wiring.

### `ConnectionRegistry` (alternative connect)

Per-environment URLs without third-arg remotes:

```typescript
ProcessManager.ConnectionRegistry.layer([WorkshopGroup] as const, {
  "@app/WorkshopGroup": "http://127.0.0.1:32201",
})
```

Use with `ProcessManager.connect` / CLI when groups don’t declare production in source.

---

## TypeScript: TS2506

| Pattern | Safe? |
|---------|-------|
| `Endpoint.local(transport, import.meta.url)` in third arg | **Yes** |
| `Endpoint.runner(() => import("./other-file.js"), …)` in third arg | **Yes** if **other-file** ≠ group class file |
| `Endpoint.runner(() => import("./same-file.js"), …)` in group file | **No** |
| Inline array with self-`import()` | **No** |
| Helper `(): readonly ProcessManagerGroupConfigItem[] => […]` | **Yes** (erasure) — optional escape, not canonical |

CI: `test/process-group-endpoint-config.test-d.ts` — canonical inline array must typecheck.

---

## Runtime (library-owned)

| Piece | Owner |
|-------|--------|
| `effect-pm-group-child` bin | Package |
| `Effect.never` + layer/control provide | Package only |
| `ProcessGroup.localEnvLayer` / `groupLocalRuntime` | Package (child uses group class + argv) |
| `group-start` | Spawn from `Endpoint.local` / `command` / `runner`; **never** `load()` in CLI |

Child args (direction): `--entry`, `--group-id`, transport-derived control URL.

Executor: `EFFECT_PM_EXECUTOR` (`tsx` vs `node`) — launch builder encodes command + args.

---

## Remove from codebase (implementation checklist)

### API / exports

- [ ] Delete nested endpoint builders usage from public docs; remove redundant exports if unused internally.
- [ ] Remove `Endpoint.child`, `Endpoint.connect` if added experimentally.
- [ ] Unexport or delete app-facing `LocalRuntime` from primary guides (keep `@internal` only if child still needs descriptor type).
- [ ] Replace `endpointModule` public surface with `Endpoint.local` / `runner` / `command` builders.
- [ ] Change `ProcessManagerModuleEndpointLaunchConfig.control` to transport-based connect descriptor.

### Examples / tests

- [ ] Delete `examples/scenarios/process-manager-playground/workshop-runtime.ts`, `launch.ts`, `analytics-runtime.ts`, etc.
- [ ] Migrate playground to canonical third arg.
- [ ] Update `test/fixtures/process-manager-module-*.ts` to runner alternative pattern or canonical `Endpoint.local`.
- [ ] Update `test/process-manager.test.ts` for new launch path.

### Docs

- [ ] Rewrite `docs/guides/process-manager.md` endpoint section.
- [ ] Update plan 07 historical nested example (pointer to this doc only).

---

## Implementation slices

| Slice | Work |
|-------|------|
| **0** | `Transport.http` overloads; transport union; fix launch `control` typing |
| **1** | `Endpoint.local`, `production`, `define`; remove nested public `Endpoint.http` / old module DX from exports |
| **2** | `ProcessGroup.Service` binds group into local launch; TS2506 `test-d` |
| **3** | `effect-pm-group-child`, `groupLocalRuntime`, `localEnvLayer`; `group-start` |
| **4** | `Endpoint.command`, `Endpoint.runner` (alternatives); playground + tests; **delete** old files |
| **5** | `Transport.memory` (tests) when needed |

---

## Resolved decisions

| Topic | Decision |
|-------|----------|
| Pre-1.0 | **Remove** old shapes; no deprecation period |
| Alternatives | **First-class**, documented in matrix above |
| Third arg | Explicit **array** per endpoint |
| `Endpoint.child` / `connect` | **Do not ship** — baked into `local` / `production` / `define` |
| `.default` | `Endpoint.local(…).default` only |
| Self-`import()` in group file | **Forbidden** in canonical DX |
| CLI `load()` | **Forbidden** on `group-start` |

## Open questions (remaining)

| # | Question | Recommendation |
|---|----------|----------------|
| **Q1** | `Transport.http(host, port)` always `http://`? | Yes; HTTPS via `Transport.http(baseUrl)` until `Transport.https` |
| **Q2** | `Endpoint.local` accept `ImportMeta`? | Yes — overload `string \| ImportMeta` |
| **Q3** | `Endpoint.define(label, transport, entry)` for second spawn? | Defer unless needed; use `runner` / `command` first |
| **Q4** | Name `Endpoint.runner` vs keep `Endpoint.module` for split-file only? | **`Endpoint.runner`** for split-file typed import; **delete** old `Endpoint.module` name from public API |
| **Q5** | `Endpoint.command` in slice 1 or 4? | Slice **4** after canonical path works |
| **Q6** | Semver | Pre-1.0; changeset documents **removed** APIs |

---

## Agent takeover

Read this file → `docs/AGENTS.md`. Implement slices 0–4; **delete** legacy code paths. Verify: `pnpm run typecheck`, `pnpm test`, `demo:pm -- group-start`. Changeset required (user approves). No `repos/` edits.
