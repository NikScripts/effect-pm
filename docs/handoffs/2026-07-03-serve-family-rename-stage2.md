# Handoff: finish the serve-family rename (Stage 2 drops)

**Branch:** `value-to-ref` (10 commits ahead of `main`; **not merged, not released**).
**State:** green — typecheck 0, build 0, Effect LSP clean, **392 tests pass**. The tree is coherent: the
retired names still work; the new path is ready. Do NOT merge to `main` or cut a beta without the owner's
explicit go.

This branch carries four completed reforms. This handoff covers only the **remaining** work: dropping the
retired serve names. Design decisions are locked in `docs/handoffs/2026-07-03-contract-serve-reform.md` —
read that first; do not re-derive.

## Already shipped on this branch (do not redo)
1. **`value` → `ref`** — `Resource.ref` (a `Subscribable`), `subscribable` / `mapSubscribable`; deleted
   `value`, the mirror, block-for-initial, and the `changes`/`ref` accessors.
2. **Serving is local + served by default** — `serve` grants `Self | LocalCapability` alongside the wire
   handlers from ONE materialization; `serveRemote` is served-only.
3. **Mode-name rename (Stage 1)** — the vocabulary below is live for `Resource.*`.
4. **`httpServer` auto-serves node-status** — so `httpServer([serve-layers])` fully replaces `serveAllHttp`.

## Locked target vocabulary
- **Modes (protocol-neutral):** `layer` (local) · `serve` (local + served, default) · `serveRemote`
  (served-only) · `client` (remote).
- **Transport:** `httpServer([...serve-layers], opts)` · `httpClient(node)` · generic `connect` for custom
  protocols. (`Http` appears ONLY on the transport line — the core is transport-agnostic today; only these
  bundlers hardcode HTTP. A future `wsServer`/`wsClient` slots in with no new vocabulary.)
- **Retired (still present on `Resource` + the contract namespaces, to be removed):** `server`,
  `serverEntry`, `remoteEntry`, `serveAllHttp`, `serveHttp`.

Call sites become uniformly:
```ts
httpServer([
  serve(Database, dbImpl),       // local + served (default)
  serveRemote(Gateway, gwImpl),  // served only
]).pipe(Layer.provideMerge(NodeHttpServer.layer({ port })))
```

## Remaining Stage 2 work (in order, keep typecheck green at each)

### 1. Contract cascade — `src/QueueContract.ts`, `src/CustomQueueContract.ts`, `src/ScheduledProcess.ts`, `src/ApiMetrics.ts`
Each mirrors `Resource`'s serve-family. Apply the same swap:
- Rename the exported **`serve`** (served-only; delegates to `Resource.serveRemote`) → **`serveRemote`**.
- Rename **`serverEntry`** → **`serve`**, AND change its body from producing a `ServeEntry` (`{ tag, impl }`)
  to producing a **layer**: `Resource.serve(tag, buildImpl(tag, config))` (the Effect-form impl — e.g.
  `buildQueueImpl(tag, config)` — goes straight into `Resource.serve`, no `Layer.unwrap` needed).
- **Delete** the exported `server` and `serveHttp`.
- Update the namespace re-exports: `src/internal/queueResourceNamespace.ts`,
  `customQueueResourceNamespace.ts`, `scheduledProcessNamespace.ts`, and `ApiMetrics`'s flat exports + the
  barrel (`src/index.ts`) — drop `server`/`serveHttp`/`serverEntry`, add `serve`/`serveRemote`.
- Reference (QueueContract, current): `serve` at ~886 (→`serveRemote`), `serverEntry` at ~913 (→`serve`),
  `server` at ~824 (delete), `serveHttp` at ~846 (delete).

### 2. Resource-level call-site migration (mostly `test/`, `examples/`, `docs/`)
- `Resource.serveAllHttp([...])` → `Resource.httpServer([...])`.
- `serverEntry(X, i)` → `serve(X, i)`; `remoteEntry(X, i)` → `serveRemote(X, i)` (Resource AND contract
  namespaces — after step 1 the contract `serve`/`serveRemote` exist).
- `serveHttp(X, i, opts?)` → `httpServer([serve(X, i)], opts)` — **structural** (wrap in an array + `serve`),
  not a plain rename. ~51 sites; do these deliberately.
- Counts at handoff time: `serverEntry` ~88, `serveAllHttp` ~66, `serveHttp` ~51 references.

### 3. Drop the retired functions from `src/Resource.ts`
Only after step 2 leaves zero callers: delete `serverLayer` (exported as `server`), `serverEntry`,
`remoteEntry`, `serveHttp`, `serveAllHttp`, the `ServeEntry` interface + `serveGrantSym` +
`ServeEntriesR`/`ServeEntriesGrant`/`EntryR` types (all only used by the entry machinery), and their entries
in the export block. `serve` (local+served) + `serveRemote` + `httpServer` remain.

### 4. Docs + tidy
- `test/serve-local.test.ts` → rename to `serve.test.ts` (it tests `Resource.serve` now).
- Update `docs/guides/*` and the `@packageDocumentation` block in `src/index.ts` for the new vocabulary.
- Extend the existing `.changeset/value-to-ref.md` with the retirements.

## Gotchas already discovered (don't re-hit)
- **`serve` vs `serveHttp` etc. in blind renames:** never sed bare `serve` — it hits `HttpRouter.serve`,
  `serveInstances`, `servedResources`. Rename the specific identifiers / `Resource.serve(` call form only.
- **`ref` client `get`:** a `ref`'s client keeps ONE kept-open cache subscription — do NOT reintroduce a
  per-`get` stream close; closing a `Schema.Never`-error RPC stream early trips its error decode.
- **`serveAllHttp` bypassed `invokeWireMethod`** (now fixed) — any serve path that builds handlers must
  route through `invokeWireMethod` so a `ref`'s `Subscribable` is served as its `.changes`.
- **Queue status race (fixed):** the engine's status-refresh fiber must subscribe **synchronously**
  (`PubSub.subscribe` + `Stream.fromSubscription`), not the lazy `Stream.fromPubSub` inside a fork — the old
  `value` mirror had been masking a dropped-first-event race. See `src/QueueResource.ts` ~2270.
- **Casts flagged for a follow-up pass** (owner said "look at the cast after"): the dynamic serve boundary
  (`ImplOf`/`ServeImplOf` gap + the erased entry merge) has a handful of documented `as unknown as` casts in
  `serve` / `serveLocal`→`serve` / `serveAllHttp` / `serveHttp`. The structural fix is extracting `serve`'s
  record-taking body. Not required for Stage 2, but note it.

## Verify at the end
`npm run typecheck` (0), `npx vitest run` (all green), `npm run build` (exit 0), and
`npx effect-language-service diagnostics --file src/Resource.ts` (0). Then hand back for the merge/beta go.
