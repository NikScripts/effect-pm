# agent-console-native — SessionComposer handoff

**Status:** Composer core SHIPPED and owner-confirmed working on-device, on `cursor/agent-k-page-route-6d0e`. Several pieces inside it are still stubs — see Open Work below.
**Package:** `packages/agent-console-native` (Expo/React Native client for `agent-console`; see `packages/agent-console-native/AGENTS.md` — Expo has changed, check the pinned versioned docs before writing any code here).
**Verification method:** No iOS Simulator or Android emulator exists in this environment (`simctl`/`adb` unavailable). Every claim below was confirmed by the owner running the app on a real device, not by automated tests — there is no `typecheck`/`test` script in this package's `package.json` yet.

## What's done

`SessionComposer.tsx` is one persistent element for its whole lifetime: a single `GlassView` wrapping a `TextInput` that never unmounts. "Idle" and "editing" are two visual arrangements of that one tree (a main row that's always visible, plus an Auto-picker row that's the only thing that collapses/expands), not two separate component trees swapped in and out.

This replaced an earlier two-tree design (a non-editable decoy pill that swapped for a real `TextInput` + controls row on tap/focus). That swap was the root cause of a whole family of bugs — decoy tap misses, icons popping in wrong, the glass effect vanishing on reopen — because `GlassView`'s glass material and `Host`'s SwiftUI content both only reliably initialize once, on a component's genuine first mount, with no supported hook for "this instance got reused, redo your setup." Rewriting to one persistent tree removed the underlying problem instead of working around each symptom.

Confirmed working on-device as of `c6334fe38`:
- `+` and send stay visible on their own row at all times; only the "Auto" row collapses.
- The field starts at its minimum single-line height and grows correctly as multi-line text is typed, without a stuck oversized field on screen-open.
- The Auto row's expand/collapse is animated and stays in sync with the keyboard's own show/hide timing.
- The row's icons no longer visibly pop in off-center and settle a moment later.
- Enter sends the message instead of inserting a newline.
- Glass material and squircle (`borderCurve: "continuous"`) corners render correctly and survive the composer being reopened.

## Architecture invariants — do not change without re-testing on-device

These are load-bearing, not incidental, and each is documented at its point of use in `SessionComposer.tsx`/`SystemIcon.tsx`:

1. **Nothing in the composer's glass/icon tree may unmount and remount.** `GlassView` and `@expo/ui`'s `Host` depend on genuine first-mount setup; there is no clean "re-init" signal. If a future change reintroduces conditional mounting (e.g. rendering the Auto row's contents only `if (expanded)` instead of clipping their container), the glass-effect and icon-centering bugs this rewrite fixed will come back.
2. **The squircle clip lives on a plain wrapping `View` (`fieldClip`), not on `GlassView` directly.** Setting `borderCurve` on `GlassView` itself broke the glass effect outright in the earlier version.
3. **`onContentSizeChange` must ignore its callback while `text.length === 0`.** It fires once on mount with an unreliable measurement, before any typing; not guarding against that makes the field latch onto an inflated height with nothing typed yet.
4. **The expand/collapse `LayoutAnimation` uses `type: "keyboard"`, not `easeInEaseOut`.** `easeInEaseOut` runs ~300ms, visibly slower than iOS's own ~250ms keyboard animation, so the two visibly fall out of sync. `"keyboard"` is UIKit's real keyboard-curve constant.
5. **The Auto row's icon opacity is gated behind the animation's real completion (`controlsReady`, set in the `LayoutAnimation.configureNext` callback), separately from the row's own height/clip mechanism.** The height mechanism (`!expanded && autoRowCollapsed`) is the confirmed-working piece and should not be touched; only the opacity/pointerEvents gating was added on top of it.
6. **`SystemIcon`'s `Host` keeps `matchContents` alongside its explicit `style` size, not instead of it.** Dropping `matchContents` broke rendering outright, tried twice in different places. Keeping both is what makes the fallback (`frame` modifier) and the initial `Host` measurement agree even if `Host`'s own native measurement round-trip races the `frame` modifier.

## Open work

1. **Attachment ("+") button** — currently a rendered `Pressable` with no `onPress`. Needs real wiring once a design for what it attaches (files? images?) exists. No design decision has been made yet — this is not just a missing handler.
2. **"Auto" model picker** — currently a rendered stub with no `onPress`. Real wiring is `client.provider.list()`, matching the pattern web's `NewSessionPicker` already uses in `packages/agent-console`.
3. **`SessionTopBar`'s "More" button** — rendered, not wired. What belongs in that menu hasn't been decided.
4. **Delete-tool for the `console` agent** — separate from the composer itself. Direction decided in a prior session: a safe, controlled delete capability, not a blanket permission-config change. Requires a real OpenCode plugin with path validation (deny anything outside the session's own directory scope), not started.

## Not started: repo → worktree organization

A full plan exists at `~/.claude/plans/warm-sprouting-reddy.md` (Plan-mode output, not yet executed) for reorganizing `agent-console`'s session list by repo → worktree, modeled on the Cursor mobile app. It is scoped to `packages/agent-console` (the web client), not `-native`, and covers: a `rootDir` setting, filesystem-based repo/worktree discovery via `client.file.list`, a `repo-admin` OpenCode agent profile scoped to `git worktree*` only, new Home/RepoSessions pages, and a worktree-creation flow. None of it has been built. Read that plan file in full before starting — it has its own verification steps and an explicit out-of-scope list (no repo creation/deletion from the UI).

## Non-goals for whoever picks this up next

- Do not reintroduce the two-tree (decoy-pill-swaps-to-real-input) design to "simplify" the composer — it was tried, and removing it is what fixed the bug class described above.
- Do not change `MIN_INPUT_HEIGHT`/`INPUT_LINE_HEIGHT` independently of each other; they're computed against each other deliberately (see the comment at their definition).
- Do not treat this document as covering the web client (`packages/agent-console`) — it's `-native`-only.
