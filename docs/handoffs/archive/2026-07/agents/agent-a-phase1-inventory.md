# Agent A — Phase 1 prioritized rule inventory

**Status:** Proposed order (Agent A's inference). **Owner reorders — the final sequence is yours.**
Severity: `must` / `should` / `may`. AppliesTo: `src` / `test` / `examples` / `docs` / `process` / `infra`.
Sources: `.cursor/rules/*.mdc`, `AGENTS.md`, `docs/legacy/**`, codebase, `docs/handoffs/**`, owner memory.

Reorder unit = **chapter** (the C-numbers). Move any individual rule between/within chapters too — call it out and I'll place it.

---

## C1 — Module layout (module = file = namespace) · appliesTo=src
*Source: `.cursor/rules/module-layout.mdc` (alwaysApply), codebase.* **Editor-enforced, always-on.**

- **must** One public module = one `PascalCase.ts` in a role folder; the file **is** the namespace, imported `import * as Name from "@nikscripts/effect-pm/Name"`.
- **must** Members are flat top-level `export const`/`function`/`type` — **never** an object-as-namespace (`export const Name = { … }`) for the public surface.
- **must** Associated types attach in the same file via `export declare namespace Name { … }`.
- **must** Filename === the namespace/class/type it exports; no orphan names that export nothing of that name.
- **must** Banned for public modules: `*Contract`, `*Namespace`, object-engine files. Name by role/noun (Effect's `RpcServer`/`RpcClient`).
- **must** Heavy/private impl → `src/internal/<camelCase>.ts` (name mirror); public `Foo.ts` is a thin re-export shell over `./internal/foo`.
- **must** Internal modules are camelCase, get no subpath, are never imported by apps.
- **must** Subpaths never resolve into `internal/`; barrel `src/index.ts` = one `export * as Name from "./Name"` per module.
- **may** Storage facets are the ruled exception: camelCase file (`src/store/queueResource.ts`) under a PascalCase subpath (`store/QueueResource`).

## C2 — Public vs internal surface · appliesTo=src
*Source: `.cursor/rules/public-vs-internal.mdc` (alwaysApply).* **Editor-enforced, always-on.**

- **must** Public = symbols apps import (`@nikscripts/effect-pm`, a documented subpath, or a bin entry). Internal (`src/internal/`) = package-only wiring, not exported.
- **must** Storage facets are public under `src/store/` with `store/<Domain>` subpaths (`store/QueueResource` → `QueueResourceStore` tag).
- **must** File naming per facet: full service name (`QueueResourceStore.ts`) **or** camelCase domain (`queueResource.ts`) — pick one, don't invent others. Subpath ≠ filename.
- **must** `internal/store/` (`spine.ts`, `service.ts`, `helpers.ts`) is type-agnostic plumbing only — no per-facet codecs, no facet tags.
- **must** Placement: `src/store/*` public facets · `src/Process.ts` etc. app-facing · `src/internal/store/*` package-private · `src/storage/*` durable adapters.
- **must** To add a public export: add to the module namespace + top-level short binding, re-export both from `src/index.ts`, add tsup entry + `package.json` exports subpath when it's a standalone surface.
- **must** `@nikscripts/effect-pm/QueueResource` = the queue worker; `@nikscripts/effect-pm/store/QueueResource` = the storage facet — distinct.

## C3 — No casts / structural typing · appliesTo=src,test
*Source: memory (no-casts), many handoffs [recurs 6+], codebase.* **Your most-repeated correction.**

- **must** No unsafe `as` / `any` / `!` casts anywhere — fix the root cause structurally.
- **must** Narrow unknown values with predicates, schemas, or typed APIs; not assertion-heavy code.
- **must** No type-level branding; detect leaf-vs-group with a narrow F-independent structural `kind` check, not `extends AnyMethod`/symbol brand.
- **must** Extract requirement `R` structurally (`ServeRequirements<Impl>`); never `as ServeEntry<never>` or pin heterogeneous entries to one `R`.
- **must** Keep precise group types (`RpcGroupOf<S>`); don't erase `[groupSym]` to `RpcGroup<any>` for assignability.
- **must** Type writes honestly — `append` is `Effect<void, StoreWriteError>`, never cast-to-`never` (a lie).
- **should** Any tolerated boundary cast carries a one-line justification. *(Reality: ~233 casts remain in generic-builder internals — `Resource.ts`, `Store.ts`, `internal/store/*`; hand-authored facet/store modules are cast-clean. Flagging the aspiration-vs-practice gap.)*
- **note** `as const` is fine/idiomatic.

## C4 — Single source of truth · appliesTo=src,docs
*Source: memory (SSOT — "guiding rule for all projects"), handoffs [recurs 6+].*

- **must** Each fact lives in one place — derive, never duplicate.
- **must** The Tag is SSOT for wire schemas — `layer` config must not override `payload`/`success`/`error`.
- **must** `payload` is the item-schema SSOT — declared once on the Tag, never repeated on `layer()`.
- **must** Worker outcome recorded exactly once (a `Completed` OR `Failed`; no separate redundant `Exit`).
- **must** Dead-letter budget derives from `attempts`; readiness derives from one registry; the rule manifest is derived from the AST, never hand-authored.
- **must** STORAGE.md is the SSOT for persistence; the decisions/plan doc is the SSOT for a bake — build from it, never regenerate locked shapes from memory.
- **must** Docs don't re-document a settled topic — cross-link the authoritative source.

## C5 — Naming conventions · appliesTo=src,examples
*Source: memory (naming), toolkit-by-example, handoffs, codebase.*

- **must** PascalCase **only** for classes, types, modules, namespaces (and namespace-member factories like `Tag`/`Service`/`Schedule`).
- **must** Everything else — layers, schemas, effects, symbol consts — is camelCase. No `UPPER_SNAKE` consts.
- **should** Layer values use a `Layer` suffix.
- **must** Public wire slots are named `payload` / `success` / `error` — no `Schema` suffix; retire `inputSchema`/`itemSchema`/`resultSchema`/`successSchema`/`errorSchema`.
- **must** Store-row `_tag` discriminators are PascalCase (`Started`/`Completed`/`Failed`/`Interrupted`); retire kebab `type` strings and the `Run*` prefix on process events.
- **must** Canonical ids are slash-separated `@scope/Segment/ServiceName` strings; CLI/remote accept normalized kebab suffix aliases (ambiguous → error with candidates).
- **must** Name spec builders for what they resolve to in the service shape (`value`/`effect`/`effectFn`/`stream`), not the RPC verb (`query`/`mutate`).
- **must** Package surface names describe *serving*, never a consumer's domain vocabulary (never adopt wow's "source").
- **must** Each contract's `.Tag` factory stamps a canonical `kind` id; classify via `Resource.kindOf`, never by sniffing spec members.
- **may** *(inconsistency to resolve)* schema consts today are sometimes PascalCase `*Schema` (`LogEntrySchema`), deviating from camelCase-values.

## C6 — Public type & service-definition conventions · appliesTo=src
*Source: memory (export interface, class-extends), codebase (168 `export interface`, 16 class-extends).*

- **must** Public API shapes are explicit `export interface`, not schema-derived `type = typeof x.Type` aliases.
- **must** Services/facets are defined `class Foo extends X.Service<Foo>()(id, …)` / `X.Tag<Foo>()(…)` — the class-extends form, never a bare factory call.
- **must** Service ids are fully-qualified package-scoped strings (`"@nikscripts/effect-pm/store/…/…Store"`).
- **should** Type-level helpers attach via `export declare namespace`.
- **should** Every public module/symbol carries a JSDoc block (`@module`/`@packageDocumentation`, `@public`/`@internal`).

## C7 — Effect v4 idioms & platform services · appliesTo=src
*Source: memory (prefer-pipe, TaggedError, struct-not-loose, Effect patterns), AGENTS.md, handoffs, codebase.*

- **should** Strongly prefer `.pipe(...)` over `Effect.gen`/imperative where cleaner (both idiomatic; ~balanced in code).
- **must** Errors use `Data.TaggedError`; wire-encodable errors use `Schema.TaggedErrorClass`; extending native `Error` is banned (lint `extendsNativeError: error`).
- **must** Payloads/inputs are a single `Schema.Struct`, not loose fields.
- **must** Schemas that extend a base use `Base.extend((e)=>…)`; a bare `(e)=>({…})` is invalid.
- **must** Reactivity/RPC/SQL/HTTP come from `effect/unstable/*` native subpaths — no external `@effect-atom` (v3-only).
- **must** Use Effect platform/node services (`FileSystem`, `Path`, `ChildProcess`, `HttpClient`); avoid raw `node:*` when an Effect service exists. No primitive → isolate behind a small Effect-returning helper.
- **must** Inspect the resolved `effect` package (or `repos/effect/packages/effect/src`) before guessing an API; never import from `repos/`, never edit `repos/`.
- **should** Prefer existing Effect patterns/services/local helpers over ad-hoc abstractions; make validation deterministic from type/config shape (no boolean flags for shape-derivable behavior).
- **must** Never take a `Layer` as config *data* (recreates the removed `Effect.Service({dependencies})` ambiguity) — layers compose only via `Layer.provide`.

## C8 — Storage / persistence model · appliesTo=src,storage
*Source: `docs/legacy/STORAGE.md` (SSOT), store-backing/store guides, store-cutover handoffs, memory.*

- **must** STORAGE.md is the SSOT — read it before touching `src/Store.ts`, `*.store(tag)` registration, `src/store/*`, or engine store wiring.
- **must** Two planes, never conflated: **observability** = baked-in default in-memory store (no `serviceOption`, no `persist:true` flag); **durability** = presence-driven `serviceOption` (providing the layer is the only switch).
- **must** `Storage` is a defaulted service (like `Clock`) — engines always `yield* Storage` / resolve once up front; **never** `serviceOption(Storage)` in an engine, no forked-fiber sniffing, no per-event lazy resolve (races `AppStore.at(tag)` → scoped-EventJournal deadlock).
- **must** `serviceOption` is correct **only** on the durability plane (`serviceOption(DurableQueueStore)`).
- **must** Merge the default store via `Layer.provideMerge` (never `Layer.provide`) at `layer`/`serve`/`serveRemote`; the app-root `AppStore` overrides on merge — never hard-provide inside a resource layer.
- **must** Three tiers: T1 lean base (`record`/`events`) via `Store.contract`; T2 engine narrow typed writes funnelling to `event.append`; T3 analytics reads via `*.store(tag)` `Store.extend` — never rebuild the base to add a tier.
- **must** Persist the exact shape `.events` emits (persisted == streamed). One tagged-union `event` row per store.
- **must** Serialize every row through Effect's `Schema.toCodecJson(entry.schema)` — never hand-roll; `append` *encodes* the decoded value; `DateTimeUtc`/`Exit`/`Cause`/`Duration` are identity codecs a JSON walk can't persist; encode failure is `Effect.orDie` (schema mismatch = defect).
- **must** Encode `error` by one rule: extract once via `Option.getOrElse(Cause.findErrorOption(cause), () => Cause.squash(cause))`; typed if the tag has an `error` schema, else `error: String(extracted)` — not `Cause.pretty`, not `Schema.Cause` on the wire, not a separate `cause` column.
- **must** Storage failures never fail gated/queued work — engine writes use `Store.catchWriteErrors` / `ProcessStore.catchErrorAndLog` (log + swallow). Write IO failure = catchable `StoreWriteError`; read decode = `StoreJournalDecodeError`.
- **must** `withStorage`/`withDefault` removed → `resolve` (optional) / `resolveOrDie` (always-on observability). No aliases. Prefer `Store.effects` (requirement rides each method; provide `Storage` once at the boundary).
- **must** Durability is presence-driven: `layerMemory` ephemeral, `layer({ filename })` durable. SQLite = `SqlEventJournal` on a shared `SqlClient` (one `Store.Service` = one DB file = one shared EventJournal), not a custom row table.
- **must** Retire (don't migrate) legacy facet substrate; deleted facet classes (`ProcessExecutionStore`/`QueueResourceStore`/`RunResourceStore`) must not be reintroduced as engine writers; engines don't dual-write. Log/Lifecycle observability facets may remain (read via `serviceOption(LogStore)` / `yield* ProcessLifecycleStore`).
- **must** Queue semantics stated loudly: at-least-once + dedup key, never exactly-once; observability writes batched/async off the hot path (worker never blocks on persistence).

## C9 — Serve, location transparency & RPC safety · appliesTo=src
*Source: `docs/legacy/RESOURCE-API.md`, serve-family handoffs, contract-serve-reform, memory.*

- **must** A Resource tag is driven by the same `yield* Tag` code local or remote — only the provided layer differs. Never special-case local vs remote in consumers. A field behaves identically local↔remote, or its divergence is loud (type/dependency error).
- **must** Locked serve vocabulary: `layer` (local) · `serve` (local+served, default) · `serveRemote` (served-only) · `client` (remote); transport bundlers `httpServer`/`httpClient`/`connect`. `Http` appears **only** on the transport line — core stays transport-agnostic. Same serve verb re-exports through every namespace.
- **must** For queue/process tags use the engine `serve` forms (`QueueResource.serve`/`Process.serve`), not `Resource.serve` (mounts handlers only, leaves the worker/tick dead). Never a bare `{ tag, impl }` literal (types as `Record<string,unknown>`, silently accepts typos) — always a spec-checked `serve`/`serverEntry`.
- **must** A resource is one instance — serve and local share ONE materialization; serving must not re-run the impl generator.
- **must** `httpServer([serve-layers])` unions each layer's `R` (like `Layer.mergeAll`); use `provideMerge`, not `provide` (bare `provide` prunes serve layers). Reject duplicate `groupId`s at build.
- **must** Declare dependencies in tick/worker bodies (`yield* Tag`); don't `Effect.provide` inside them — provide at the serve layer so `strictEffectProvide:"error"` stays clean.
- **should** Get hard deps ready by acquiring eagerly with `Layer.scoped` (failures surface at boot); readiness covers only runtime health Layer can't see. Compose behavior as post-construction combinators (`Resource.withReadiness`), not baked options/plugin arrays.
- **must** A hostless multi-host tag names the instance in the client: `Resource.client(tag, host)`; host-bound tags use `Resource.client(tag)`.
- **must** `Symbol.for` stamp keys are public contract — a rename isn't done until config fields, symbol stamps, store fields, tests, examples, and docs all move together.
- **must** Serving is over RPC; transport/auth security is the deployment's job — never expose a host on the public internet without it.

## C10 — Resource / Process / Queue API conventions · appliesTo=src
*Source: `docs/legacy/PROCESS-API.md`, `RESOURCE-API.md`, process/queue guides, memory.*

- **must** Every resource module uses the `.Tag` class pattern with a `.layer`; the tag carries the item schema, config (incl. the worker `effect`) lives in the layer, not the tag.
- **must** Prefer piped `.pipe(...)` modifiers over baked constructor options (`distributed`/`withReadiness`/`schedule` are piped).
- **must** Config overrides are `Layer` patches (`.configure`) that fold once when `.layer` builds — not hot reload; merge with `provideMerge`. Changing config on a running resource is unsupported.
- **must** Supervisor invariant: one fiber per started process; outer loop waits for the armed schedule, inner loop runs polling ticks while armed. Keep three lifetimes separate: group constructed / driver started / schedule armed-vs-ticking. Polling ("how often an armed instance repeats") ≠ schedule ("should this instance keep running now").
- **must** A base `Process.Tag` is always-armed; add a schedule via `.pipe(Process.schedule([…]))`, seed `[]` to start disarmed. `ProcessMakeOptions` has no `name` (the `id` becomes `process.name`). Removed: `Process.result(Schema)`, positional schema overloads.
- **must** `Process.make` doesn't auto-append run rows — apps needing history use `Process.layer`/`serve`/`serveRemote`. `RunResource.make` still needs `Store.layerDefaultMemory`; layer/serve forms merge it themselves.
- **must** When the tag declares `success`, the worker `effect` returns `Effect<A,…>`; with none it stays `Effect<void,…>`.
- **must** Default `QueueResource` (high/normal/low) stays lean and unchanged — N-level lanes live in `CustomQueueResource`, a separate type/subpath; scheduled-lane code is dynamic-import-only. Weighted-middle scheduling ships as its own resource type, sharing the engine, swapping only an internal `LaneStore`.
- **must** Queue durability is presence-driven — provide a `DurableQueueStore` layer AND declare `payload`; control verbs (`release`/`deadLetter`/`drop`) select by `entryId`/`key` (item refs don't survive serialization). `queue.release()` = local pending-only; `queue.releaseEncoded()` = remote/wire, requires `payload`.
- **must** Self-enqueue from within a worker (`ctx.add`/`prioritize`/`defer`) is guarded — same ref/key warned + dropped.
- **must** `persist` + a non-serializable item type is a compile error (enqueue/entry methods become `local`-only), not a runtime surprise.
- **should** ProcessGroups are being removed — each process/resource owns its own controls.
- **must** Do not build discarded orchestration: runtime-wide reconciler, old `ProcessControl` with `switchSchedule`/`sleepUntil`, `Polling.cron`, dynamic `addProcess`/`removeProcess` on a live group.

## C11 — Multi-host invariants · appliesTo=src
*Source: `multi-host-instances-decisions.md` (SSOT), peers/readiness handoffs, memory.*

- **must** One resource = N host-local instances (one class the consumer holds), not N resources; groups only organize (a tag is one group node).
- **must** Readiness/`/health` stays per-host and local — never a cross-host hop (would cascade). Fleet-gated health needs an explicit new opt-in. No parallel `HostHealth`/`Resource.health` model, no `dependsOn` graph — readiness is the SSOT status-derivation on the tag, with two faces (`GET /health` 200/503 + `HostStatus`).
- **must** Combined/fleet values are plain queries tagged `Resource.fleet`; the `fleet` field is excluded from `Resource.peers` so folds fan out over leaf fields only. Self-inclusion is explicit.
- **must** Peer clients are fully lazy — never build/connect/subscribe at `peersLayer` build; a down peer is a partial mesh (drop per-query), never a boot failure or silent permanent drop. Peer URLs come via `Config`/`ConfigProvider`, never frozen into the contract.
- **must** In a class-`extends` base, a combinator callback must not reference the class being defined (peer tags OK).
- **should** Host-bound-tag helpers accept both data-first and data-last forms; type consumer params by the minimal structural shape read, not `Resource.ServiceOf<typeof spec>` (deepens instantiation → TS2589).

## C12 — Error handling & correctness · appliesTo=src
*Source: hunt-findings, service-shape-redesign, store-backing, memory.*

- **must** Journal/IO write failures → catchable `StoreWriteError` in `E`; encode/serialization mismatch is a defect (`Effect.orDie`), not a failure. The error type carries its category — no method needs a "this is a write" marker.
- **must** Wrap sync codecs (`decodeUnknownSync`/`encodeSync`) in `Effect.try` → typed error, never an unrecoverable defect.
- **must** Check-then-insert / read-then-fork spanning a `yield*` must be atomic (single `Ref.modify`) so dedup/idempotency holds; multi-record writes use `sql.withTransaction`; capture the wait handle before re-checking to avoid lost wakeups.
- **must** Fail loudly on misconfiguration — block acquire until value paths emit, with a timeout that dies loudly; a missing RPC handler fails `RpcServer` at boot. Never a silent placeholder.
- **must** Startup/seed hooks run forked (never block worker startup), run-once, queue-scoped; failures route to `events` + a log, never fatal.
- **must** Fix type errors wherever they appear during a task; don't ignore unrelated type failures.

## C13 — Build, tree-shaking & browser safety · appliesTo=src,infra
*Source: setup/service-tags-and-runtime-split guides, plans/18, memory (browser safety).*

- **must** Keep the contract (light tags) in a different module from the implementation (engine layers, storage, workers, server) — a module defining a tag AND importing its `.layer`/`httpServer`/storage is node-coupled.
- **must** Browser/widget bundles import only the tag from its subpath via `import * as X from "<subpath>"` (proven engine-free); use the barrel on the Node side. Node-only modules (`/storage/sqlite`, `/storage/redis`, `NodeHttpServer`, worker/storage layers) must never be reached from browser code.
- **must** Package stays ESM-only, `"type":"module"`, `"sideEffects":false`; tsup treeshake + code splitting; every optional peer (react/recharts/ink/sqlite/redis) externalized. Default `QueueResource` graph must not statically import scheduled/custom lane stores (dynamic import only).
- **must** Public surface goes through the barrel + a package subpath (`index.ts` + `package.json` exports + `tsup.config.ts`); declare each helper export exactly once (a double export sends tsgo into a >7min loop).
- **should** Prefer specific subpaths over the root barrel in browser code (barrel is node-safe but pulls ~260KB pre-shake). Diagnose a leak by building + grepping the client bundle for `node:`/`better-sqlite3` and tracing the import chain.
- **should** Guaranteed barrel tree-shaking wants a preserve-modules/unbundled ESM build; CI guard greps the client bundle for engine symbols (want 0).

## C14 — Telemetry / metrics · appliesTo=src
*Source: `telemetry.md`, telemetry-design, api-resource-metrics, memory.*

- **must** effect-pm ships no OTEL code — metrics are standard Effect `Metric`/spans. OTEL export is doc-only (peer `@effect/opentelemetry`); "Don't reinvent Grafana" — OTEL/Grafana own retention/alerting/query.
- **must** The `Telemetry` resource is deliberately thin — it serves data; it does not retain, alert, or query.
- **must** Keep metric labels low-cardinality (`host`/`client`/`status`) — never per-endpoint or per-entity labels; per-entity state is read from the entity's own `status`/`snapshot`.
- **must** Keep the metrics/contract surface browser-safe (pure `Metric`/`PubSub`, no node deps).

## C15 — UI / dashboard conventions · appliesTo=src
*Source: setup §6, dashboard handoffs, memory (per-type widgets, dogfood, TUI adaptation).*

- **must** Dashboard widgets are hand-crafted, styled, one per resource type (queue/process/api-metrics), classified by stamped `Resource.kindOf` — a generic introspection UI is rejected.
- **must** Web and TUI render off the same reactive binding; the dashboard talks to served resources through `Resource.client` and never touches the store (the host owns persistence).
- **must** Don't render from a hand-maintained list — derive from the contract via `specOf` + `methodMeta` so new resources appear automatically. `useAtomSet` must mount; UI tag imports stay light (tags are classes).
- **should** Keep concurrent live streams per view ≤ ~5 (browsers cap ~6 HTTP/1.1 conns/origin); derive related views from one stream.
- **must** `HostLogs.persistLayer(host)` composes with `provideMerge` (installs a logger, provides no service). A resource's own `logHistory` (needs `captureLogs` + `HistoryStore`) is per-resource; `HostLogs` is the whole-host firehose — don't use it for one resource.
- **must** Polish the SHIPPED subpath, not a parallel example; the example is a thin consumer of the shipped surface.

## C16 — No backward-compat shims · appliesTo=src,test,examples,docs
*Source: rpc-schema-names, store-transforms, store-cutover handoffs [recurs 4].*

- **must** No backward-compat shims — no `@deprecated` aliases or re-exports under old names. Delete renamed symbols outright; update every callsite in one breaking change; provide migration snippets in docs only.
- **should** Ship no error-suppression comments (`@effect-diagnostics-next-line`/`eslint-disable`) in the library unless each is verified still needed.

## C17 — Verification gate · appliesTo=process,test
*Source: AGENTS.md, nearly every handoff [recurs 8+], memory (tests, Effect LSP CLI).*

- **must** Every increment (incl. docs-only) is green before commit: `tsgo` both tsconfig projects (0) · `effect-language-service diagnostics` (0 — catches editor-only Effect rules tsc/tsgo miss) · eslint/lint · build (exit 0) · full `vitest run`. No release without full green.
- **must** Always write thorough tests — testing never needs approval (exempt from the no-code-without-approval stop).
- **must** Effect programs use `@effect/vitest` (`it.effect`/`it.live`); import `expect` from plain `vitest`. Timing/interval tests use `it.live` (TestClock stalls real-time polling).
- **should** Pin public types with `*.test-d.ts` (no casts). Prove persistence round-trips with a *rich* success/error schema (DateTime/Exit/Cause) — plain structs pass while rich types silently fail. Regression tests exercise both data-first and data-last forms.
- **must** Never blind-`sed` a rename sharing a prefix with unrelated identifiers (bare `serve` hits `HttpRouter.serve`) — rename the specific call form only.

## C18 — Git, branch & release policy · appliesTo=process,infra
*Source: AGENTS.md, branch-cleanup/store-migration handoffs, memory (permission-before-main, branch-from-main, commit+push, release ritual).*

- **must** Never commit/push/merge/PR on `main`/`develop`/release/user-owned/shared-integration branches without explicit **per-action** owner go ("prepare to merge" ≠ merge). Agent-created `cursor/*` branches are the exception.
- **should** Name working branches `action/short-description`; cut new work from the integration base (not another agent's unmerged branch); keep related work on one branch/one PR — no branch-per-slice, don't stop between slices. Open PRs against the integration branch, not main, unless told.
- **should** Commit at sensible points proactively and push the same turn (a local commit isn't done until pushed).
- **must** Every public-API/breaking change ships one coherent changeset (pre-1.0 breaking = minor bump); a changeset needs owner approval; beta releases are manual (don't run `changeset version` — add `.md` + pre.json + CHANGELOG + version bump).
- **must** Branch cleanup: delete a remote `cursor/*` branch only when it's a merged ancestor AND 0 commits ahead; re-audit immediately before each delete; one branch per command; never force-push or delete keep-list branches.

## C19 — Design & approval process · appliesTo=process
*Source: store-layer-query, contract-serve-reform, memory (no-code-without-approval, approve-before-lock, no-question-barrage, stop-on-constraint, auto-document, work-from-decisions).*

- **must** No code during design deliberation until an explicit go — external opinions ≠ approval; "discuss first" = hard stop. Don't build blocked/rejected designs speculatively.
- **must** The decisions/plan doc is the SSOT — build from it, never regenerate locked API shapes from chat/memory, never re-propose rejected shapes. Auto-write decisions into the doc during bakes; keep a "do not resurrect" section.
- **must** Present each API item and wait for approval before marking it ✅/locked. Open planning with 3–5 highest-uncertainty questions at a time — no question-barrage; when asked for ideas, just answer directly.
- **must** When a limitation forces a compromise/half-ship, STOP for a deliberate owner decision — don't silently ship the fallback or invent a rejected taxonomy; document the blocker with file:line pointers.
- **must** Sequence dependent reforms (A before B when A deletes machinery B would special-case); respect per-agent file ownership; stay in scope (no scope creep).

## C20 — Agent workflow & response style · appliesTo=process
*Source: supervisor-protocol, agent handoffs, memory (response-style, handoff-docs).*

- **must** Show ALL work in the owner chat every slice — actual prose, full code, full command output; never file lists, "tests pass," or `git diff --stat`. Before/After blocks per slice (new file → `(none — new file)` + full file).
- **should** Be terse — no preamble, no passive summary-only endings; end with the next sensible slice / blocker / question.
- **should** Supervisor coordinates via docs + git (owner never relays between agents); apply "mean critique" (claimed vs actual); update `agent-status.md` (one row/agent) on every push.
- **should** Write handoffs as self-contained requirements for the actual reader, not a first-person peer letter; ground problem-reports in a specific released version, back claims with proof (errors/tests/source refs); maintain a resolution/status header + cross-links; preserve superseded request text.

## C21 — Documentation conventions · appliesTo=docs
*Source: AGENTS.md, PACKAGE-GUIDE, docs-platform-architecture-decision, memory (formatting, dogfood).*

- **must** Regular docs describe implemented behavior; `docs/plans/` describes future work only — never mix. Verify doc claims against `src/` before teaching a concept as shipped; run the stale-docs grep sweep before release.
- **must** Docs are a first-class deliverable — rewrite affected guides + add a migration guide with the golden worked example in the same change; demonstrate features honestly (a real example, not a contorted one). Example code is linted; examples are thin consumers.
- **should** Guides stay concept-shaped (why/how, not signature-level what); TSDoc carries the signature detail. Link cross-doc with relative paths.
- **should** Never collapse multi-field objects/params onto one line — one field per line (small screen).
- **must** *(Agent B's platform — context only)* the docs site is bespoke Waku RSC over Vite, content in Djot, one rule = one section with a dotless id, manifest derived from the AST, malformed content fails the build.
