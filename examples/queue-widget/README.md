# Queue widget prototype

A dashboard is **widgets**. A queue widget renders a queue's live stats +
controls; you build its atoms from the queue tag and **provide the right layer**.
Built entirely on **Effect 4's native reactive layer** (`effect/unstable/reactivity`)
— no external `@effect-atom`, no duplicate `effect`.

```sh
pnpm run example:queue-widget   # → http://localhost:5174
```

A **real `WorkPool` runs client-side** (no server, no RPC, no mock) — "Effect
PM runs on the client." Everything the queue service exposes is driven from the
browser:

- **Enqueue** — text box + **priority** (high / normal / low → `add` /
  `prioritize` / `defer`), Enter or **Add**;
- **Controls** — **Start** (`start`, fork workers), **Resume** (`resume`),
  **Pause** (`pause`), **Clear** (`clear`), **Release** (`release`, export +
  remove pending), **Shutdown** (`shutdown`, permanent), **↻** (manual refresh);
- **Route** — a "target by text" box → **Drop** (`drop`) / **Dead-letter**
  (`deadLetter`): remove/route the pending entries whose item matches. No "list
  pending" read is needed (Effect queues can't enumerate) — you target what you
  know, the queue matches internally;
- **Reads** — `size` (pending), per-priority `sizes`, `completed`, `isEmpty`,
  plus the `clear` / `release` / `drop` / `deadLetter` return counts;
- a **status** badge (running / paused / shutdown) — tracked client-side for now
  (the handle has no status read yet).

Live counts: the worker (concurrency 1, 1.2 s/item) invalidates the reactivity
key on each completion, so they move as items drain — event-driven, **no polling**.

So every `QueueHandle` method is now driven from the browser. The one genuine gap
is a real **status** read; that's for the resource rewrite.

The queue **starts paused**, so add a few items first and watch `pending` climb,
then press **Start** to drain them (an auto-started queue would grab each item
immediately and `pending` would never rise above 0).

## How it's wired

```ts
const runtime = Atom.runtime(DemoQueue.layer);     // native AtomRuntime from the layer
const atoms   = makeQueueAtoms(runtime, DemoQueue); // reads + mutations, keyed for refresh
```

```tsx
<RegistryProvider>
  <QueueWidget stats={…} onPause={…} … />          // dumb presentation
</RegistryProvider>
```

| File | Role |
|------|------|
| `atom-react.tsx` | The whole "atom-react" surface over the native registry: `RegistryProvider`, `useAtomValue` (`useSyncExternalStore` over `registry.subscribe`/`get`), `useAtomSet`, `useAtomRefresh`. ~70 lines, zero deps. |
| `queue-atoms.ts` | `makeQueueAtoms(runtime, tag)` → `{ stats, pause, resume, clear }`. `stats` is a `runtime.atom` read; mutations are `runtime.fn` with `reactivityKeys`, so a command refreshes the read (`Atom.withReactivity`). |
| `QueueWidget.tsx` | Pure presentation — stats + callbacks, no atom/Effect coupling. |
| `demo.tsx` | Real `DemoQueue` + `Atom.runtime(DemoQueue.layer)` + the connected component. |
| `main.tsx`, `index.html`, `vite.config.ts` | Run harness. |

## Live data: refresh now, stream next

The queue currently exposes one-shot Effect reads, so `stats` **refreshes on every
mutation** via `Reactivity` keys — event-driven, **never polled**. When the handle
gains `changes: Stream<Snapshot>`, `stats` becomes `runtime.atom(handle.changes)` —
fully live (incl. background worker progress) with **zero** refresh wiring. One line.

## Where RPC plugs in (out of scope)

The only seam is the layer in `Atom.runtime(layer)`. Today `DemoQueue.layer` (a real
local queue). For a server-backed queue: an **RPC-backed client layer** for the same
tag — built from `Hyperlink.Tag`'s contract via `effect/unstable/reactivity/AtomRpc`.
The widget and atoms don't change.

## Next slices

- `handle.changes` snapshot stream → swap `stats` to a stream atom (true live).
- Server components (RSC) via `effect/unstable/reactivity/Hydration` — render the
  shell, hydrate to live atoms on the client.
- More widget types (process, run resource) — same shape: build atoms from a tag.
