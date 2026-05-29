# 03 — Queue: unified surfaces, schemas, remote enqueue & handoff

Unify queue operations around **queue-bound controls** exported from
**`QueueResource.Service`**, tighten **enqueue** typings (`itemSchema` +
validation errors), align **`ProcessGroup`** queue controls with **`QueueHandle`**.

## Depends on / coordinates with

- [STORAGE.md](../STORAGE.md) — **`QueueResourceStore`** for concrete wire
  events once shapes stabilize.
- [01-remote-cli-transport-wire.md](./01-remote-cli-transport-wire.md) for the
  actual remote wire once schemas exist.

## Rough sequencing

1. **Single conceptual control surface** — derived views for handlers, hooks,
   and lifecycle (**`persist`/`refill` migration** toward facet + lifecycle).
2. **Enqueue input** — single item / readonly array overloads; batch error
   channels honest vs **`EEnqueue`**.
3. **`itemSchema` + codecs on group contract** for remote honesty.
4. **Release/handoff envelopes** (`release`, `enqueueReleased`, …).
5. **`remoteLayer` queue methods** that today fail **`UnsupportedRemoteControlError`**.
6. **HTTP/RPC enqueue routes** aligned with **`ControlProtocol`**.
