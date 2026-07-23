---
"hyperlink-ts": minor
---

**BREAKING — resource kinds renamed to generic nouns, and two kinds folded away.**

The `*Hyperlink`-suffixed product modules are replaced by generic, standalone names, and the two
variant modules collapse into peer constructors on their base:

| Before | After |
|---|---|
| `QueueHyperlink` | `WorkPool` |
| `RunHyperlink` | `Gate` |
| `Process` | `Daemon` |
| `CustomQueueHyperlink` (subpath + namespace) | `WorkPool.priority(...)` — a peer constructor beside `WorkPool.Tag`; `WorkPool.layer` / `serve` / `serveRemote` / `configure` / `store` dispatch on the tag automatically. Low-level engine: `WorkPool.makePriority`. |
| `HttpApiHyperlink` (subpath + namespace) | `Gate.httpApiClient(...)` (+ `Gate.httpApiClientService` / `Gate.httpApiClientLayer` / `Gate.acceptJson` / `Gate.instrumentEndpoints`) |

Migration:

- `QueueHyperlink.*` → `WorkPool.*`; `RunHyperlink.*` → `Gate.*`; `Process.*` → `Daemon.*`.
- `CustomQueueHyperlink.Tag(...)` → `WorkPool.priority(...)`; its `layer` / `serve` / `store` / `configure`
  calls → the same `WorkPool.*` verbs (they now dispatch to the leveled engine for a priority tag);
  `CustomQueueHyperlink.make` → `WorkPool.makePriority`; `CustomQueueHyperlink.kind` → `WorkPool.priorityKind`.
- `HttpApiHyperlink.make` → `Gate.httpApiClient`; `.Service` → `Gate.httpApiClientService`;
  `.layerEffect` → `Gate.httpApiClientLayer`; `.acceptJson` / `.instrumentEndpoints` → `Gate.*`.
- The `./CustomQueueHyperlink` and `./HttpApiHyperlink` subpaths are removed; import from
  `hyperlink-ts/WorkPool` and `hyperlink-ts/Gate`.

The leveled and HTTP engines remain tree-shakeable — a `WorkPool.Tag`-only import pulls neither engine.

**Priority-lane vocabulary.** The mixed "level"/"lane" wording for `WorkPool.priority` is unified to
**lane**: config `levelCount` → `laneCount`, `namedLevels` → `namedLanes`; `add(item, level?)` →
`add(item, lane?)`; the entry wire field `level` → `lane`; config types `CustomQueueLevelConfig` →
`CustomQueueLaneConfig`. (Log-stream levels and store levels are unrelated and unchanged; the engine's
internal priority-`level` machinery is a different concept and also unchanged.)
