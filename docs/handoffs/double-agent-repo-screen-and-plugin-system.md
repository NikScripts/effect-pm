# DoubleAgent — Repo/Workspace screen, collapsing glass header, and the plugin/page system

Status: design, not approved for build. No code until the shapes below are signed off.
Scope: `packages/agent-console-native` (the iOS app; Xcode target `DoubleAgent`).
Related: [[project-glass-spike-expo]] server bring-up, `SessionHeaderTitle.tsx` (the collapse target), `RootNavigator.tsx` (routes).

---

## 1. Intent

Give a repo/workspace its own screen with a large, collapsing glass header. The header is the entry point to everything you do with that repo: built-in views (files, docs, commits, PRs), pinned shortcuts, and installed plugins. The motivating feature underneath all of it is a **Scripts & Commands** page that aggregates every `package.json` script and every Effect-CLI command across the workspace and runs them from the app.

The header is not decoration. Its two states — expanded and collapsed — are the whole navigation model: expanded shows the repo's surface area; collapsed gets out of the way and becomes the same top bar you already have in a chat session, so moving between "browsing a repo" and "in a session" feels like one continuous surface.

---

## 2. The Repo/Workspace screen

### 2.1 Anatomy (expanded)

A single tall glass **squircle** (rounded rectangle) pinned to the top. It has two parts:

**Inner header** — one row across the top of the squircle, laid out to sit exactly where a normal nav bar sits:
- Left: **back** (glass button).
- Right: **3-dot menu** (glass button).
- Center: **repo/workspace name**, rendered inside a glass capsule whose **glass is transparent (opacity 0)** while expanded — the name text shows, the capsule behind it does not.

**Body** — below the inner header, inside the same squircle:
1. **Menu** — the repo's built-in views: Files, Docs, Commits, PRs, and other GitHub info we care about.
2. **Favorites** — pinned page shortcuts for this repo. **Hidden entirely when there are none.**
3. **Plugins** — installed plugin pages for this repo. Shows **at most 2**, plus a **See all** row → full plugin list for the repo.

### 2.2 Collapse behavior

Collapse is driven by scroll, **finger-tracked, not a fire-and-forget animation** — as the finger moves the header follows it 1:1 and reverses cleanly. Define a normalized progress `p ∈ [0,1]`:
- `p = 0` fully expanded (default on entry).
- `p = 1` fully collapsed.
- `p = clamp(scrollY / COLLAPSE_DISTANCE, 0, 1)`.

As `p` goes 0 → 1, four things interpolate **simultaneously**:

| Element | `p=0` | `p=1` |
|---|---|---|
| Squircle glass | opaque glass | **fully transparent** (glass gone) |
| Inner-header **name** glass | opacity 0 | **opacity 1** (name gets its capsule) |
| Body (menu + favorites + plugins) | full height, visible | **height 0, gone** |
| Squircle height | `EXPANDED_H` | inner-header row height only |

The inner-header row (back · name · 3-dot) **must not move** through the collapse — its final geometry has to land pixel-identical to the chat session's top bar.

**End state (`p=1`) must be indistinguishable from `SessionChatScreen`'s header:** same top inset, same 44pt title pill, same back and 3-dot positions. "Mostly" identical per the brief — call out any deliberate difference explicitly; otherwise treat "identical" as the acceptance bar.

### 2.3 Implementation approach

**Requirement from the owner: it is glass, so it must be real glass** (`expo-glass-effect` `GlassView` / `@expo/ui` `glassEffect`, iOS 26 Liquid Glass) — never a faux-blur stand-in — and the collapse must feel native and finger-tracked.

**Researched (2026-09, current versions): the OS large-title collapse cannot carry our content.** `@react-navigation/native-stack@7.18` + `react-native-screens@4.26`:
- `headerLargeTitle` **does not accept a custom React component** — the large title is text only, styleable solely via `headerLargeTitleStyle` (`fontFamily`/`fontSize`/`fontWeight`/`color`).
- A custom `headerTitle` function component explicitly **does not animate** with the collapse ("animations for the title won't work"), and custom content is clipped to standard header height ([screens #532](https://github.com/software-mansion/react-native-screens/issues/532), [#2801](https://github.com/software-mansion/react-native-screens/issues/2801), [native-stack docs](https://reactnavigation.org/docs/native-stack-navigator/)).

So the owner's "replace the title with our own stuff and get the native collapse" is not supported by the large-title API — it collapses text, nothing else. Native large title is out for the squircle.

**Recommended approach — Reanimated-4 scroll-driven collapse (native-feeling, no bridge risk).** The app already runs `react-native-reanimated@4.5` + `react-native-gesture-handler@2.32` (used in `CollapsibleParts`, `ReasoningBlock`, `ToolCallBubble`):
- An `Animated` scroll view; `useAnimatedScrollHandler` captures `scrollY` on the **UI thread**; derive `p` as a shared value. This is finger-tracked at native frame rate (120fps) with no JS round-trip.
- The glass is real: `expo-glass-effect` `GlassView` (squircle surface) and `@expo/ui` Hosts (name pill) live **inside** Reanimated-animated RN containers.
- `useAnimatedStyle` animates the **containers'** `opacity` / `height` / `translateY` — never the SwiftUI glass internals. So:
  - "squircle glass → transparent" = animate the squircle container's opacity (the glass stays real; its wrapper fades).
  - "name glass 0 → 1" = cross-fade a name-with-glass Host over a name-without-glass Host via container opacity.
  - "body disappears" = body is scroll content; it scrolls away natively (optionally height-collapsed).
- This sidesteps the real risk (per-frame animation of SwiftUI `glassEffect` params across the `@expo/ui` JSON bridge, which `SessionHeaderTitle.tsx` documents as quirky) because we animate RN containers, not SwiftUI modifiers. Glass stays glass throughout.

**Collapsed-state parity:** the pinned inner-header (back · name-pill · 3-dot) is ours, laid out to match `SessionChatScreen`'s bar exactly (top inset, 44pt pill, button positions). Since blur is already solved (`EdgeBlurBars` + `variable-blur` + `scrollEdgeEffects`) and we own both bars, "identical when collapsed" is a layout-matching task, not a platform fight.

**Fallback if Reanimated can't hit the feel:** a custom **SwiftUI collapsing-header Expo native module** (Swift) where a `ScrollView` + glass header collapse via native scroll effects — fully OS-driven, maximally native, but materially more work (a real native module). Only escalate to this if the Reanimated prototype doesn't feel right.

### 2.4 First step: prototype the collapse in isolation

Before wiring the real repo screen, build the header alone: the Reanimated scroll-driven collapse, real `GlassView` squircle, the four interpolations, landing pixel-identical to the chat bar. Feel it on-device. That prototype is where we confirm Reanimated is enough or decide to escalate to the Swift module (§2.3 fallback). Read the v57 `@expo/ui` + `expo-glass-effect` docs before writing any of it (per `AGENTS.md`).

---

## 3. Body sections in detail

### 3.1 Menu (built-in repo views)

- **Files** — file explorer first. Roadmap: explorer → file **viewer** → full **IDE**. Ship the explorer, expand later.
- **Docs** — see §6 (requires the docs package ported to native).
- **Commits / PRs / GitHub** — show read-only info in-app; for anything that *does* something, **link out to GitHub / the GitHub app** until native features exist. Link-out is the accepted stand-in, not a failure state.

The menu items are themselves **pages** (§4) — "Files" and "Docs" are built-in pages, registered through the same mechanism a plugin uses.

### 3.2 Favorites

- Repo-scoped list of pinned **page shortcuts**.
- A page is favoritable when it takes a repo (§4.4) — favoriting binds the shortcut to *this* repo, so tapping it opens that page already scoped to the repo.
- **Section hidden when empty.**

### 3.3 Plugins (in the squircle)

- Shows at most **2** installed plugin pages for the repo + **See all** → full repo plugin list.
- **Setting: "Hide plugins from header."** When on, the plugins section is removed from the squircle — but the full plugin list stays **always reachable from the 3-dot menu**. Hiding is cosmetic, never a way to lose access.

---

## 4. Plugin & page system

The core abstraction. Built-in features and third-party features are the same thing: **pages**. "Not just built in" — an Effect plugin registers an Effect page exactly the way the Files view is registered.

### 4.1 Pages

A **plugin** registers one or more **pages**. A page is the unit of navigation and the unit you can pin/favorite.

### 4.2 Requirements (repo dependency)

Every page declares how it relates to a repo. Working name: **requirement** (the brief left the name open — "requirements or some other name").

- **`repo: "required"`** — a **repo page**. Only usable when there's a repo to pass. Cannot be opened from a bare home context. Favoritable per repo.
- **`repo: "optional"`** — the page has a single **main page** that adapts: given a repo it renders the repo-scoped view; with no repo it renders the no-repo view (the thing you'd want arriving from Home). This is how one page serves both Home and a repo.
- **`repo: "none"`** — global page, no repo.

A page that *can* take a repo (`required` or `optional`-with-repo) is **favoritable** into that repo's Favorites.

### 4.3 Installing & binding to repos

- Installing a plugin asks **which repos** it applies to.
- Each plugin has a **settings page** to manage its repo bindings later (add/remove repos), plus whatever config the plugin needs.
- Repo binding is what populates a repo's **Plugins** section and makes its repo pages available there.

### 4.4 "+ Plugin" entry points

A **+ Plugin** action appears in the 3-dot menu on both Home and a repo screen, but they land differently:

- **From Home** → straight to the **New Plugin** page (browse/install; no repo preselected).
- **From a repo** → to the **repo's plugin list**, which has a **New Plugin** row at the top → the New Plugin page **with this repo auto-selected** (tap to add more repos).

So the repo path is one hop longer on purpose: it first shows what's already installed for the repo, and only then offers to add, pre-scoped to that repo.

### 4.5 Favorites are page shortcuts

"If a page takes a repo it can be added to the repo favorites." Favoriting = pinning a page shortcut, repo-bound for repo-taking pages. The Effect-CLI page (§5) is the worked example: it requires a repo, so it can be favorited into a repo and opened directly from the squircle.

### 4.6 Shape sketch (for review — NOT an implementation)

Illustrative only, to pin the contract before any code:

```
// DESIGN SKETCH — validate, do not build yet.
interface PageDefinition {
  id: string
  title: string
  icon: SystemIconName
  repo: "required" | "optional" | "none"
  render: (ctx: PageContext) => ReactElement
  settingsPage?: PageDefinition
  favoritable?: boolean            // default: true when repo !== "none"
}

interface PageContext {
  repo?: RepoRef                   // present iff a repo was passed
  client: OpencodeClient           // from AppContext
  navigate: NavigateFn
}

interface PluginDefinition {
  id: string
  name: string
  pages: ReadonlyArray<PageDefinition>
  settingsPage?: PageDefinition    // manages repo bindings + config
}
```

Open naming/shape questions live in §8.

---

## 5. Scripts & Commands page (the motivating feature)

A page with `repo: "required"` (it operates on a workspace). Favoritable per repo.

**What it aggregates:**
1. **Every `package.json` script across every package** in the workspace, organized properly (by package, deduped, grouped) — not a flat dump.
2. **Every Effect-CLI command** for the project (surface the CLI's own command tree).

**What it does:**
- **Run scripts and commands straight from the app.**
- **Configure how serving/restart is handled** per script — i.e. long-running `serve`/`dev` scripts need lifecycle handling (start, restart, stop, where output goes), distinct from one-shot scripts. This ties into the reboot-persistence work in [[reference-reboot-persistence]]: the app is a natural front-end for the servers that already survive reboot.

**Execution path — open question:** running scripts needs a process host. opencode's `console` agent currently denies `bash`. Options to decide (§8): a dedicated process endpoint on the vite backend (there is already a `processesPlugin` in `agent-console`'s vite server), a separate worker, or a scoped opencode permission. Do not assume the chat agent runs these.

---

## 6. Docs, native

To show Docs in-app we need the **docs package ported to native** so it renders inside the app, **including the LSP and on-hover type info** (the twoslash-style type popovers). This is a large sub-project, not a view — it pulls the type-on-hover machinery onto the device. Treat it as its own track; the Docs menu item links out or shows a placeholder until it lands.

---

## 7. Persistence / data model

New persisted state (AsyncStorage, following `settings.ts` conventions — async, keyed strings):

- **Installed plugins** and their config.
- **Plugin ↔ repo bindings** (which repos each plugin applies to).
- **Favorites per repo** (ordered list of page shortcuts, each carrying its repo binding).
- **Settings:** "hide plugins from header" (global or per-repo — decide in §8).

Repo identity: reuse whatever `settings.ts`/`repoScan.ts` already use to identify a repo (root/worktree path). Do not invent a second repo key.

---

## 8. Open questions / decisions needed

1. **Collapse implementation** — RESOLVED (§2.3): native OS large-title can't carry custom glass content (text-only, no custom-component animation), so the approach is a **Reanimated-4 scroll-driven collapse** with real glass in animated containers; Swift native-module fallback only if the feel falls short. Prototype-first (§2.4).
2. **Scroll-linked glass opacity** — RESOLVED (§2.3): animate RN **containers** (opacity/height/transform) on the UI thread, not SwiftUI `glassEffect` internals — avoids the bridge risk entirely.
3. **"Identical to chat top bar"** — the brief says "mostly." Enumerate any intended differences, or hold to pixel-identical as acceptance.
4. **Requirement naming** — `repo: "required" | "optional" | "none"` is a placeholder for the brief's "requirements or some other name." Lock a name.
5. **Script execution host** (§5) — processes plugin on vite backend vs worker vs opencode permission.
6. **Menu vs Favorites vs Plugins overlap** — the Menu items are built-in pages; can they be favorited too, or is Favorites only for plugin/optional pages? Define the boundary.
7. **"Hide plugins from header"** — global or per-repo?
8. **Home screen parity** — Home also gets a 3-dot with **+ Plugin**; does Home get its own (smaller) version of this header, or stay as-is? The brief implies Home stays the composer/repo-list and only shares the +Plugin action.

---

## 9. Rough build order (features stack deliberately)

1. Repo screen shell + collapsing header **prototype** (resolve §8.1–8.2 first).
2. Page/plugin registry (§4) with built-in pages only (Files explorer, GitHub link-outs).
3. Favorites + repo Plugins section wired to the registry.
4. New Plugin / plugin-list / repo-binding flows (§4.3–4.4).
5. Scripts & Commands page (§5) as the first "real" repo page + serve/restart config.
6. Files viewer → IDE; Docs-native (§6) as independent longer tracks.

---

## 10. Search (future — animation first)

Home gets search. The interaction, per the owner: the **bottom composer bar animates into a search bar** — it moves **down and then back up** (a bounce) while cross-fading composer → search field, and the same in reverse when search is cancelled. The bounce is deliberate: the search entry point (the magnifying-glass button) is at the **top** of the screen, so the downward bounce draws the eye to the bar that's appearing at the bottom. Once in search, **Home fills with search results**.

Build the **animation first**, results after. Owner will pick this up later — noted, not started.

## 11. Repo/workspace session list (BUILT)

The repo screen's scroll content (below the glass header), top to bottom: an **Unread** section (sessions updated since you last opened them), then a few **Recent** sessions across all worktrees, then sessions **grouped by worktree** (heading per worktree). One worktree or none → a flat **Sessions** list, no grouping. Each group shows the most-recent **5**; more than that adds a **"See all N sessions"** row → a full-list page (`SessionList` route: `{repo, worktree|null, title}`, native header). Built on `repoGrouping.groupByRepo` + the opencode session list.

**Unread** is a new local store (`sessionReads.ts`, AsyncStorage): a session is unread when `time.updated` > **max(last-opened timestamp, setup date)**. The **setup date** is recorded once on first launch (established in `RootNavigator`), so a fresh install treats all pre-existing sessions as already-read instead of flooding Unread. `SessionChatScreen` marks read on open/leave; screens reload read-state on focus. (Currently surfaced on the repo screen; Home could adopt it too.)
