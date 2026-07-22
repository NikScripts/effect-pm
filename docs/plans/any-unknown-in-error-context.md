# Inventory: `anyUnknownInErrorContext`

**Status:** rule stays **off** in tsconfig; fix in batches (owner: all, internal first).  
**Baseline (pre-batch-1):** 224 hits / 49 files.  
**After batch 1 (Node transports):** ~169 hits / 42 files.  
**After batch 2 (Hyperlink + serve followers):** ~112 hits / 35 files.

## How to reproduce

```bash
pnpm exec effect-language-service diagnostics --project tsconfig.json \
  --lspconfig '{"diagnosticSeverity":{"anyUnknownInErrorContext":"error"}}'
```

## Kind split (baseline)

| Kind | Hits | Meaning |
|------|-----:|---------|
| Requirements `unknown`/`any` | ~180 | Layer/Effect `R` not a service id |
| Error `unknown`/`any` | ~44 | Untyped `E` |

## Batches

| Batch | Scope | Status |
|------|--------|--------|
| **1** | Node transports (`src/internal/node*`, `Node.ts`) | **Mostly Eng’d** — listen/connect **0 hits**. Residual ~19 on `httpServer`/`wsServer`/`ipcServer` open-`R` `any` variance (Effect `mergeAll` shape). |
| **2** | `Hyperlink.ts` + Process/Store/Run/Queue serveRemote | **Eng'd** — public targets **0 hits**. Residual `ReadinessOf`/`any` on {@link withReadiness} public type; `clientLayer` node path uses contained `(Layer.effect as any)` gen (mirrors protocol branch). `missingLayerContext` on `localLayer` unchanged. |
| **3** | Tests | After 2 |
| **4** | Examples + consider stage-enable | Last |

## Residual batch-1 note

Public `Node.httpServer` / `wsServer` / `ipcServer` must accept serve layers with open `R` (deps provided outside). That forces `Layer.Layer<never, any, any>` bounds — the same variance hole Effect's `Layer.mergeAll` uses. Clearing those hits means either dropping open-`R` servers or waiting on a tighter Effect pattern. **Do not** flip the rule on for those three files until decided.

## Phase C / B2–B4 timing

Run **after** batches 1–2 (typing churn on Store/Logs would collide with refuse-second-bus Eng).
