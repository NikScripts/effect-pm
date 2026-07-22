---
"@nikscripts/effect-pm": patch
---

Remove deprecated `Process.processEventReadPayload`.

Shape reads use the baked-in Store read payload (`limit` / nested `where`). Also drops the unused `examples/shared/run-resource-layers.ts` identity helper.
