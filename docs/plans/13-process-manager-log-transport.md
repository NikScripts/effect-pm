# 13 - ProcessManager log transport (PubNub + storage history)

## Status

Future work. The **structured log relay** slice (capture → `ProcessManagerLogEntry` → in-process relay → localhost `GET /logs/stream` NDJSON → operator `replayLogEntry`) is the transport-agnostic core. This plan adds **pluggable egress/ingress** and **durable history** so operators are not limited to the child’s in-memory tail or a single HTTP pull.

Implemented relay behavior belongs in regular docs (`docs/guides/process-manager-endpoints.md`, source TSDoc). This file is roadmap only.

## Intent

1. **Protocol-agnostic payload** — Keep `ProcessManagerLogEntry` + schema/NDJSON as the wire message; transports are interchangeable.
2. **Log transport abstraction** — Mirror `ControlTransportClient` / `ControlTransportServer`: a small port for `subscribe(group, cursor?) → Stream<ProcessManagerLogEntry>` (operator) and optional `publish` (child egress).
3. **PubNub** — First remote/live fan-out transport when the operator is not localhost-adjacent to the child.
4. **Storage-backed history** — Optional persistence so the operator can request entries **older than their current cursor** (timestamp- or id-based), not only the relay’s bounded memory snapshot.

## Relationship to other plans

| Plan | Role |
| ---- | ---- |
| [07](./07-process-manager.md) | Endpoint config, `group-logs`, multi-host PM; item 9 becomes “log transport adapters” (see below). |
| [01](./01-process-store-service.md) / [10](./10-process-store-phase-one.md) / [11](./11-runtime-state-hooks-and-config.md) | Durable append + query primitives for log rows (facts or dedicated log table). |
| [05](./05-control-service-v2.md) | Separate concern: ProcessStore **lifecycle** SSE; do not conflate with group **application** logs. |

## Core decisions

1. **Capture stays in the child** — `captureLoggerLayer` → `ProcessManagerLogRelay.publish` does not change per transport.
2. **Egress and ingress are adapters** — HTTP `/logs/stream` becomes `LogTransportHttp`; PubNub and storage are additional adapters, not forks of replay logic.
3. **Replay stays on the operator** — `streamGroupLogs` / `replayLogEntry` / `operatorLoggerLayer` consume `Stream<ProcessManagerLogEntry>` regardless of source.
4. **History uses stored `date` (ISO)** — Operator passes a cursor (`after` timestamp or monotonic entry id); storage returns rows strictly older than live tail or merges `history ++ live` without duplicates.
5. **Endpoint config owns transport choice** — Sibling to control `transport: http(...)`, e.g. `logs: { transport: "http" | "pubnub" | "storage" | composite }` on group endpoint items (see [07](./07-process-manager.md) “log transport config”).

## Architecture

```text
Child                          Operator
─────                          ────────
Effect.log
  → captureLogger
  → ProcessManagerLogEntry
  → relay.publish ──┬──► LogTransport egress (HTTP / PubNub / …)
                    └──► LogStorage.append (optional, async)

Operator group-logs:
  cursor? ──► LogStorage.query(groupId, after: cursor)  // older than what UI already has
           ++ LogTransport.subscribe(follow)             // live tail
           → decode → replayLogEntry → operatorLoggerLayer
```

**PubNub (live / multi-subscriber)**

- Child: fork publisher on `relay.stream` (or hook `publish`); message body = one NDJSON line per `ProcessManagerLogEntry`.
- Channel naming: configurable per group/endpoint (e.g. `effect-pm.logs.{groupId}`).
- Operator: subscribe → `Stream.mapEffect(decodeProcessManagerLogEntryNdjson)` → existing replay path.
- Auth: PubNub keys + channel ACLs replace “localhost only” for log **viewers**; control plane may still be HTTP-local until broader auth lands.

**Storage (history / catch-up)**

- Child (or relay hook): append each entry to `ProcessStore` / `RuntimeStorage` (or dedicated `GroupLogStore`) with indexed `(groupId, date, entryId?)`.
- Operator: if client already has entries up to `T`, query `WHERE groupId = ? AND date > ? ORDER BY date` (or `entryId > cursor`) for **backfill**, then attach live transport from `T` (or “now”) forward.
- Replaces reliance on relay’s fixed **500-entry** memory snapshot for late joiners and reconnects.
- Retention/TTL: policy per deployment (not fixed in v1 plan).

## Implementation slices

### Slice 1 — Log transport port + HTTP adapter

- Introduce `LogTransport` (names TBD) client/server shapes analogous to [ControlProtocol](./ControlProtocol.ts) transports.
- Move current `ControlTransportHttp` `/logs/stream` behavior behind `LogTransportHttp`.
- `groupLogEntryStream` depends on `LogTransportClient`, not raw `HttpClient.get`.

### Slice 2 — Storage append + cursor query

- Define persisted row shape (= `ProcessManagerLogEntry` + `groupId` + optional `entryId`).
- Append on child `publish` (batched Effect, failure must not break capture).
- Operator API: `after?: string` (ISO timestamp) or `afterId?: string` on `group-logs` / `groupLogEntryStream`.
- Query implementation via existing storage adapters (memory, file, SQLite, Prisma) from [01](./01-process-store-service.md) / [11](./11-runtime-state-hooks-and-config.md).

### Slice 3 — PubNub adapter

- `LogTransportPubNub` config: subscribe/publish keys, channel template, optional presence.
- Child layer: publisher fiber + graceful shutdown on group stop.
- Operator: subscribe stream; optional “no storage” mode for pure live fan-out.
- Tests: mock PubNub client; no network in CI.

### Slice 4 — Endpoint config + composite mode

- Group endpoint config: `logs: { transport, ... }` per [07](./07-process-manager.md).
- **Composite** (recommended default when storage enabled): `storage.query(after)` then `pubnub|http.subscribe` for live — same operator UX as “give me what I’m missing, then follow.”

## CLI / operator UX (target)

```bash
# Live only (today’s behavior, any transport)
pm group-logs my-group --follow

# Backfill from DB then follow (storage + live)
pm group-logs my-group --after 2026-05-22T20:00:00.000Z --follow

# History only (no follow)
pm group-logs my-group --after 2026-05-22T19:00:00.000Z --until 2026-05-22T20:00:00.000Z
```

Exact flags are design details; the invariant is **cursor + storage query + optional live transport**.

## Open questions

- Dedicated `GroupLogStore` vs reusing `ProcessStore.events` / `runtime.fact` — prefer one append API and a typed projection read (align with [11](./11-runtime-state-hooks-and-config.md)).
- Whether `entry.date` in replay should use stored timestamp for faithful UIs (today replay uses “now”).
- PubNub Message Persistence vs our DB for history — use our storage for authoritative backfill; PubNub for fan-out only unless product requires otherwise.
- Write amplification: sync append per log line vs batch flush interval.

## Non-goals

- Replacing ProcessStore lifecycle event streaming ([05](./05-control-service-v2.md)).
- File-based stdout/stderr tailing (superseded by structured capture).
- Authentication design for remote control (track separately; PubNub ACLs are log-viewer scoped only).

## Graduation criteria

- `LogTransport` port documented and exported; HTTP implementation passes existing `group-logs` tests.
- Storage adapter proves `after` cursor backfill across at least two storage backends.
- PubNub adapter documented with example config; operator replay path unchanged.
- Endpoint config selects transport without forking `ProcessManager.cli` per transport.
- Implemented sections move to `docs/guides/` and shrink this plan to residual future items.
