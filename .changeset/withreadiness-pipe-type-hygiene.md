---
"@nikscripts/effect-pm": patch
---

**withReadiness pipe type hygiene.** Lock multi-site node-bound `.pipe(withReadiness)` (plus stacked `distributed`) under stock tsc via `resource-withreadiness-pipe.test-d.ts`; run `tsc --noEmit` beside tsgo in `typecheck` so TS2589 depth bugs cannot hide; document PipeableTag rule for data-last tag duals; readiness page notes pipe ≡ data-first.
