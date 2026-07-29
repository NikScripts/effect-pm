{#workpool-priority-retry title="Queue — Priority, Dedup, Retry" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/workpool-priority-retry>.
<!-- docs-site-link:end -->
# Queue — Priority, Dedup, Retry

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/queue/workpool-priority-retry.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/queue/workpool-priority-retry.ts)  
**Run:** `pnpm run example:workpool-retry`  
**Hub:** [Examples → Queue](/docs/examples#queue)  
**Deep guide:** [Queues](/docs/work-pools)

## What this form shows

One `WorkPool` handle exercising four operators together:

1. **Lanes** — `add` (normal), `prioritize` (high), `defer` (low); each accepts a batch array
   (one RPC round-trip when remote).
2. **Dedup** — `key: (job) => job.id` skips a second enqueue of the same id **while that key
   is in flight** (not a permanent cache — the key frees when the attempt finishes, including
   before an auto re-enqueue).
3. **Retry budget** — `attempts: 2` means one automatic re-enqueue after failure, then
   `RetryExhausted`. No `onFailure` here → the default disposition (retry until budget, then
   dead-letter). Per-error routing belongs in `onFailure` on the [Queues](/docs/work-pools) guide.
4. **Lifecycle** — one `events` subscriber with `Hyperlink.runForEachTag` (pick the tags you
   care about; ignore the rest). Prefer this over old onExit-style hooks.

Surface is the tip **`Tag` + `layer`** split (contract vs runtime). Bootstrap: start
**`paused: true`**, wire the subscriber and enqueue, then **`resume`** so nothing drains
mid-setup.

`concurrency: 1` keeps drain order readable for the demo (high → normal → low). Raise it for
I/O-bound work; `rateLimit` is the separate start-rate ceiling (not shown here).

The worker failure is a **`Schema.TaggedErrorClass`** on the tag's `error` slot — yieldable
and wire-encodable. A bare `Schema.String` also works for local-only demos; use the schema
error class when the failure is part of the public contract.

## Expected run

Three jobs. Drain order with `concurrency: 1`: **password-reset** (high), **welcome**
(normal), **newsletter** (low). `welcome` fails on attempt 1 and succeeds on attempt 2; the
others succeed once.

`status.completed` counts **finished attempts** (success *or* failure each increment once) —
so expect **≈ 4**, then the queue is empty. That is not “unique jobs” and not “successful
sends only.” On the tip `Tag` handle there is no top-level `queue.completed`; read it from
`status` (same snapshot that carries `sizes` / `inFlight` / `phase`).

## The program

The fence below is the runnable file (Twoslash). Cuts in that `.ts` hide the module header;
imports are rewritten to `hyperlink-ts` for the page.

{.twoslash include="examples/forms/queue/workpool-priority-retry.ts"}
``` ts
```
