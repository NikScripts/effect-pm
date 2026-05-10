# 08 — Top-level ProcessManager (deferred)

## Intent

A **future** service (name: **ProcessManager**) that:

- Owns **many** `ProcessGroup` instances (different hosts, tenants, or isolation boundaries).
- Exposes coordination via **Effect RPC** and/or **Effect HTTP** (not the localhost-only `ControlService` on a single group).
- Handles discovery, health, and aggregate control — **not** the same as today’s in-process orchestrator (that is **ProcessGroup**).

## Status

**Not implemented.** No API in this package yet. Do not use `ProcessManager.make` for the current orchestrator — use **`ProcessGroup.make`**.

## When picking this up

- Define transport (RPC schema, auth, versioning).
- Keep **ProcessGroup** unchanged as the embeddable unit; ProcessManager composes groups, not replaces them.
