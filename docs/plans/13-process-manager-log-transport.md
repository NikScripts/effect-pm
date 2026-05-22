# 13 - ProcessManager log transport (PubNub + storage history)

## Status

Future work. The **structured log relay** slice (capture → `ProcessManagerLogEntry` → in-process relay → localhost `GET /logs/stream` NDJSON → operator `replayLogEntry`) is the transport-agnostic core. This plan adds **pluggable egress/ingress** and **durable history** so operators are not limited to the child’s in-memory tail or a single HTTP pull.

Implemented relay behavior belongs in regular docs (`docs/guides/process-manager-endpoints.md`, source TSDoc). This file is roadmap only.

## Intent

1. **Protocol-agnostic payload** — Keep `ProcessManagerLogEntry` + schema/NDJSON as the wire message; transports are interchangeable.
2. **Log transport abstraction** — Mirror `ControlTransportClient` / `ControlTransportServer`: subscribe/publish ports for operator ingress and child egress.
3. **PubNub** — Remote/live fan-out when the operator is not localhost-adjacent to the child.
4. **Storage-backed history** — Durable append + cursor queries so the operator can load **what they do not already have** (catch-up forward or scroll-back older), without relying on the relay’s 500-entry memory buffer.

## Relationship to other plans

| Plan | Role |
| ---- | ---- |
| [07](./07-process-manager.md) | Endpoint config, `group-logs`, multi-host PM; item 9 → log transport adapters. |
| [01](./01-process-store-service.md) / [10](./10-process-store-phase-one.md) / [11](./11-runtime-state-hooks-and-config.md) | Append + `events(query)` for persisted log rows (no ad hoc DB API). |
| [05](./05-control-service-v2.md) | ProcessStore **lifecycle** SSE — separate from group **application** logs. |

## Resolved decisions (pre–grill-me baseline)

These are the default assumptions for implementation unless `/grill-me` changes them.

### Cursor model

| Cursor | Meaning | Storage predicate | Typical UX |
| ------ | ------- | ----------------- | ---------- |
| **`after`** (primary for reconnect) | Operator already has entries up to cursor; fetch the **next** rows | `entryId > after` (preferred) or `date > after` (ISO, exclusive) | Reconnect, gap fill, then `--follow` |
| **`before`** (primary for scroll-back) | Operator already has the **newest** tail; fetch **older** rows | `entryId < before` or `date < before` (exclusive) | Terminal/UI “load older logs” |
| **`until`** (optional bound) | Stop at this cursor when scanning history | paired with `after` or `before` | Bounded export / time window |

**Default cursor field:** monotonic **`entryId`** per `(groupId, endpointLabel, childGeneration)` — assigned at append time (uint64 or ULID). **`date`** remains on the payload for display and secondary indexes, not as the sole cursor (clock skew, duplicate ms).

**CLI mapping:**

- `--after <entryId|iso>` — catch-up forward (exclusive).
- `--before <entryId|iso>` — history backward (exclusive).
- `--follow` — after backfill slice completes, attach live `LogTransport` (HTTP or PubNub).
- If both `after` and `before` omitted and storage enabled: default to relay snapshot + live (today’s HTTP behavior) or “last N from storage” (TBD in grill).

**Dedup rule:** When merging storage stream + live stream, drop any live entry with `entryId <= lastIdFromStorage`.

### Storage placement

- **No separate `GroupLogStore` service** in v1. Append through **`ProcessStore`** (or `RuntimeStorage` port) as an analytics/event row:
  - Event type: `group.log.entry` (name TBD, stable string).
  - Payload: `ProcessManagerLogEntry` + `groupId` + `endpointLabel` + `entryId` + optional `childPid` / `runId`.
- Reads: **`ProcessStore.events(query)`** with filters on `groupId`, cursor, limit — same pattern as `runtime.fact.recorded` in [11](./11-runtime-state-hooks-and-config.md).
- Indexes: at minimum `(groupId, entryId)` and `(groupId, date)` on Prisma/SQLite adapters when added.

### PubNub vs storage

- **Storage = authoritative history** (backfill, audit, reconnect).
- **PubNub = live fan-out only** — message body is one NDJSON line; do not depend on PubNub Message Persistence for backfill in v1.
- **HTTP `/logs/stream`** remains valid localhost/dev transport behind `LogTransportHttp`.

### Append performance

- Child `publish` triggers **async batched append** (default: flush every **250ms** or **64 entries**, whichever first).
- Append failure: log metric + continue capture/relay (do not fail user `Effect.log`).

### Replay fidelity

- v1 operator replay keeps **“now”** timestamps (current `replayLogEntry` behavior).
- v2 (same plan, later slice): optional `--preserve-timestamps` replay using stored `entry.date` for faithful UIs.

### Endpoint config (shape sketch)

```typescript
// Sibling to control transport on endpoint config items
logs: {
  transport: "composite", // "http" | "pubnub" | "storage" | "composite"
  storage: { enabled: true }, // uses ProcessStore from child layer
  live: { _tag: "pubnub", channel: "effect-pm.logs.${groupId}", ... },
  // localhost dev: live: { _tag: "http" } // inherits control baseUrl
}
```

## Core decisions (unchanged)

1. **Capture stays in the child** — `captureLoggerLayer` → `ProcessManagerLogRelay.publish`.
2. **Egress and ingress are adapters** — HTTP, PubNub, storage query are interchangeable behind `LogTransport` / `LogHistory`.
3. **Replay stays on the operator** — `decode → replayLogEntry → operatorLoggerLayer`.

## Architecture

```text
Child
  Effect.log → captureLogger → ProcessManagerLogEntry (+ entryId at append)
    → relay.publish ──┬──► LogTransport egress (HTTP / PubNub)
                      └──► ProcessStore.append(group.log.entry)  [batched]

Operator group-logs
  optional LogHistory.query(groupId, after|before, limit)
  optional LogTransport.subscribe(follow)
  → merge/dedupe by entryId → decode → replayLogEntry
```

## Persisted row shape

```typescript
// Logical record (storage envelope + payload)
{
  readonly type: "group.log.entry";
  readonly groupId: string;
  readonly endpointLabel: string;
  readonly entryId: string; // monotonic per child run
  readonly childPid?: number;
  readonly entry: ProcessManagerLogEntry; // includes date ISO, level, message, ...
}
```

`entryId` is **not** on the wire NDJSON line unless we add it for PubNub/HTTP live messages too (recommended: include in encoded payload once storage lands so live and stored shapes match).

## Implementation slices (ordered)

### Slice 1 — Log transport port + HTTP adapter

- `LogTransportClient` / `LogTransportServer` (names TBD), analogous to control transport.
- Move `/logs/stream` to `LogTransportHttp`.
- `groupLogEntryStream` depends on `LogTransportClient`.

**Exit:** existing `group-logs` tests pass unchanged.

### Slice 2 — Storage append + cursor query

- Assign `entryId` at `relay.publish` (or append hook).
- Batched `ProcessStore` append on child.
- `LogHistory.query({ groupId, after?, before?, limit })` implemented via `events(query)`.
- CLI: `--after`, `--before`, optional `--limit`.

**Exit:** memory + file (or SQLite) adapter proves forward catch-up and backward scroll in tests.

### Slice 3 — Wire `entryId` on live transports

- Extend `ProcessManagerLogEntry` schema (or envelope) with `entryId` for NDJSON live lines.
- HTTP snapshot/stream and PubNub publish the same shape storage uses.

**Exit:** dedup between storage tail and live head is deterministic.

### Slice 4 — PubNub adapter

- `LogTransportPubNub` child publisher + operator subscriber.
- Mock client in tests; example config in playground.

**Exit:** operator replay path unchanged; multi-subscriber manual test documented.

### Slice 5 — Endpoint config + composite

- `logs:` config on endpoint items; composite = `history.query` then `live.subscribe`.
- Document in [07](./07-process-manager.md) and guides.

**Exit:** select transport without forking `ProcessManager.cli` internals.

### Slice 6 (optional) — Faithful replay timestamps

- `--preserve-timestamps` on `group-logs` / replay path.

## CLI / operator UX (target)

```bash
# Live only (today)
pm group-logs my-group --follow

# Reconnect: fill gap since last seen id, then follow
pm group-logs my-group --after 00000042 --follow

# Scroll back: older than oldest line in terminal
pm group-logs my-group --before 2026-05-22T20:00:00.000Z --limit 200

# Window
pm group-logs my-group --after 2026-05-22T19:00:00.000Z --before 2026-05-22T20:00:00.000Z
```

## Remaining open questions (for `/grill-me`)

- Default when no cursor: “relay snapshot only” vs “last N from storage” vs “storage tail + follow”.
- `entryId` format: uint64 sequence vs ULID (sortable, multi-instance safe).
- Retention/TTL and compaction (deployment policy vs library default).
- Whether HTTP live stream still sends pre-storage 500 snapshot when storage is enabled.
- Auth matrix when PubNub + remote control coexist.

## Non-goals

- ProcessStore lifecycle SSE ([05](./05-control-service-v2.md)).
- File-based stdout/stderr tailing.
- Full control-plane authentication (PubNub ACLs are log-viewer scoped only).

## Graduation criteria

- `LogTransport` port exported; HTTP adapter passes `group-logs` tests.
- Storage proves `after` and `before` on ≥2 backends.
- PubNub adapter + example config; replay path unchanged.
- Endpoint `logs:` config selects transport without CLI forks.
- Implemented behavior moves to `docs/guides/`; this plan keeps only residual future items.

## Grill-me entrypoint

When resuming implementation, run `/grill-me` starting from **Slice 1** unless storage ([11](./11-runtime-state-hooks-and-config.md)) blockers force Slice 2 first. First grill branch: confirm cursor defaults and `entryId` on wire vs storage-only.
