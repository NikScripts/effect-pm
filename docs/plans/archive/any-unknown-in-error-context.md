# Inventory: `anyUnknownInErrorContext`

**Status:** **Eng’d + tip-synced.** Rule is `"error"` in both typecheck tsconfigs. Cleared on tip —
no channel casts, no rule disables except `serviceNotAsClass` at Service/Tag factories.

**Product docs:** open-`R` serve composition lives in
[`docs/getting-started/managing-layers.md`](../../getting-started/managing-layers.md) and the must-rules
in [`docs/standards/hyperlink-services.md`](../../standards/hyperlink-services.md) (`serve-preserves-requirements`).

## Locked product invariant

**Every HyperService may have requirements** — including other HyperServices. Serve / listen /
`httpServer` / `wsServer` / `ipcServer` must **preserve `R`** (and `E`) from serve layers so callers
`Layer.provide` dependencies outside. Closing `R` at the server boundary is rejected.

## What shipped

| Piece | Notes |
|------|--------|
| Open-`R` serve lists (D1) | `Layer.Any` constraints; public overloads reify channels |
| Gate / Daemon | No public `as any` on serve; memory aliases are identity |
| `Hyperlink.serveRemoteDriver` | Driver mount preserves worker `R`; toolkits call it directly |
| Plain `serveRemote` | Still `ServeRequirements`-inferred for object impls |
| Negative proofs | Bare `AddressedNode`, incomplete client `Layer.Services` |

## Parked erase debt (do **not** spin an agent)

These are Effect/Rpc factory edges. Further chasing has low app-facing leverage; the language
service tracks through most bridges. Leave until a concrete breakage or a package-wide erase audit:

1. `serveRemoteHandlers` → `RpcGroup.toLayer` (`retype`)
2. Wire `invokeWireMethodWithContext` → `Effect.provideContext` (`as any` on dynamic members)
3. D1 `httpServer` / listen internal factory retypes

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
| **6** | Critique follow-through + `serveRemoteDriver` + live docs | **Done** |
