---
"hyperlink-ts": minor
---

**View compose / Navigator:** Parent-owned navigation is a `Navigator` Context service (`memory` / `history`) with short member-name paths (`/Nwsl/HttpApi`). `View.Chrome` is layout-only (nav callbacks removed — use `useNavigator()`). Group is a View family (`Group.kind` + `View.Card`). `View.compose({ views, navigator })` sugars `View.react` + Navigator (`Provider`, `Grid`, `Outlet`). Web + TUI dashboards mount compose; detail skins peel header when Navigator is present.
