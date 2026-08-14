# Repo source viewer (`/repo/…`) — parked

**Status:** PARK — idea only; **do not Eng** until Last.context / Last.link track 1 is settled  
**Owner:** Agent K notes · owner call to unpark  
**Related:** [`file-router-lock.md`](./file-router-lock.md) · [`last-context-view-lock.md`](./last-context-view-lock.md) · Twoslash includes (`docs/site/src/lib/example-include.ts`) · [`examples/last/from-effect/Catalog.ts`](../../examples/last/from-effect/Catalog.ts)

## One-sentence idea

**A soft-nav `repo` group whose splat path is a real repo-relative file; the page renders that file (Twoslash first, full viewer later, in-browser editor much later).**

## Perf lock (owner)

| Priority | Rule |
|----------|------|
| **1 — page load** | Visiting `/repo/…` must feel like a normal docs page (static HTML / cached artifact). **Live Twoslash on request is forbidden** for this surface. |
| **2 — process reuse** | Prefer **piggybacking the docgen / API-reference file walk** over a second full-repo crawl. Extra build work is acceptable if it stays incremental and does not regress (1). |
| **3 — build wall-clock** | Distant third. OK to spend more CI/SSG minutes to keep (1) green. |

Same instinct as API symbol pages today: **our** packages can be pre-rendered; heavy on-demand Twoslash is already treated as a build/serializer hazard ([`api/[pkg]/[module]/[symbol].tsx`](../site/src/pages/(book)/api/[pkg]/[module]/[symbol].tsx) comment — effect deps SSR, not static).

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
Router.group("repo").effect(RepoFiles.fromRoots([
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
| `group.effect` | Enumerate / constrain the file set (roots, extensions) without hand-listing every `.ts` |
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

### Twoslash vs highlight-only — bake, don’t pay at click

Full-library modules pull deep graphs; Twoslash is fine **offline**, toxic **on the request path**.

| Approach | Page load | Process | When |
|----------|-----------|---------|------|
| **A. Prebaked HTML** from gen-api / SSG (Shiki ± Twoslash at build) | Best | Reuses or extends the existing file walk | **Default for ship** |
| **B. Shiki-only bake** (no typecheck) | Excellent | Cheap highlight pass on allowlisted files | PoC / fallback if Twoslash bake is too fat |
| **C. Live Twoslash on SSR/SSG-per-request** | Worst | “No extra process” but **burns the user** | **Rejected** for `/repo` |

Docgen already touches most of these files for API reference (symbols, `file:line` source links, hover maps in `highlight.ts` / `api-source-links`). The offer is: **emit a per-file render artifact in that same pass** (or a sibling emit keyed by repo-relative path), then `/repo/*path` is a lookup + serve — not a second compiler.

Do not block the route on “every `Last.ts` hover is perfect.” Prefer fast colored source + links into `/api/…` over a cold Twoslash on click.

### `effect` vs hand `Route.get`

- **Hand route + runtime allowlist** — fastest PoC (`*path: string`, validate on handle).  
- **`effect` catalog of known files** — better typed `urls.repo.file("packages/last-ts/src/Last.ts")` and closed unions; closer to “file router of the library.” Worth it once PoC feels good.

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
2. Owner picks PoC root allowlist  
3. Perf path locked: **bake artifact at docgen/SSG** (reuse file walk); measure TTFB/HTML weight on a fat module (`Last.ts`) before expanding Twoslash richness  
4. One docs-site page + catalog group; no new package surface until viewer earns it  

## Status line for board

**Parked idea** — repo splat → real source → Twoslash/viewer; expand after context goals.
