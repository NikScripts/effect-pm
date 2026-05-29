# 05 — ProcessManager log transport (pluggable egress + durable history)

Build on the **relay + NDJSON** surface already documented in **`docs/guides/`**.

## Goals

- **`LogTransportClient`/`Server`** (names TBD) mirroring **`ControlTransport*`** —
  **`ProcessManagerLogEntry`** stays the protocol payload.
- **Storage append + cursor query** (`after`/`before`) via **`LogStore`** /
  **`RuntimeStorage`** adapters.
- **Optional PubNub (or equivalent)** live fan-out; storage remains source of truth
  for backfill/reconnect.
- **Endpoint `logs:` config** composing composite transports without forks inside
  **`ProcessManager.cli`**.

Structured implementation slices remain: port + HTTP shim → batched **`recordBatch`**
→ wire **`entryId`** on live → PubNub → composite config → optional **`--preserve-timestamps`** → optional TTY session.
