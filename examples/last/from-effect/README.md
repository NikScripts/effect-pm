# last-ts — Context `fromEffect` / `groupsFromEffect`

**Run:** `pnpm run example:last-from-effect`

Shows why those APIs exist: the **set of destinations** (and whole flat groups)
comes from Context services provided at Layer bake. Swap `layerDemo` ↔
`layerEnterprise` — same catalog definition, different live route table.

| API | What it derives |
|-----|-----------------|
| `group.fromEffect` | Flat partner endpoints under `/p/*` from `PartnerDirectory` |
| `groupsFromEffect` | Optional `billing` / `support` groups from `FeatureModules` |

Not a static `.add` list. Not `Group.asRoutes`. Not a single `:slug` page with an
internal switch — each partner is its own destination + page component.
