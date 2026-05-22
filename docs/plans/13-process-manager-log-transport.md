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

**CLI mapping (live vs storage):**

| Mode | Flags | Behavior |
| ---- | ----- | -------- |
| **Default (live)** | `group-logs <group>` (no storage flags) | Always attach live transport. Print relay **snapshot prelude** (bounded, see below), then stream new entries until interrupt. |
| **Storage export** | **Requires** `--from` + `--to` ISO range (or `--since` duration) | Query `ProcessStore` only; print matching rows and **exit** — no infinite scroll, no implicit follow. |
| **Storage + live** | explicit range **and** live default (future) | Optional: print storage window first, then prelude + live (dedupe by `entryId`). |

- `--lines` / `-n` (default **100**) — cap relay snapshot prelude lines before live tail (fits terminal without bloat; not storage).
- `--snapshot` — relay prelude only, then exit (debug/CI); no live tail.
- Storage cursors (`--after` / `--before` / `entryId`) — advanced; still subordinate to **required date range** when reading storage.

**Dedup rule:** When merging storage stream + live stream, drop any live entry with `entryId <= lastIdFromStorage`.

### Operator CLI UX (product — agreed)

1. **Default is always live** — `pm group-logs my-group` ≡ follow live logs. Storage is never queried unless the operator passes an explicit **time range**.
2. **Prelude without bloat** — Before live tail: replay relay snapshot up to `--lines` (default 100, max 500 = relay capacity). No “load everything from DB” on default path.
3. **Storage requires a window** — e.g. `--from 2026-05-22T19:00:00Z --to 2026-05-22T20:00:00Z` (both required). Optional `--limit` caps rows. Rejects open-ended storage reads at CLI parse time.
4. **Interactive follow (live)** — While following live logs in a TTY, single-key commands (see Slice 7). Implemented for live path; storage history interactive deferred until `--from` / `--to` exists.

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

- `logs:` config on endpoint items; **default operator path** = live transport only (relay prelude + follow).
- Storage + PubNub configured on endpoint; CLI chooses mode via flags, not implicit composite backfill.
- Document in [07](./07-process-manager.md) and guides.

**Exit:** select transport without forking `ProcessManager.cli` internals.

### Slice 6 (optional) — Faithful replay timestamps

- `--preserve-timestamps` on `group-logs` / replay path.

### Slice 7 — Interactive log session (TTY, live)

When stdin is a TTY (use `--no-interactive` to disable), attach a minimal log **session** on top of live follow:

| Input | Action |
| ----- | ------ |
| `q` / Ctrl+C | Quit session, drain fibers |
| `f` | Freeze/unfreeze live output |
| `:` then `history` | Prompt for `--from` / `--to`, fetch storage window, print, resume live |
| `:` then `help` | List commands |
| `?` | Same as help |

Implementation sketch: raw mode + line buffer; live `Stream` into session mailbox; commands run as short `Effect` interrupts (reuse `ProcessManager` remote controls where useful, e.g. `:` `status <process>` later). Keep v1 command set tiny to avoid CLI bloat.

**Non-goal for Slice 7:** full shell, infinite scroll, or mouse support.

## CLI / operator UX (target)

```bash
# Default: prelude (100 lines) + live follow until Ctrl+C
pm group-logs my-group

# Shorter prelude
pm group-logs my-group --lines 20

# Snapshot only, no live
pm group-logs my-group --snapshot

# Storage export (range required) — no live
pm group-logs my-group --from 2026-05-22T19:00:00Z --to 2026-05-22T20:00:00Z

# Disable TTY keys (e.g. piping)
pm group-logs my-group --no-interactive
```

## Remaining open questions (for `/grill-me`)

- `entryId` format: uint64 sequence vs ULID (sortable, multi-instance safe).
- Interactive: default-on-TTY vs `--interactive` only.
- No `--follow` flag on CLI (live is default; `--snapshot` for prelude-only).
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

When resuming implementation, run `/grill-me` starting from **Slice 1** unless storage ([11](./11-runtime-state-hooks-and-config.md)) blockers force Slice 2 first.

**Resolved:** default = live + bounded relay prelude; storage = explicit `--from`/`--to` only.

**Next grill branch:** interactive session scope (Slice 7) vs defer until after PubNub.
