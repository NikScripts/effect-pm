# last-ts — groups from Effect (typed links)

**Run:** `pnpm run example:last-from-effect`

Vision: **groups from Effect** into `Router.make().add` — not Effect→Router.

| API | Role |
|-----|------|
| `group.fromEffect` | Flat destinations; **ids typed for `UrlBuilder`** |
| `groupsFromEffect` | Whole flat groups on the catalog |
| `RouterBuilder.layer(Site)` | Yields bake `R` (`SiteMode` \| `FeatureModules`) |

Layer-swap `layerOrg` / `layerSingle` → different project path grammar + optional `support` group. Handlers stay in `RouterBuilder` (not inside the catalog Effect).
