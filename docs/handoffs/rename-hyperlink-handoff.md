# Rename: hyperlink-ts → Effect Hyperlink (`hyperlink-ts`)

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

Owner decision, 2026-07-21. This doc is the SSOT for the rename — work from it, do not
re-derive the naming from chat history.

## The decision

- **Brand: "Effect Hyperlink". npm package: `hyperlink-ts`.**
- The pitch (use it in the README): *the web made documents location-transparent;
  Effect Hyperlink does it for services.*
- **The primitive `Hyperlink` is REPLACED by `Hyperlink`** — this was an explicit owner
  requirement: the new name names the thing you declare, not just the package.
  `class Emails extends Hyperlink.Tag<Emails>()("app/Emails", { … }) {}`

## Kind renames — the `*Resource` types (owner-locked 2026-07-22) — ✅ SHIPPED 2026-07-23

Generic, pattern-free nouns — **not** a `*Resource`/`*Link` suffix. "What would Effect do" applied
throughout: behavior-named peer constructors, `with*` reserved for aspect config, inference over
overloads. Two of the old kinds **collapse** into others, so the public kind list shrinks. The table
below is the AS-SHIPPED outcome (a couple of the original predictions — `NodeStatus` and the
`Built`/`Served` shapes — landed differently than sketched; corrected in place).

| Today | New | Notes |
|---|---|---|
| `Hyperlink` | **`Hyperlink`** | core namespace + the thing you declare |
| `WorkPool` | **`WorkPool`** | |
| `WorkPool.Service (untyped)` | **`WorkPool.priority(…)`** | FOLDED IN as a behavior-named **peer constructor** beside `WorkPool.Tag` (Effect's `Queue.bounded`/`dropping` shape). NOT an overload on `.Tag`, NOT `.leveled`, NOT `withLane`, NOT `makeCustom`. Leveled **engine stays its own internal module** (the tree-shake split). Vocab swept to **`lane`** (`laneCount`/`namedLanes`/`add(item, lane?)`; wire field `lane`). |
| `Gate` | **`Gate`** | it's a concurrency gate for effects, not a process runner |
| `HttpApiClient` | **`Gate.httpApiClient(…)`** | FOLDED IN — the module *is* a `Semaphore` gate over the HttpClient transport (`HttpClientRunGate.withRunner` wrapping `HttpApiClient.make`) + per-endpoint metrics. Peer constructor beside `Gate.Tag` (+ `httpApiClientService`/`httpApiClientLayer`/`acceptJson`/`instrumentEndpoints`). `HttpClientRunGate` stays the shared internal engine. |
| `Daemon` | **`Daemon`** | supervised long-running process |
| `NodeStatus` | **node-handle accessors** — `(yield* node).status` / `.logs` / `.ping` | SHIPPED as accessors ON THE CONNECTED NODE HANDLE, not a `node.pulse` / `Hyperlink.status(node)` free function. Each node auto-serves its own status/logs/ping; because a node tag *is* its own `Context.Service`, reading node A vs B is `yield* NodeA` vs `yield* NodeB` — no shared slot, no cast. The `NodeStatus` module + `Node.status` namespace are **deleted**; the light snapshot types survive as flat `Node.Status` / `Node.ServiceReadiness` / `Node.serviceReadiness`. Engine is a lazy internal (`Node.Tag` stays light). See [[project-nodestatus-on-handle]]. |
| `Driver` / `ServedHyperlink` | **`Driver`** / `ServedHyperlink` **@internal** | `BuiltHyperlink` → **`Hyperlink.Driver`** (+ `driver`/`isDriver`/`driverSym`). Registry was `ServedHyperlinks` → **`ServedHyperServices`** / `servedHyperServicesLayer` (**@internal**; no “Hyperlinks” plural). |

Namespace clash check done before locking: `WorkPool` / `Gate` / `Daemon` clear of Effect's namespace

## Already secured on npm (owner's account: `nikolasstow`)

- `hyperlink-ts@0.0.1` — THE package name (placeholder published 2026-07-21).
- `effect-hyperlink@0.0.1` — published as a brand signpost. ⚠️ OWNER DECISION PENDING:
  keep as a "you want hyperlink-ts" pointer, or unpublish — the clean-unpublish window
  closes ~2026-07-24. Ask before it lapses.
- Also owned (earlier candidate, superseded): `torsor-ts@0.0.1`. Leave it.
- Bare `hyperlink` is a real maintained project (link checker) — never claimable; the
  brand does not depend on it.

## Rename scope (in dependency order)

1. **Module**: `src/Hyperlink.ts` → the `Hyperlink` namespace (`import * as Hyperlink from
   "hyperlink-ts/Hyperlink"` — final subpath naming is part of this work; keep the
   `import * as X` namespace convention).
2. **Package identity**: `package.json` name → **`hyperlink-ts`** (unscoped — owner
   2026-07-22: do **not** keep `@nikscripts`). Subpath exports under that name.
   Wire/runtime ids that today use `hyperlink-ts/…` move to a
   `hyperlink-ts/…` (or agreed) prefix in the same sweep.
3. **Every `Hyperlink.` call site** — src, examples, test, docs (guides use it in twoslash
   blocks; they typecheck, so misses fail loudly).
4. **Docs site**: glossary entries (Resource/Tag/Contract/Handle), nav, api-slugs, the
   island `hyperlink-ts` alias (done), search corpus + llms regen, README, hero copy.
5. **Changeset**: this is THE breaking change of the next release; write it prominently.

## Precedent & tooling

The `Node.Tag` two-stage break migrated 148 call sites with a regex sweep + full gates —
see commit 6972d5558 and its migration script pattern. Reuse the approach: regex the call
forms, then let tsc + docs twoslash find the stragglers.

## Constraints (house rules that bit before)

- Editing `docs/site/src/lib/**` or `docs/docgen/**` re-keys the hover cache → a ~1.5 h
  background gen-hovers re-stamp. Batch such edits.
- After the sweep: gen-api → gen-search → gen-llms → check-links must all pass; the
  byte-diff discipline doesn't apply (this is an intentional full-surface change).
- Full root tsc + tests + effect-language-service on touched files; docs suite; the
  works. No `as` casts, exported interfaces, camelCase values.
- "What would effect do" is the standing design tiebreaker (see memory/feedback).

## Known context, NOT this work's fault

The 17 node-transport test failures once on integration's tip are **RESOLVED** (merge
`63b51ea1a`, 2026-07-22). Cause: default-on client verify probes real sockets with real-time
`Effect.sleep`/`Effect.timeout`, which deadlock under `@effect/vitest`'s `it.effect` virtual
`TestClock`. Fix: real-transport verify tests use `it.live`; the browser-guard `ws` test opts out
via `Hyperlink.clientVerify(false)`. **House rule for this sweep:** any test that builds a real
client+server (thus hits default-on verify) MUST use `it.live`, never `it.effect`.

## Open questions for the owner (ask, don't assume)

1. `effect-hyperlink`: keep as signpost or unpublish (deadline above)?
2. GitHub repo rename (hyperlink-ts → ?) — **npm scope settled:** drop `@nikscripts`,
   publish as bare `hyperlink-ts`.
3. Docs domain (blocks DOCS_SITE_ORIGIN, the banner stamp, and deploy — see
   docs/site/deploy/README.md).

## Follow-up vocab (2026-07-28) — HyperService, not “resource”

Owner: purge remaining product “resource” names. Shipped in the same tip:

| Was (AS-SHIPPED snapshot) | Now |
|---|---|
| `Node.ResourceReadiness` / `resourceReadiness` | `Node.ServiceReadiness` / `serviceReadiness` |
| `Node.Status.resources` / `resourceCount` | `services` / `serviceCount` |
| `/health` JSON `resources` | `services` |
| `FleetHealth.*.resources` | `services` |
| Error / verify field `resource` | `serviceKey` |
| `VerifyConnectionDeepOptions.resource` | `serviceKey` |
| Lookup `resourceKey` | `serviceKey` |
| Launcher `ready.resources` | `ready.services` |

Internal engine may still say `NodeStatusTag` / wire key `hyperlink-ts/node-status` (not a public module).
Folder renamed: `docs/resources/` → `docs/services/` (site URLs stay basename: `/docs/contracts`, …). Standards chapter slug/URL → `hyperlink-services` (`/docs/hyperlink-services`); redirects kept for `/docs/resources` and `/docs/hyperlinks`. Manifest rule ids → `hyperlink-services.*`. Internal registry: `ServedHyperlinks` → `ServedHyperServices` / `servedHyperServicesLayer`.
