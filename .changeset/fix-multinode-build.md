---
"@nikscripts/effect-pm": patch
---

**Fix broken beta.25 build.** The `Host`→`Node` rename moved `MultiHost.ts`→`MultiNode.ts`, but the root
`tsup.config.ts` entry and the `./MultiHost` package export still pointed at the deleted file, so `tsup`
failed with `Cannot find MultiHost`. Repointed both to `MultiNode` (the subpath is now
`@nikscripts/effect-pm/MultiNode`). No source changes.
