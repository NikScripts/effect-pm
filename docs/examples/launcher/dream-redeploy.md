{#launcher-dream-redeploy title="Launcher — dream redeploy (Shape β forward + activate)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-dream-redeploy>.
<!-- docs-site-link:end -->
# Launcher — dream redeploy (Shape β)

{.draft}
**Draft** — stable public Http + Unix A/B backends + `Node.activate`. File-swap
proves the OS loaded v2. Update.plan / dual-port cutover is **not** this recipe
(Update API parked). Address dock:
[`node-addresses-and-update-api.md`](../../handoffs/node-addresses-and-update-api.md).

**Sources (all below):**

| File | Role |
|------|------|
| [`dream-redeploy-shared.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-shared.ts) | Tags + `makeDreamNodes` (public / private) |
| [`dream-redeploy.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy.ts) | Edge + orchestrator |
| [`dream-redeploy-worker.v1.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-worker.v1.ts) | Backend tip `"v1"` |
| [`dream-redeploy-worker.v2.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-worker.v2.ts) | Backend tip `"v2"` |

**Run:** `pnpm run example:launcher-dream-redeploy`  
**Suite:** `test/launcher-dream-redeploy.test.ts`  
**Hub:** [Examples → launcher](/docs/examples#launcher)  
**Smaller in-process twin:** [forward-proxy](/docs/node-forward-proxy)

> [!NOTE]
> **Related:** [Update guide](/docs/update) (parked for β) · [addresses dock](../../handoffs/node-addresses-and-update-api.md) · [Launcher](/docs/launcher)

## What this shows

```
clients ──Http──►  edge (Node.forwardAll, stable Worker)
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
       A (Unix, v1)            B (Unix, v2)
```

1. Copy v1 onto `dream-redeploy-worker.active.ts`
2. Edge in the orchestrator binds public Http; `Node.forwardAll` → Active label
3. `Launcher.up(A)` loads active (v1) on Unix A
4. Public client → tip `"v1"` (stable dial)
5. Enqueue WorkPool jobs via public `Worker`
6. File-swap active → v2; `Launcher.up(B)` loads v2 on Unix B
7. Move pending A→B over direct Unix (**interim** — Directory is one row; S14 later)
8. `Node.activate(WorkerPrivate, "B")` → tip `"v2"`; public dial never rebinds
9. Release exact payloads via public `Worker`

Public clients use `LookupPolicy.verifyOff` until stream/ref forward + verify are Eng’d.

Fence bodies use `// @noErrors` for the docs Twoslash host (`process` / NodeRuntime).

## 1. Shared — public / private identity

{.twoslash include="examples/launcher/dream-redeploy-shared.ts"}
``` ts
// @noErrors
```

## 2. Orchestrator — edge + activate

{.twoslash include="examples/launcher/dream-redeploy.ts"}
``` ts
// @noErrors
```

## 3. Worker v1 — Unix backend (tip `"v1"`)

Copied onto the active path before `up(A)`.

{.twoslash include="examples/launcher/dream-redeploy-worker.v1.ts"}
``` ts
// @noErrors
```

## 4. Worker v2 — Unix backend (tip `"v2"`)

Copied onto the same active path before `up(B)` — proves the OS loaded the new file.

{.twoslash include="examples/launcher/dream-redeploy-worker.v2.ts"}
``` ts
// @noErrors
```
