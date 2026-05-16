# Schedule gates vs `ProcessGroup` lifecycle

This page answers **how `ProcessSchedule` interacts with `ProcessGroup`**, what **starts** when, and how to mutate schedule entries from **outside** the process (e.g. an HTTP API that knows when a game is live).

For API tables, see [PROCESS-API.md](./PROCESS-API.md). For runtime semantics, see `src/Process.ts` TSDoc and this page.

---

## Does the schedule “auto-start” when the group is created?

**No.** `yield* ProcessGroup.make({ … })` only **registers** processes and queues and returns a **`ProcessGroup`** handle. Each process’s status starts as **`stopped`**.

The **`ProcessSchedule`** service layer attached to **`Process.make`** is **merged into `process.effect`**. That effect is a **long-running schedule driver**. Nothing runs that driver until you:

- **`yield* group.start(name)`**, or  
- **`yield* group.startAll()`**

At **`start`**, the group **`forkIn`s `process.effect` into a dedicated scope** (see `src/ProcessGroup.ts`). From that moment:

- The **schedule-driver fiber** is alive.
- Any inlined schedule/polling resources are started together in the same merged `Effect` / `Layer` tree.

So: **schedule logic runs as part of the started process**, not when the group is merely constructed.

---

## Disarm vs `stop` (still “running” in the group?)

| Action | Driver fiber | Active instances |
|--------|--------------|------------------|
| **No active schedule entries** (for example after `schedule.clear`) | **Still running** | Existing instances exit naturally once their current entry closes |
| **`stop(name)`** | **Interrupted** — scope closed, lifecycle **Stopped** | Ended (driver + child fibers interrupted) |

So **`start` ≠ “game is on”**. It means **“attach the schedule driver”**. Whether work runs is controlled by current schedule entries (`startAt` / `stopAt`).

---

## Can we set / change the schedule **outside** the process?

**Meaningfully, yes — but not by swapping the `Layer` on a live `Process` handle.**

`Process.make` **bakes** `polling` / `schedule` **layers into `process.effect`**. There is no API to replace that layer on an already-built `Process` without building a **new** `Process` (or **`restart`**, which stops and starts again with the **same** config object the group already holds).

What you **can** do (recommended pattern):

1. Use an in-memory schedule service (`ProcessSchedule.inMemory`, `ProcessSchedule.empty`, or a schedule initializer) via `Process.make(id, { schedule: ... })`. Omitting `schedule` defaults to `ProcessSchedule.alwaysArmed`; use `ProcessSchedule.empty` when the driver should run but stay disarmed until you mutate entries.
2. A **separate fiber** (or HTTP handler) polls your game API and mutates entries with `set` / `add` / `clear`.
3. Each running instance checks its own `stopAt`; when windows close, instances exit naturally. The driver remains attached and future entries can spawn new instances.

If you need a completely different schedule policy implementation, create a new process config/layer and restart with that configuration.

---

## Will ticks **actually** start when the schedule says the game is on?

**Yes**, once:

1. **`group.start(name)`** has been called (driver running), and
2. There is at least one active schedule entry for the current wall-clock time.

Then spawned instances run **`Polling.awaitNextTick` → user `effect` → `Polling.afterTick`** while their entry window remains open.

When the game ends and your updater clears/closes entries, running instances exit naturally at their next stop check.

When you want the **fiber gone** (scale to zero, deploy teardown), call **`stop`**.

---

## Pattern: API game schedule → arm while live → disarm when over → optional stop

1. Start with no entries (pre-game = no active window).
2. **`Process.make`** with **`schedule`** initializer or `ProcessSchedule.inMemory(...)` and **`polling: Polling.spaced(…)`**.
3. **`ProcessGroup.make({ queues: [], processes: [proc] })`** (empty `queues` is allowed — see `test/process-group.test.ts`).  
4. **`yield* group.start(proc.name)`** — schedule driver starts.
5. **Fork** `Effect.gen` that simulates (or performs) **`HttpClient.get`**, then updates entries (for example `set([ProcessSchedule.window("match-101", kickoff, finalWhistle)])`).
6. Under **`TestClock`**, **`TestClock.adjust`** so sleeps complete.  
7. Inspect tick counter / logs; then **`yield* group.stop(proc.name)`** if you want the process **removed** from the running set, not merely unscheduled.

Runnable script: **`examples/scenarios/game-window-polling-with-process-group.ts`**.

---

## Relation to “ProcessManager”

`ProcessManager` currently connects to one `ProcessGroup` control endpoint at a
time, verifies the group contract, and exposes typed remote process/queue
controls. `ProcessGroup.remoteLayer(Group, Endpoint)` can provide the same
injectable group service key from a remote endpoint, so application code can
`yield* Group` whether the provider is local or network-backed.

Remote queue `pause`, `resume`, `clear`, and `status` are supported. Remote
queue enqueue-style controls intentionally fail with `UnsupportedRemoteControlError`
until schema-backed queue item contracts land. Multi-host deployment
coordination remains future work.
