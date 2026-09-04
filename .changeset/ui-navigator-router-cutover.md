---
"hyperlink-ts": minor
---

**UI Router cutover:** remove `hyperlink-ts/ui/Navigator`. `View.compose` takes `router: Router.memory|history(…)`. Pass a Group or a `Route.Api`. Group dashboards keep short-name helpers (`open` / `up` / `openLogs` / `openHealth`); `back` is history/memory stack, `up` pops one path segment. Migrate `useNavigator` → `useRouter`.
