# Brand landing wash WIP — agent handoff (relinquished)

**Status:** Agent relinquished this worktree / branch. Owner takes over.  
**Date:** 2026-07-29  
**Worktree:** `/Users/nikolasstow/Coding/Hyperlink/worktrees/epsilon`  
**Branch:** `cursor/docs-site-edge-cache-dbdc`  
**Tip:** `06905bbf7` (handoff commit) · wash restore at `941962609`  
**Do not deploy** without owner approval (standing rule; landing WIP was Tailscale-only).

---

## What this is

WIP redesign of the brand-host coming-soon page (`hyperlink.cool` `/`) — soft Bondi
atmosphere, notch/chrome fill, no CTAs. Live apex may still be an older coming-soon;
this branch is ahead of what may be deployed.

---

## Best state reached (restore point)

**Commit `103f4acb3`** — owner feedback: “Great… almost perfect.”

That state had:

| Piece | Behavior |
|-------|----------|
| Wash | On **`html`** (root canvas) — fills notch / status-bar / home-indicator |
| Gradients | Top glow + bottom corner deep washes; stops end on **canvas color** (not `transparent`) |
| Stage | `height: 100dvh; overflow: hidden` on `html` / `body` / `.landing` — no scroll |
| Body | `background-color: var(--landing-canvas)` |
| Orb | `.landing-atmosphere` > `.landing-glow` (decorative, bottom-biased) |

**Only remaining complaint at that point:** background was **repeating** (tile seams).

---

## What tip is now (`941962609`)

Exact restore of `103f4acb3` wash + **one** additive line:

```css
background-repeat: no-repeat;
```

**Intentionally not set:** `background-size: %` — that was what collapsed height fill
on iOS after the almost-perfect state.

Owner had not yet confirmed this restore when the agent was pulled off.

---

## What failed (do not repeat)

After “almost perfect,” the agent chased tiling/offset instead of a one-line
`no-repeat`, and repeatedly **moved the wash off `html`** onto fixed layers /
`::before`. That undid notch fill and scroll lock. Owner explicitly required wash
on the **html background**, not a child component.

Dead ends (for history only):

- `background-size: 100% 100%` on html → height no longer filled
- Fixed `.landing-atmosphere` wash / `100lvh` sizing
- `repeat-y` + `%` or `-50dvh` `background-position` (Safari/% no-op when size === box)
- `::before` `height: 200%; top: -50%` layer offset
- Dual top/bottom DOM orbs
- Opaque `body` covering html wash when wash was only on html

**Invariant that worked for notch:** paint the wash on **`html`**. See also
`docs/site/src/styles/docs.css` (“Paint the root element too…”).

---

## Key files

| Path | Role |
|------|------|
| `docs/site/src/styles/landing.css` | Inlined coming-soon styles (SSOT for wash) |
| `docs/site/src/pages/index.tsx` | Brand `/` markup + `?inline` CSS |
| `docs/site/src/pages/_layout.tsx` | `viewport-fit=cover`, theme-color (`#e8f2f7` / `#0c1c24`), React `key="viewport"` |
| `docs/site/scripts/fix-waku-viewport.mjs` | Postbuild: strip Waku bare viewport duplicate |
| `docs/site/scripts/check-ssg.mjs` | Asserts landing has exactly one `viewport-fit=cover` |
| `docs/site/scripts/serve-landing-preview.mjs` | **Untracked** local Tailscale preview (re-reads CSS each request) |

---

## Local preview

```sh
cd /Users/nikolasstow/Coding/Hyperlink/worktrees/epsilon/docs/site
PORT=5191 HOST=0.0.0.0 node scripts/serve-landing-preview.mjs
```

- URL: `http://100.67.32.32:5191/` (Mini Tailscale IP; confirm with `ifconfig` if stale)
- Server reloads **CSS** every request; **restart Node** after editing the HTML
  template inside the script
- Preview script is untracked — move aside before any deploy (dirty-tree guard)

---

## Host split (locked, unrelated to wash WIP)

| Host | Role |
|------|------|
| `hyperlink.cool` | Brand coming-soon only |
| `dev.hyperlink.cool` | Full docs |

See [`docs-site-dev-host.md`](./docs-site-dev-host.md).

---

## Suggested next step for whoever picks this up

1. Hard-refresh Tailscale preview on tip `941962609`.
2. If still repeating: fix **only** repeat (e.g. confirm `no-repeat` is enough) —
   do **not** change where the wash lives.
3. If notch/scroll regresses: `git show 103f4acb3:docs/site/src/styles/landing.css`
   and diff against tip — restore that geometry before inventing new layers.
4. Deploy only when owner says so; tip-sync to `integration` per branch policy.

---

## Agent note

This agent lost the landing-wash assignment. Do not continue wash experiments on
this worktree without owner re-assignment.
