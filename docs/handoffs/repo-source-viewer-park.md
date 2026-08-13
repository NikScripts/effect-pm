# Repo source viewer (`/repo/…`) — parked

**Status:** PARK — idea only; **do not Eng** until Last.context / Last.link track 1 is settled  
**Owner:** Agent K notes · owner call to unpark  
**Related:** [`file-router-lock.md`](./file-router-lock.md) · [`last-context-view-lock.md`](./last-context-view-lock.md) · Twoslash includes (`docs/site/src/lib/example-include.ts`) · [`examples/last/from-effect/Catalog.ts`](../../examples/last/from-effect/Catalog.ts)

## One-sentence idea

**A soft-nav `repo` group whose splat path is a real repo-relative file; the page renders that file (Twoslash first, full viewer later, in-browser editor much later).**

## Sketch

```text
/repo/packages/last-ts/src/Last.ts
      └────────── splat = packages/last-ts/src/Last.ts ──┘
```

```ts
// catalog sketch (not Eng’d)
Router.group("repo").add(
  Route.get("file", "/repo/*path"), // keep extension in *path
)

// fromEffect sketch — allowlisted roots → typed urls or open splat + runtime check
Router.group("repo").fromEffect(RepoFiles.fromRoots([
  "packages/last-ts/src",
  "src",
  "examples/last",
]))
```

Page body (PoC): load file text → one Twoslash fence with `// @filename: <rel>` (same prep path as `{.twoslash include="…"}` today).

## Why this fits what we already have

| Existing piece | Role here |
|----------------|-----------|
| `{.twoslash include="examples/…"}` | Proof that **real files are SSOT** for typed fences (`prepareExampleForTwoslash` + `@filename`) |
| `fileRouter` `[...name]` → `*name` | Same splat shape for “rest of path including `/` and `.ts`” |
| `group.fromEffect` | Enumerate / constrain the file set (roots, extensions) without hand-listing every `.ts` |
| Docs site Shiki/Twoslash pipeline | Render path already exists; widen the include glob beyond `examples/` |

**Not** the same as today’s file-router product: file-router emits a **path table for app pages**. This idea is **source tree → one parameterized doc route**. Same *disk grammar instincts*; different job.

## Phased dream

| Phase | Ship | Notes |
|-------|------|--------|
| **0 — PoC** | `/repo/*path` → allowlisted file → Twoslash (or Shiki-only fallback) | Prove URL ↔ file ↔ fence |
| **1 — Viewer** | chrome: path crumb, raw/download, sibling file list, language by extension | Still read-only |
| **2 — Editor** | Monaco/CodeMirror, local edits, optional “open in GitHub” | Long-horizon; not a near gate |

## Design calls (feedback)

### Keep the file extension in the URL — **yes**

`/repo/…/Last.ts` beats extensionless `/repo/…/Last`. Ambiguity otherwise (`.ts` / `.tsx` / directory / `Last.ts` vs generated). Splat `*path` already carries `.ts`; do not strip.

Prefer a stable prefix under the group, e.g. `/repo/packages/last-ts/src/Last.ts`, not `/repo/src/Last.ts` alone (multi-package monorepo).

### Allowlist roots — **required for PoC**

Open splat without a root allowlist is a footgun (secrets, `.env`, `node_modules`, huge files). PoC roots something like:

- `packages/last-ts/src/**/*.{ts,tsx}`
- optional: `src/**/*.{ts,tsx}`, `examples/last/**/*.{ts,tsx}`

Reject `..`, absolute paths, and anything outside the allowlist before read.

### Twoslash vs highlight-only

Full-library modules often pull deep graphs; Twoslash can be **slow or noisy** vs teaching examples. PoC options:

1. **Shiki-only** first (instant, no typecheck) — still proves the route  
2. Twoslash with `@noErrors` / sized allowlist  
3. Twoslash “real” only for files already in the example/docs include set  

Do not block the route concept on “every `Last.ts` hover is perfect.”

### `fromEffect` vs hand `Route.get`

- **Hand route + runtime allowlist** — fastest PoC (`*path: string`, validate on handle).  
- **`fromEffect` catalog of known files** — better typed `urls.repo.file("packages/last-ts/src/Last.ts")` and closed unions; closer to “file router of the library.” Worth it once PoC feels good.

`Route.fileRoot` / page `paths.gen` stay for **app pages**; don’t overload them to mean “browse `packages/`.”

### Soft-nav / Last.link

Once the route exists: `Last.link(Site, { to: (u) => u.repo.file })` with `path` (or splat prop) as a prop — same uncalled-route pattern as `ChapterLink` + `slug`.

### Distinct from API reference

`/api/last-ts/Last/…` is **symbol**-oriented. `/repo/…/Last.ts` is **file**-oriented (module as authored). Both can link to each other later; don’t merge the URLs.

## Non-goals (for now)

- Eng before context / link track is quiet  
- Writable editor, LSP-in-browser, or save-back-to-disk  
- Serving arbitrary git history / blame (nice later)  
- Replacing Twoslash example includes (those stay teaching SSOT)

## Unpark checklist

1. Last.context / Last.link track 1 accepted; track 2 still optional  
2. Owner picks PoC root allowlist + Twoslash vs Shiki-first  
3. One docs-site page + catalog group; no new package surface until viewer earns it  

## Status line for board

**Parked idea** — repo splat → real source → Twoslash/viewer; expand after context goals.
