# Inventory: `anyUnknownInErrorContext`

**Status:** inventory only — rule stays **off** in `tsconfig.json` until owner unlocks a fix wave.  
**Captured:** 2026-07-21 on tip after public-surface hygiene.

## How to reproduce

```bash
pnpm exec effect-language-service diagnostics --project tsconfig.json \
  --lspconfig '{"diagnosticSeverity":{"anyUnknownInErrorContext":"error"}}'
```

## Counts

| Metric | Value |
|--------|------:|
| Files checked | 371 |
| Total diagnostics | 256 |
| Rule hits (`anyUnknownInErrorContext`) | ~224 |
| Files with hits | 49 |

Approximate split: `src/internal` ~95 · `test` ~74 · public `src` ~52 · `examples` ~3.

## Heaviest files

| Hits | File |
|-----:|------|
| 21 | `src/Resource.ts` |
| 13 | `test/resource-verify-connection.test.ts` |
| 13 | `src/internal/nodeWs.ts` |
| 13 | `src/internal/nodeHttp.ts` |
| 12 | `src/internal/nodeUnix.ts` |
| 12 | `src/internal/nodeNPipe.ts` |
| 12 | `src/internal/nodeHttpServer.ts` |
| 10 | `test/transport-conformance.test.ts` |
| 9 | `src/internal/nodeIpcServer.ts` |
| 8 | `src/Store.ts` |
| 8 | `src/Process.ts` |

## Suggested Eng batches (when unlocked)

1. **Node transport Layer E channels** — `nodeHttp` / `nodeWs` / `nodeUnix` / `nPipe` / `*Server` (clustered ~70 hits).
2. **`Resource.ts` serve/client surfaces** — widen typed E instead of `unknown` leaks.
3. **Tests** — prefer typed Exit/`TaggedError` harnesses over `unknown` casts (`transport-conformance`, verify-connection).
4. **Examples** — drop `as Effect.Effect<…, unknown>` at `NodeRuntime.runMain`.

Do **not** flip the tsconfig diagnostic to error until batch 1 is green (or owner accepts a staged per-project enable).
