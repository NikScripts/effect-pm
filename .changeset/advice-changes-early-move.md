---
"hyperlink-ts": minor
---

Track D — `Advice.changes` + early dial move on prefer flip.

- New wire events: `AdvicePreferred` / `AdviceCleared` on the existing `Advice` tag’s `changes` stream (same pattern as `Directory.changes` — no extra public sugar).
- `Hyperlink.lookupClient` watches prefer/clear for its service key and re-resolves immediately — dialers move to B when you `advise({ prefer: B })`, before A leaves and before the first `RpcClientError`.
