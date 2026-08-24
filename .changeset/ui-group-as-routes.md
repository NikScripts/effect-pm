---
"hyperlink-ts": major
---

**Breaking:** `Router` takes a `Route` catalog only — removed `Router.makeGroup` and `Router.memory|history(Group)`. Use `Route.group(…).fromEffect(Group.asRoutes(group))` then `Router.history(site)`.
