---
"hyperlink-ts": minor
---

Composable Policy module (`hyperlink-ts/Policy`) — one home for cutover + verify + conflict + yield.

- Dial: `sticky` / `unsticky`, `streamGap`, `coldAmbiguous`, `pick`
- Verify: `verifyOff` / `verifyStatus` / `verifyReject` (replaces `Hyperlink.clientVerify`)
- Advertise: `askIncumbent` / `livenessReplace` / `conflictReject` / `OnConflict` + `resolveOnConflict`
- Yield: `yieldAccept` / `yieldRefuse` / `onYield`
- Helpers: `Policy.provide(...)`, `Policy.layer(...)`
- Defaults: sticky + stream stall + cold fail + verify reject + conflict inherit + yield accept
- Call-site ListenOptions / Node stamps remain overrides; ambient Policy fills the gaps
