# Request: dashboard widgets for **custom** resources (`@nikscripts/effect-pm/web`)

**From:** wow-sports services-hub (source: `wow-sports/apps/services-hub/docs/MONITORABLE-RESOURCES-PLAN.md`).
**Status:** open. The prerequisite (a client for a hostless multi-host tag) shipped in **beta.17**
(`Resource.client(tag, host)`), so the dashboard path is unblocked; rich widgets are the remaining ask.

## The gap

wow models each monitored dependency — `Database`, `Import`, `EventManager` — as a first-class
`Resource.Tag` (a Resource *is* the monitor/control service; nothing to wrap). Each has a spec shape:
`status: query` + `changes: stream` + a few control `mutate`s + a status-derived readiness. In the
browser dashboard, a custom `Resource` with **no known `Resource.kindOf`** falls back to the **generic
status card** (status fields + streams). That works, but the rich, per-type widgets — a DB pool gauge, a
flush/throughput chart — don't exist for custom resources.

## The two asks

1. **Rich per-type widgets for custom resources**, either as a custom widget in the consumer's dashboard
   or **upstream in `@nikscripts/effect-pm/web`**. This is the natural extension of the existing per-type
   widget work (queue card, process card, ApiMetrics card) to consumer-defined resource shapes. The open
   question is the *seam*: how does `/web` pick a widget for a tag it doesn't statically know — by
   `kindOf`, by a spec-shape match, or by a consumer-registered widget map? (Generic introspection has
   been rejected before; this stays hand-crafted-per-type — the seam is how a consumer *plugs in* their
   type's widget.)

2. **A shared _spec_ for monitored dependencies** (softer, "possible contribution"). `Database` /
   `Import` / `EventManager` share the `status` + `changes` + control + readiness shape. If, after
   building the first by hand, the shape repeats, a small **spec factory (plus its readiness derivation)**
   — reused across tags and applied through the normal `Resource.Tag(id, spec, { host }).pipe(withReadiness(…))`
   — is worth landing upstream; it benefits any consumer surfacing a dependency. **Not** a new base kind
   (`QueueResource` / `ApiMetrics` are specialized *shapes*, not service-ness layered on `Resource`).

## Relation to existing work

- The per-type dashboard-widgets effort (queue done, process next; ServicesHub target) is the home for
  ask #1 — this extends it to *custom* tags with a plug-in seam.
- Ask #2 is a small library helper, independent of the dashboard.
- Prerequisite resolved: `Resource.client(tag, host)` (beta.17) — a hostless multi-host tag is now
  client-readable, so the dashboard can wire these resources at all.

## effect-pm assessment

Ask #1 needs a design pass on the **widget-selection seam** (the recurring "how does `/web` render a tag
it doesn't know" question) before code — hand-crafted widgets, consumer-registered, no generic
introspection. Ask #2 is a straightforward spec-factory helper to write **once wow has built one league's
`Database` by hand** and confirmed the shape repeats — don't pre-abstract. Neither is a blocker for wow
(the generic card renders today); both are polish/DX.
