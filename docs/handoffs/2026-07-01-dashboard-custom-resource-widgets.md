# Request: dashboard widgets for **custom** resources (`@nikscripts/effect-pm/web`)

**From:** wow-sports services-hub (source: `wow-sports/apps/services-hub/docs/MONITORABLE-RESOURCES-PLAN.md`).

> **Ask #1 (widget plug-in seam)** moved to the priority queue: [`open-asks.md`](./open-asks.md) §1.

Remaining ask below — still being walked with the owner.

---

## Ask 2 — shared spec for monitored dependencies (softer)

`Database` / `Import` / `EventManager` share the `status` + `changes` + control + readiness shape. If, after building the first by hand, the shape repeats, a small **spec factory (plus its readiness derivation)** — reused across tags and applied through the normal `Resource.Tag(id, spec, { host }).pipe(withReadiness(…))` — is worth landing upstream; it benefits any consumer surfacing a dependency. **Not** a new base kind (`QueueResource` / `ApiMetrics` are specialized *shapes*, not service-ness layered on `Resource`).

Straightforward helper to write **once wow has built one league's `Database` by hand** and confirmed the shape repeats — don't pre-abstract. Not a blocker (the generic card renders today).
