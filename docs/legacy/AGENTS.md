# Agent guide — hyperlink-ts (`hyperlink-ts`)

Use this file **together with** [STORAGE.md](./STORAGE.md) (**read before any persistence change** — facet rules, the persistence SSOT), [`docs/LOGS.md`](../LOGS.md) (logs platform SSOT), [PACKAGE-GUIDE.md](./PACKAGE-GUIDE.md), [PROCESS-API.md](./PROCESS-API.md), [RESOURCE-API.md](./RESOURCE-API.md), [guides/toolkit-by-example.md](./guides/toolkit-by-example.md), [guides/history-and-persistence.md](./guides/history-and-persistence.md), and [examples/README.md](../examples/README.md). It tells you **where truth lives** and **how to modify the repo safely**.

---

## Repository map

| Path | Purpose |
|------|---------|
| `src/index.ts` | Public exports + package-level TSDoc. **Start here for imports.** |
| `src/Process.ts` | **Process** toolkit **and** engine in one module — `Process.Tag` / `Process.Schedule`, the `schedule` / `result` combinators, `window` / `at` builders, `make` / `layer` / `serve` / `serveRemote`, and the supervisor loop → `hyperlink-ts/Process`. |
| `src/Polling.ts` | Poll-cadence gate service + preset `Layer`s. (The run-window schedule primitive is internal: `src/internal/processSchedule.ts`, surfaced via the `Process` namespace.) |
| `src/QueueResource.ts` | Priority queue **engine** (`Tag`/`make`/`layer`/`serve`/`serveRemote`; `persist`/`refill`). |
| `src/ResourceConfigure.ts` | Layer-composed `.configure` patches for queue/process/run resources. |
| `src/HistoryStore.ts`, `src/DurableQueueStore.ts` | Observability history + durable queue ports (SQLite backends in `storage/sqlite`). |
| **Toolkit (location-transparent)** | |
| `src/Hyperlink.ts` | Foundation — tags (`Tag`/`client`/`serve`/`serveRemote`/`httpServer`/`Host`/`connect`), `specOf`/`methodMeta` introspection. `httpServer([...serve-layers])` = many resources on one port (group behind one `Host`). |
| `src/CustomQueueResource.ts` | Custom queue **engine** (`make`, `rateLimiterLayer`) — shares `QueueResource` runtime via `buildQueueEngine`. |
| `src/Group.ts` | `Group.Tag` — organize member tags (nestable; `members`/`isGroup`). |
| `src/Logs.ts` | Logs platform (`layer`, `stream`, `byNode`, `Hyperlink.logs`) — [`docs/LOGS.md`](../LOGS.md). Durable journals via `Node.logs` / toolkit `.store` on `Store.Service`. |
| `src/Store.ts` | Shape-first store contracts; `EventJournal`-backed `layerMemory` / `SqlEventJournal` `layer` — see `docs/guides/store-backing.md`. |
| `src/store/*.ts` | Public storage facets (none currently — `store/Log` removed). Facet substrate (`ProcessStorage` / `RuntimeStorage`) retired. |
| `src/LogContext.ts`, `src/LogEntry.ts` | Log annotations (`LogAnnotationKeys`) + NDJSON log entries (`LogEntry` / `LogEntrySchema`) — the structured-logging core. |
| `src/internal/store/*` | Shared Store helpers (e.g. process store specs) — **internal**. |
| `src/internal/manager/*` | Log capture / relay / query / scope (used by `Logs` + `store/log`) — **internal**. |
| `src/disarmedIdleSleep.ts` | Pure policy for disarmed idle sleep (shared with tests). |
| `examples/forms/*` | One API shape per file — minimal teaching references. |
| `examples/scenarios/*` | Descriptive compositions showing subsystems together. |
| `examples/shared/*` | Test doubles, harness helpers, shared example utilities. |
| `docs/guides/*.md` | API guides — `toolkit-by-example.md`, `history-and-persistence.md`, `queue-resource.md`, `process.md`, `store.md`, `store-backing.md`, `service-tags-and-runtime-split.md` (bundler-safe tags vs `Layer`/runtime). |
| `docs/handoffs/*.md` | **Active migration designs** — tag wire slots (`payload` / `success` / `error`), store/RPC policy. Index: [`handoffs/reports/README.md`](../handoffs/reports/README.md); archive: [`handoffs/archive/`](../handoffs/archive/); integration branch **`integration`**. |
| `docs/plans/*.md` | Future-only roadmap items. Implemented behavior belongs in regular docs and source TSDoc. |
| `repos/effect/` | Vendored Effect source for read-only agent reference. **Do not import from it.** |
| `test/*.ts` | Vitest suites — run `pnpm test`. |

---

## Invariants (do not break casually)

1. **Supervisor semantics** — One fiber per started process; outer loop waits for **armed** schedule; inner loop runs **polling** ticks while armed. See `Process.ts` module doc.
2. **`Process.effect` typing** — `Process<R>`: `effect` needs the user environment; storage is via
   the Store bridge (`Process.store(tag)` / `Store.effects`), not the retired `ProcessStorage` layers.
   Inlined `polling` / `schedule` on `Process.make` are merged into the supervisor so **`R` excludes those services** when present (overload-resolved in `Process.ts`).
3. **Location transparency** — a `Hyperlink` tag is driven by the same `yield* Tag` code local or remote; only the provided layer differs (`.layer` vs `.client`/`.serve`). Don't special-case local vs remote in Hyperlink consumers.
4. **Storage** — See [STORAGE.md](./STORAGE.md) and [`docs/LOGS.md`](../LOGS.md). Facet substrate
   (`RuntimeStorage` / `ProcessStorage`) is retired. Toolkit persistence ports: `HistoryStore` /
   `DurableQueueStore` (SQLite backends in `storage/sqlite`); logs via `Node.logs` / toolkit store registrations + `Logs`.

---

## Public vs internal modules

**Rule:** If consumers import it in their app → public module under `src/` (PascalCase) and
documented export (`index.ts` or a `package.json` subpath). If only other package modules
use it → `src/internal/` — not exported from `index.ts`, no new subpath.

See [`.cursor/rules/public-vs-internal.mdc`](../.cursor/rules/public-vs-internal.mdc).

---

## Engineering and change-management rules

- Prefer type-safe designs over casts; do not use unsafe type casts to bypass
  TypeScript.
- Narrow unknown values with predicates, schemas, or typed APIs instead of
  assertion-heavy code.
- Fix type errors wherever they appear during a task; do not ignore unrelated
  type failures.
- Typecheck frequently while editing Effect-heavy or public API code.
- For non-trivial changes, validate with `pnpm run typecheck`, `pnpm test`,
  `pnpm run build`, and `pnpm run lint` unless the task is docs-only or the
  user explicitly narrows testing.
- **Changesets** — see [Changeset policy](#changeset-policy) below.
- Recommend commits, PRs, or merges when appropriate.
- Commits, pushes, PR creation/update, and merges on major or user-owned
  branches (`main`, `develop`, release branches, or branches created by the
  user) require user approval first.
- Agent-created `cursor/*` branches are the exception: commits, pushes, and PR
  creation/update are allowed there when needed for the task.
- Keep docs and plans separate: regular docs describe implemented behavior;
  `docs/plans` describes future work only.
- Prefer existing Effect patterns, services, and local helper APIs over ad hoc
  abstractions.
- Use Effect platform/node services for filesystem, process, HTTP, terminal, and
  other Node runtime work (`FileSystem`, `Path`, `ChildProcess`, NodeServices,
  etc.). Avoid raw `node:*` APIs in new code when an Effect service exists; if
  no Effect service exists for the primitive (for example Ed25519 crypto),
  isolate the Node API behind a small Effect-returning helper.
- Use comments and TSDoc to make intent clear when code relies on non-obvious
  type-level plumbing, Effect layering/order, runtime ownership, or compatibility
  behavior. Lean toward assuming future readers will not have the whole design
  discussion in their head; a concise comment is better than making them infer
  invariants from implementation details.
- Make validation deterministic from type/config shape where possible; avoid
  extra boolean flags for behavior that can be derived.
- Hooks should be powerful extension points, but core persistence/analytics
  should be automatic through storage facets.
- End responses in a way that keeps development moving: identify the next
  sensible slice, call out blockers or uncertainty, and ask for clarification
  when a decision is needed. Avoid passive endings that only summarize completed
  work; leave the user with the concrete next plan or next question.

---

## Changeset policy

**When to add a changeset:** public API, behavior, package metadata, or release-note
impact — same bar as before.

| Action | Owner approval? | Agent duty |
|--------|-----------------|------------|
| **Create / edit** `.changeset/*.md` | **No** — land on agent branches with the PR | **Mandatory:** paste the **full file contents** in owner chat after creating (use supervisor Before/After: Before = `(none — new file)` or prior full file; After = full new file). Do not summarize or link only. |
| **`pnpm run version`** (`changeset version` — bumps `package.json` + `CHANGELOG.md`) | **Yes** | Propose when ready; do not run without owner OK |
| **Publish** (`pnpm publish`, `npm run release`) | **Yes** | Owner only |

**Content:** no `@deprecated` shims in migration notes — snippets only. Consolidate related
breaking notes into one coherent changeset when possible (see
[`handoffs/archive/2026-07/reports/2026-07-07-agent-report-docs-release.md`](../handoffs/archive/2026-07/reports/2026-07-07-agent-report-docs-release.md)).

---

## Branch policy

**Format:** `<type>/<description>` — slash-separated, **kebab-case** description.

| Type | Purpose | Typical merge target |
|------|---------|---------------------|
| **`integration/<stream>`** | Long-lived integration line for a major workstream | `main` (or umbrella `integration` first — see below) |
| **`feature/<description>`** | Short-lived agent or developer work | Matching `integration/<stream>` per handoff |
| **`fix/<description>`** | Focused fixes | Same as `feature/*` |

**Active integration lines:**

- **`integration`** — current go-forward base (renamed from `integration/storage` after storage work closed).
- Additional streams may appear as owner-named branches; prefer branching from **`integration`**.

**Rules:**

- **One work branch per agent** (e.g. `cursor/<desc>-….` / `feature/<desc>`). Do not scatter work across many agent branches.
- **One integration branch:** `integration`. Agents **sync** with it: after a sync, the work branch and `integration` are **merged and share the same tip**.
- Branch agent work from **`integration`**, not `main`, for platform work.
- **Do not open PRs** unless the owner asks.
- **Push to `integration`** when syncing (or when the owner directs) so the shared tip is published.
- Do **not** push to `main`, `develop`, release branches, or owner-owned branches without explicit approval.

---

## Common tasks

| Task | Approach |
|------|----------|
| Add a public export | Add the symbol to the module **namespace** object, export the same binding at the module top level (short name), then re-export namespace + short name from `src/index.ts`. Add a `tsup` entry and `package.json` `exports` subpath when the module is a standalone import surface. |
| Change process semantics | Update `src/Process.ts`, tests in `test/process*.ts`, and the relevant regular docs if behavior is contractual. |
| Add an example | Add a **form** under `examples/forms/<area>/` or a **scenario** under `examples/scenarios/`; document in `examples/README.md`; add `package.json` script if runnable. Put heavy mock / scenario prose in `examples/shared/` when it would drown the entry script. |
| Verify types (strict Effect rules) | `pnpm run typecheck` (uses `tsgo`). `anyUnknownInErrorContext` is temporarily `"off"` (re-enabling it is on the [roadmap](../plans/README.md)). |
| Run tests | `pnpm test` |
| Pick up future work | [`STORAGE.md`](./STORAGE.md) for the persistence model; [`docs/plans/README.md`](../plans/README.md) for the reviewed roadmap. |

---

## Vendored repositories

- External source lives under `repos/` only to help agents inspect upstream implementations and tests.
- Treat `repos/effect/` as read-only reference material for idiomatic Effect patterns.
- Never import from `repos/`; package code must import from declared dependencies such as `effect`.
- Do not edit files under `repos/` unless explicitly asked.
- When changing Effect-heavy code, inspect `repos/effect/packages/effect/` for examples before introducing new patterns.

---

## Documentation conventions

- Use **`@public`** / **`@internal`** on exported symbols as appropriate.
- Prefer **module-level** `@module` / overview blocks for large files (`Process.ts`, `QueueResource.ts`).
- Link cross-doc with **relative** paths from `docs/` or repo root as in README.

---

## What not to assume

- **`AI_CONTEXT.md`** in repo root may be gitignored locally; committed agent guidance starts in root `AGENTS.md` and continues here.

---

## Cursor Cloud specific instructions

**Integration branch:** `integration` — land platform work here; see handoffs under `docs/handoffs/`.

**Environment:** Node >= 20.19.0 and pnpm 10.33.4 are declared by
`package.json`. A `pnpm-lock.yaml` is committed; use `pnpm install` when
dependencies are missing in a fresh cloud workspace.

**No external services required for the standard checks.** The Vitest suites and
examples run in-process. SQLite HistoryStore / DurableQueue tests exercise
`@effect/sql-sqlite-node`.
`package.json` lists `better-sqlite3` under `pnpm.onlyBuiltDependencies` so the
transitive native dependency can compile when installs run with ignored scripts
by default.

**Key commands:**

| Task | Command |
|------|---------|
| Install dependencies | `pnpm install` |
| Typecheck | `pnpm run typecheck` |
| Run tests | `pnpm test` |
| Lint | `pnpm run lint` |
| Build | `pnpm run build` |
| Typed PG walkthrough | `pnpm run example:typed-process-group` |

**Gotchas:**

- `pnpm install` runs the `prepare` hook, which patches TypeScript with
  `@effect/language-service`; seeing `effect-language-service patch` output is
  expected.
- Examples that serve a resource over HTTP (`httpServer`) bind to localhost ports. If an
  example fails because a port is already in use, rerun with a free port or stop the
  specific process that owns that port.
