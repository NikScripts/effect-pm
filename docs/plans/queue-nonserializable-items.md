# TODO (low priority): non-serializable queue items → local-only, persistence-off

**Status:** open, not started. **Priority: low** (nice-to-have; no consumer blocked).

## The gap
Queue items today are effectively serializable-or-nothing. There are two config variants —
`QueueResourceConfigWithItemSchema` (has `itemSchema`, persistable + wire-able) and
`...WithoutItemSchema` (`itemSchema?: undefined`) — but the "without" path isn't a first-class
**"items are non-serializable (functions, `Effect`s, class instances) — run local, no persistence"**
feature. And there are **no tests** for a queue whose item type is non-serializable (only
`test/resource.test-d.ts` touches the type level; 17 tests reference `itemSchema`, none for
function/Effect items).

## The feature
Make "non-serializable items" a simple, safe, explicit mode:

- When there's **no `itemSchema`** (or an explicit `nonSerializable: true`), the item type `T` may be
  anything — including functions and `Effect`s.
- **Enqueue + entry-related methods become `local`-only** (they carry `T`, which can't cross the wire) —
  so calling them through a `Hyperlink.client` is a compile error, not a runtime blow-up. Reuse the
  existing `local` capability mechanism (the same one that gates local-only resource methods).
- **Persistence is disabled** for that queue (no codec → no `persist`), enforced at the type level so
  you can't pair `persist` with a non-serializable item type.
- **Everything else still works over the wire**: `status` / lifecycle (`start`/`pause`/…) / `metrics` /
  `events` / `logs` — the worker runs locally, the control + observability surface stays served. So a
  non-serializable queue is safe to `serve` / `httpServer` alongside serializable ones; only its item-carrying
  methods are local.

Net: a local, in-memory queue that processes `Effect`/function items, fully observable + controllable
remotely, just not enqueue-able remotely.

## Notes / when picked up
- This pairs naturally with the **service-shape `local` shape** work (the shape rename slice) — the
  entry methods become `local`-shaped when `T` is non-serializable.
- Add tests: enqueue a function item + an `Effect` item, process locally (storage off), assert the worker
  ran; assert `client(tag)` can read `status`/`metrics` but `enqueue` is a compile error (type-level test).
- Verify `persist` + non-serializable is a **type error**, not a runtime surprise.
