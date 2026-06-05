# Code review findings — `cursor/transport-protocol-unify`

Reviewed against repo rules (`AGENTS.md`, `public-vs-internal.mdc`).
Multi-agent review: 4 finder angles × parallel verification × sweep pass.

**Round 1** (pre-6.5): 13 findings.
**Round 2** (post-6.5 / commits `9f5eef2` + `163c37c`): 3 new findings; findings 2, 6, 7 confirmed fixed.

### Fixed by 6.5 commits
- ~~Finding 2~~ — `forLookup` payload double-wrap ✅
- ~~Finding 6~~ — `decodeError` always mapping to `PayloadDecodeError` ✅
- ~~Finding 7~~ — wrong lookup table for `UnknownFacet` vs `UnknownMethod` ✅

---

## CONFIRMED CRITICAL

### 1. `readByRun` full-table scans all run facts — `src/store/runResource.ts` ~line 992

`factPredicates(undefined)` emits only `Type.in(factRecordTypes)` with no `ProcessId`
predicate. Every `readByRun` call scans the entire run-fact table and post-filters
client-side. The for-bound `byRun` method (line 928–930) correctly passes `resourceId`
into `factPredicates`; only the top-level `readByRun` is broken.

**Failure:** Two `RunResource` gates sharing a `runId` string (e.g. sequential IDs like
`"run/1"`) — `readByRun({ runId: "run/1" })` returns facts from all matching gates,
corrupting the `pairRuns` projection. Also a full-table scan performance issue regardless
of collision.

**Fix:** Pass `resourceId` (available from the service's own `processId`) into
`factPredicates` inside `readByRun`, matching what `byRun` already does.

---

## CONFIRMED HIGH

### 2. `forLookup` wraps payload twice — `src/storeTransport.ts` ~line 377

The effect-method arm of `for` on the client encodes `{ payload: raw }` through
`makeEncodePayload`, producing `{ id, payload: encode({ payload: raw }) }` on the wire.
The server unwraps one level to get `encode({ payload: raw })` and then decodes expecting
`raw` directly — a schema decode failure on every `for`-method call.

The stream arm at line 394 is correct: it encodes `raw` directly.

**Failure:** `client.for.RunResource("r1").byRun({ runId: "x" })` → server decode error on
every effect-method call. Stream methods work; effect methods are broken.

**Fix:** Change line ~377 from `makeEncodePayload(entry)({ payload: raw })` to
`makeEncodePayload(entry)(raw)` to match the stream arm.

---

### 3. `QueueResourceStore` uses legacy factory form — `src/store/queueResource.ts` ~line 926

`QueueResourceStore` is declared as:
```ts
export const QueueResourceStore = ProcessStore.Service(id, tag, ...)
```
instead of the required:
```ts
export class QueueResourceStore extends ProcessStore.Service<QueueResourceStore>() { ... }
```
`LogStore` and `RunResourceStore` both use the correct class-extends form. The rule is
enforced in `docs/AGENTS.md` and `.cursor/rules/public-vs-internal.mdc`.

**Fix:** Convert to class-extends form. Also check that the exported type is an explicit
`export interface`, not a schema-derived alias.

---

## PLAUSIBLE HIGH

### 4. Replay store deletes one non-expired entry at capacity — `src/internal/commandAuth/replay.ts` ~line 31

Eviction loop condition:
```ts
if (expiresAt <= input.sentAt || accepted.size >= maxEntries) {
  accepted.delete(key);
}
```
When `accepted.size === maxEntries`, the `>= maxEntries` branch fires on the first
iterated entry and deletes it regardless of whether it has expired. Because `Map` size
decrements live during `for...of`, only one entry is spuriously deleted per `reserve()`
call at capacity — but that entry can be immediately replayed.

**Failure:** After `maxEntries` (default 10,000) distinct valid envelopes within the replay
window, each subsequent envelope causes the oldest non-expired entry to be evicted from
the replay store, opening a replay window for that envelope.

**Fix:** Remove the `|| accepted.size >= maxEntries` branch from the per-entry condition.
Apply a capacity limit separately before or after the expiry sweep (e.g. a hard cap that
rejects `reserve` when full, or a sorted eviction of the nearest-to-expire entry).

---

### 5. Key expiry checked before signature verification — `src/CommandAuth.ts` ~line 423

`assertNotExpired` and `assertWithinSkew` run before the Ed25519 signature is verified.
An attacker who knows a `keyId` but has no private key can probe whether the key is live:
- expired key → `ExpiredKey` response
- live key → `SignatureVerificationFailed` response

This leaks key lifecycle state without any cryptographic check having occurred.

**Fix:** Move `assertNotExpired` and `assertWithinSkew` to after signature verification.
The signature check is cheap and should be the first gate.

---

## PLAUSIBLE MEDIUM

### 6. `decodeError` always produces `PayloadDecodeError` instead of the real server error — `src/storeTransport.ts` ~line 236

`StoreErrorSchema` uses `Schema.instanceOf(...)` for each error class, but errors arrive
over the wire as plain JSON objects. `Schema.instanceOf` always fails for deserialised
plain objects, so `decodeError` always fails, and the `mapError` wraps the schema failure
in a `PayloadDecodeError`. Every server-side typed error (`UnknownMethod`, `StorageError`,
etc.) arrives at the caller as `PayloadDecodeError`, bypassing any
`Effect.catchTag("UnknownMethod", ...)` in the caller.

**Fix:** Replace `Schema.instanceOf` in `StoreErrorSchema` with tagged-union decoding
(e.g. `Schema.TaggedStruct` or discriminated union on `_tag`) so plain JSON round-trips
correctly.

---

### 7. Unknown-method check uses wrong lookup table — `src/internal/store/storeTransport.ts` ~line 378

When a `forQuery` tag resolves to `undefined`, the code checks `parsed.facet in registry.lookup`
to distinguish `UnknownFacet` from `UnknownMethod`. A facet that has only `for`-methods
(nothing in `registry.lookup`) returns `UnknownFacet` instead of `UnknownMethod` for a
misspelled method name, producing misleading diagnostics.

**Fix:** Check all four lookup maps:
```ts
parsed.facet in registry.lookup ||
parsed.facet in registry.forLookup ||
parsed.facet in registry.streamLookup ||
parsed.facet in registry.forStreamLookup
```

---

### 8. Declared `ControlRpcError` type is dead — `src/ControlTransportRpc.ts` ~lines 177–187

`Rpc.make` declares `error: ControlRpcErrorSchema` but the handler body has type
`Effect<_, never, _>` — it never emits that error. Real adapter-layer defects propagate
as defects, bypassing the `rpcErrorToControlTransportError` recovery path on the client.
Any `catchTag("ControlRpcError", ...)` in callers is silently bypassed.

**Note:** Slice 6.5 may delete or replace this file. Coordinate before fixing.

---

### 9. `decodePublicKeyRecordJson` catches all errors, not just "not-an-array" — `src/CommandAuth.ts` ~line 553

```ts
decodePublicKeyRecordsJson(text).pipe(
  Effect.catch(() => /* try single-object parse */)
)
```
`Effect.catch` without a `_tag` filter catches every failure from the array-parse attempt.
A structurally valid JSON array with malformed records fails array-decode and falls through
to single-object retry, producing a confusing second error instead of the original.

**Fix:** Use `Effect.catchTag("KeyMaterialError", ...)` or a typed filter so only the
"input is not an array" case falls through to the single-object path.

---

### 10. Empty metadata object produces different canonical bytes than absent metadata — `src/internal/commandAuth/canonical.ts` ~lines 84–101

`metadataText` returns `"{}"` when all optional fields (`actor`, `reason`, `traceId`) are
undefined. A signer that passes `metadata: {}` produces `"metadata":{}` in the canonical
payload; a verifier that strips empty metadata before canonicalising produces different
bytes → `SignatureVerificationFailed`.

**Fix:** Either always omit the `metadata` key when it would be `{}`, or document and
enforce that callers must not pass `metadata: {}` (pass `undefined` instead).

---

### 11. Missing timestamp field silently writes epoch-zero `occurredAt` — `src/internal/store/telemetry.ts` ~lines 720–727

`makeSchemaRecord` falls back to `0` when the event payload has none of `occurredAt`,
`changedAt`, or `completedAt`. A new facet using a non-standard timestamp field name (e.g.
`recordedAt`) produces records stamped `1970-01-01T00:00:00Z` with no error. Every
time-windowed query (`After`, `Before`, `Between`, `orderBy: occurredAt desc`) silently
excludes or misorders them.

**Fix:** Fail loudly (return an `Effect.fail`) when no recognized timestamp field is
present, rather than silently falling back to epoch zero. Alternatively document the
required field names in a type constraint so the compiler catches missing timestamps.

---

## PLAUSIBLE LOW

### 12. `assertWithinSkew` throws `ExpiredKey` for clock-skew rejections — `src/CommandAuth.ts` ~line 278

Stale-message rejections and actual key-expiry both produce `ExpiredKey`. Callers that
catch `ExpiredKey` to trigger key rotation will fire incorrectly on a late message instead
of a retry or clock-skew alert.

**Fix:** Add a dedicated `StaleMessage` or `MessageOutsideReplayWindow` error type for
timestamp-skew rejections, leaving `ExpiredKey` exclusively for key lifecycle.

---

### 13. `predicateIncludesReadonlyTrue` duplicated across adapters — `src/storage/sqlite/codec.ts` + `src/storage/redis/service.ts`

### 13. `predicateIncludesReadonlyTrue` duplicated across adapters — `src/storage/sqlite/codec.ts` + `src/storage/redis/service.ts`

Structurally identical implementations exist in both files. A new predicate variant (e.g.
`In`) added to one adapter's copy won't automatically cover the other, causing divergent
readonly-guard behaviour across storage backends.

**Fix:** Extract to a shared helper in `src/internal/store/helpers.ts` and import from
both adapters.

---

## Round 2 findings — post-6.5 commits (`9f5eef2` + `163c37c`)

---

## CONFIRMED CRITICAL (Round 2)

### 14. Dead `/logs/stream` callers — `src/react/controlHttp.ts:297` and `src/internal/manager/groupLogWatch.ts:34`

`GET /logs/stream` was removed from `ControlTransportHttp` in the 6.5 commit but two
callers were not updated:

- `src/react/controlHttp.ts` line 297 (`controlHttpLogs`) still builds a `/logs/stream`
  fetch request and is wired into `createFetchControlPlaneAdapter` via
  `src/react/adapters/fetch.ts` line 91 (`logs: (params) => controlHttpLogs(...)`).
- `src/internal/manager/groupLogWatch.ts` line 34 (`groupLogEntryStream`) hits
  `/logs/stream` on the child control plane for internal group log streaming.

Both receive 404 at runtime with no compile-time signal. The React dashboard log panel
and the internal group log watcher are silently broken.

**Fix:** Update both callers to use the WebSocket `logTransport` path (`/ws/log`), or
explicitly mark them as deprecated pending client migration with a runtime warning. Do not
leave them pointing at a removed endpoint.

---

## MEDIUM (Round 2)

### 15. `ControlTransportApi` and `LogTransportApi` missing `server`/`makeServer` members — `src/controlTransport.ts`, `src/logTransport.ts`

The underlying `ControlTransportRpc` and `LogTransportRpc` modules both export a
`server`/`makeServer` function for callers who need to construct the server shape manually
without going through `serverLayer` (e.g. passing an existing protocol instance directly).
Neither new facade interface exposes this entry point, leaving advanced composition only
accessible via the lower-level module import.

**Fix:** Add `server: typeof makeControlTransportRpcServer` (and log equivalent) to each
`*Api` interface and the namespace object, matching the shape already present on
`ControlTransportRpcApi`.

---

## LOW (Round 2)

### 16. Zero tests for `controlTransport` and `logTransport` public namespaces — `src/controlTransport.ts`, `src/logTransport.ts`

`test/log-transport-rpc.test.ts` covers the underlying `LogTransportRpc` module but not
the new `logTransport` wrapper. `controlTransport` has no test coverage at all. The
deleted log-stream tests (`control-plane-fetch.test.ts`, `control-service-contract.test.ts`)
covered the removed HTTP surface but have no replacement for the new WebSocket path. If
the `Layer.effect(ControlTransportServer, ...)` wiring in `controlTransport.serverLayer`
is wrong, it will not surface until integration.

**Fix:** Add at least one round-trip test for each new namespace — `serverLayer` +
`clientLayer` composed against an in-memory `RpcServer.Protocol` — matching the pattern
in `test/control-transport-rpc.test.ts`.

---

## Note — intentional asymmetry (not a bug)

`logTransport.serverLayer` returns `Layer<never, never, RpcServer.Protocol | ProcessManagerLogRelay>`
while `controlTransport.serverLayer` returns `Layer<ControlTransportServer, never, RpcServer.Protocol>`.
This is correct: no `LogTransportServer` context tag exists because the log server is
purely side-effect-driven (handlers are registered on the protocol; no downstream Effect
service consumes the server handle). The asymmetry should be documented on `LogTransportApi`
to prevent future maintainers from treating it as a bug.
