# Proposal: reactive observation (stream-to-observe folds)

**Status:** proposal for review. **No code written.** Requires owner sign-off **and** coordination
with the `Resource.ts` `peers`/`fleet` surface (Agent E's adjacent zone) before any implementation.
**Principle:** *observe by subscribing, not by asking on a timer.* Every observable resource value —
including cross-node `fleet` folds — should be a **stream the dashboard rides**, not an `effect` the
dashboard polls.

---

## Problem

The resource contracts are observed in two incompatible ways:

- **Reactive (good).** queue / process / run expose `status` as a `ref` / `Subscribable`; the
  dashboard rides `.changes` (`src/web/data.ts`). Live, event-exact, no timer.
- **Poll (the gap).** The mesh factories — **FleetHealth**, **Telemetry**, **ShardMap** — expose
  their observable and `fleet`-folded fields as `Resource.effect` (one-shot). There is nothing to
  subscribe to, so the dashboard polls every 2 s via `pollAtom`.

`fleet` folds are the crux. A fold today is `combineQuery(peers, (p) => p.field, combine)` — it
recomputes the aggregate by **fanning out to every peer on each read**. Driven by a poll that is
**N-peer work every tick, per fold, forever** — O(N²) across a fleet — *even when nothing changed*.

Consequences already visible in the shipped dashboard:

- **Missed transitions.** A value that spikes and clears faster than the poll interval is invisible.
  For a monitoring tool, dropping events is a correctness defect, not a cosmetic lag.
- **Two code paths + a felt seam.** `pollAtom` vs stream-atoms is a maintenance tax with two failure
  modes, and users feel it ("why is *this* card laggy?").
- **A hard scaling ceiling.** Fine at the 3-node fixture; a real fleet melts under N² poll-folds.

## The model

Move folds — and the observable locals they read — from *query* to *stream*:

1. **A reactive fold primitive.** Alongside `combineQuery`, add `combineStream(peers, (p) =>
   p.field.changes, combine)` that maintains the fold as a `SubscriptionRef` and re-emits when **any**
   input emits. `fleet` fields become `ref` / `stream`, not `effect`.
2. **Reactive locals.** A fold is only as live as its inputs, so the folded locals become reactive:
   ShardMap `sizeLocal` bumps on put/delete; FleetHealth `local` / `status` bump on readiness change;
   Telemetry already ships `live: stream(MetricsSnapshot)`. (The one-shot `effect` snapshots can stay
   for non-observing callers.)
3. **Peer streaming — the gating unknown.** Reactive folds require the **server↔server peer transport
   to carry `.changes` subscriptions**, not just request/response queries. The `peers` mechanism is
   query-oriented today. This is the single piece that **must be designed with the owner and the
   `Resource.ts` peers/transport owner (Agent E)** — it is shared foundation and overlaps the
   in-flight transport rework (topology / connect / protocol).
4. **The dashboard unifies on streams.** `pollAtom` is deleted; every bundle field becomes `.changes`.
   One model, one failure mode.

## Wins

- **No missed events.** Streams capture every transition; a poll samples and drops the rest. This is
  the core value of an observability surface.
- **It is the only thing that scales.** Push-on-change is flat traffic; the current fold-poll is
  N-peer fan-out per tick that grows super-linearly with the fleet. This is the difference between a
  dashboard that runs a real fleet and one that overloads it.
- **One model, not two.** Collapsing `pollAtom`, the intervals, and the "is this live?" ambiguity is
  SSOT for how observation works — one code path, one set of semantics.
- **It unlocks the roadmap.** Live sparklines (the NodeStatus health sparkline already hand-accumulates
  from a stream — generalizes for free), threshold alerting, and degrade-flash UI are natural on
  streams and awkward-to-wrong on samples. This is the observability-tap direction.

## Why now, not later

- **Every `effect` fold added now is migration debt.** ShardMap / FleetHealth / Telemetry folds just
  landed as poll-based. The surface is at its **smallest and cheapest to convert** it will ever be — a
  handful of fields, before consumers bind to the shapes.
- **The shapes are about to calcify.** It is beta, breaking is still cheap, few consumers. Once the
  wow-sports migration builds on `effect`-folds, `effect → stream` is a hard break. The window to make
  folds **reactive by default** is now.
- **The gating unknown aligns with work already in flight.** Whether peers can stream is a *transport*
  question — and the transport / protocol / connect layer is being actively reworked (Agent E,
  impossible-states + loud-failures). Deciding peer-streaming while that is moving lets us design it
  **in**, not retrofit streaming onto a frozen RPC peer model later.
- **The distributed machinery is hardening on poll assumptions.** Multi-host, `peers`, `distributed`
  are all recent. Every increment builds more atop query-folds; the longer we wait, the more there is
  to unwind.

## Cost & coordination (read before approving)

- **Cross-cutting.** The fold primitive + peer streaming live in `Resource.ts` (`peers` / `fleet` /
  `combineQuery`), which is adjacent to Agent E's **owner-reserved** node/client typing surface. The
  fold/peers surface must be coordinated with E even though it is not the exact reserved set.
- Plus a `ref`-ification of each engine's local state (ShardMap, FleetHealth, Telemetry).
- **Owner-gated.** This doc is the ask, not a PR. Nothing starts until S0 (below) is answered.

## Staged plan (once approved)

- **S0 — Spike the gating unknown.** Can a peer expose a `.changes` stream over the current peer
  transport? Prototype one reactive peer read. If not, *that* is the real project and must be scoped
  with E against the transport rework. Everything below assumes S0 is green.
- **S1 — Reactive-fold primitive** in the peers/fold surface (`combineStream`), behind the existing
  `fleet` marker so contracts opt in field-by-field. No contract changes yet.
- **S2 — One contract end to end (Telemetry).** Local ref (it already has `live`) → streaming fold →
  dashboard rides `.changes` → delete its poll. Proves the whole path on the easiest contract.
- **S3 — ShardMap + FleetHealth.** `ref`-ify `sizeLocal` / `local`; convert their folds.
- **S4 — Delete `pollAtom`.** Sweep the dashboard to streams; assert no poll remains.

## Decisions to lock (this doc's purpose)

1. **Peer `.changes` over the transport** — feasible on the current RPC peer model, or does it need
   transport work? *(owner + Agent E — the gating call.)*
2. **Reactive-fold primitive shape** — `combineStream` returning a `SubscriptionRef`? Initial-value and
   backpressure semantics?
3. **Which locals become `ref`** — and does the one-shot `effect` snapshot stay alongside for
   non-observing callers?
4. **Migration stance** — break `effect → stream` on the `fleet` fields now (beta, breaking OK), or add
   `xLive` reactive fields alongside the existing effect fields?

## Verification bar

- Dashboard has **zero `pollAtom`** usage; every mesh card rides `.changes`.
- A transient that spikes and clears faster than the old 2 s interval is **visible** in the UI.
- Fleet-fold network traffic is **flat when idle** (no per-tick peer fan-out).
- Full `tsc` + tests + per-example `tsc` green; mark-the-surface clean.
