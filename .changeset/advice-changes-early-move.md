---
"hyperlink-ts": minor
---

Track D — `Lookup.Advice.changes` + early dial move on prefer flip.

- New wire events: `AdvicePreferred` / `AdviceCleared` on `Advice.changes` (sugar: `Lookup.adviceChanges`).
- `Hyperlink.lookupClient` watches prefer/clear for its service key and re-resolves immediately — dialers move to B when you `advise({ prefer: B })`, before A leaves and before the first `RpcClientError`.
