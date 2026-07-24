# Inventory: `anyUnknownInErrorContext`

**Status:** rule is **`error`** in both typecheck tsconfigs. **Cleared** on tip (Agent 4) —
no channel casts, no rule disables except `serviceNotAsClass` at Service/Tag factories.

**Critique follow-through:** Gate / Daemon public `serve` / `serveRemote` no longer use `as any`;
memory aliases are identity; WorkPool.`serveRemote` uses a short factory-retype bridge (not nested
erase soup). `Hyperlink.serveRemote` keeps plain-impl `ServeRequirements` inference; Driver `R` is
retyped at toolkit call sites (open-`S` Driver overloads hit TS2589). Remaining honest erase:
`RpcGroup.toLayer` + wire `provideContext` inside Hyperlink, D1 server factories.

## Locked product invariant

**Every HyperService may have requirements** — including other HyperServices. Serve / listen /
`httpServer` / `wsServer` / `ipcServer` must **preserve `R`** (and `E`) from serve layers so callers
`Layer.provide` dependencies outside. Closing `R` at the server boundary is rejected.

**Typing approach (D1):** Effect-style open composition (like `Layer.mergeAll`), but **without**
writing `any`/`unknown` into expression-level `E`/`R`. Prefer:

- Constraints use **`Layer.Any`** / `ServeLayerList = readonly [Layer.Any, …]` — not
  `Layer.Layer<never, any, any>` (that alias still fires `anyUnknown` when used in `extends`)
- Public overloads: open `<A, E, R>` for a single serve, or `Serves extends ServeLayerList` with
  return `Layer.Success` / `Error` / `Services` extracted from the argument
- Overload **implementation** returns `Layer.Any` (structural; no Effect channels)
- Dynamic Effect/Rpc factories: **retype before call** via `retype<T>(value as never)` so the call
  site never sees `any`/`unknown` channels; `unwrap` takes `never` the same way
- Negative type tests: assert open `R` via `Layer.Services` / statement `@ts-expect-error` — do not
  call sinks that expect `R = never` on intentionally incomplete layers (trips `missingLayerContext`)
- **Forbidden:** `as any`, `as unknown as`, ErasedChannel=`unknown`, next-line off for this rule
  (except `serviceNotAsClass` at true `Context.Service` / `Tag` factories)

## Proven contracts

- `test/http-server-overload.test-d.ts` — `httpServer` / `wsServer` / `ipcServer` keep `"Dep"` in `R`
  and propagate `E`
- `test/node-nameless-listen.test-d.ts` — `Node.unix(serveWithDep)` keeps `"Dep"` / fallible `E`

## How to reproduce

```bash
pnpm exec tsgo --noEmit -p tsconfig.json 2>&1 | rg 'anyUnknownInErrorContext|TS377030'
# expect: no matches
```

## Batches

| Batch | Scope | Status |
|------|--------|--------|
| **0** | Lock D1 + open-`R` serve lists (listen + `*Server`) | **Done** |
| **1** | `nodeHttpServer` / `nodeIpcServer` / `nodeServerCommon` | **Done** |
| **2** | `ServeLayerList` on `unix` / `http` / `ws` / `nPipe` listen | **Done** |
| **3** | WorkPool / store / daemon / logs / cli expression hits | **Done** |
| **4** | Tests + examples | **Done** |
| **5** | `serviceNotAsClass` factories + `missingLayerContext` test-d | **Done** |
