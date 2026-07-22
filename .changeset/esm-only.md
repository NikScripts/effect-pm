---
"hyperlink-ts": minor
---

Ship the package as ESM-only (`"type": "module"`).

The dual CommonJS + ESM build is gone: there is now a single ESM build, and the `require` export conditions are removed (each `exports` entry is `{ types, default }` pointing at the ESM `.js`). `moduleResolution` moves to `bundler` — transparent to consumers since tsup bundles each entry, so no relative imports escape the package. Consumers must import via ESM (`import`), which the only known consumer already does.

Bonus: with the whole repo on ESM, the terminal UI (Ink, which is ESM-only via yoga-layout's top-level await) now runs directly under `tsx` instead of needing an esbuild→ESM bundle step.
