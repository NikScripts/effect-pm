# Handoff: Twoslash hover-types in the docs site

## Goal

Give the docs the same **real type-on-hover** the Effect docs have: hover any identifier in a TS
code block and see its inferred type in a popover, driven by an actual TypeScript language service —
not hand-written comments. Once this lands, the manual `// : number` style comments in `docs/index.md`
can be removed, because twoslash surfaces those types automatically.

Deliver it on the **intro page (`docs/index.md`)** first as the proof, then it can roll out to the
rest of the pages.

## Where the code lives

The docs site is a Waku app under `docs/site/`. Highlighting is Shiki, server-side, at render/build
time — **no client JS ships today**; coloured markup is baked into the static HTML.

- `docs/site/src/lib/highlight.ts` — the Shiki highlighter. `loadHighlighter()` builds it once;
  `highlightToReact(code, lang)` calls `hl.codeToHast(...)` and walks the HAST to React via
  `hastToReact`. **This is the file you extend.**
- `docs/site/src/lib/docs-content.tsx` — the Djot walker. Case `code_block` (~line 65) dispatches on
  `n.lang`: island langs (`queue`, `resource`, …) render live demos; everything else calls
  `highlightToReact(n.text, n.lang)`. This is where you detect the twoslash opt-in.
- `docs/site/src/styles/docs.css` — where the twoslash popover CSS goes.
- `docs/site/package.json` — Shiki is `^4.3.1`. Add `@shikijs/twoslash` and `typescript` (twoslash
  runs a real language service, so `typescript` must be an explicit dep).

## What to do

1. Add deps: `@shikijs/twoslash`, `typescript` (and twoslash's transitive `@typescript/vfs` comes
   with it).
2. In `highlight.ts`, pass `transformers: [transformerTwoslash({...})]` to `codeToHast`, but **only
   for blocks that opt in** (twoslash compiles every block — you don't want it on `bash`/`json` or on
   illustrative fragments). Gate it on an explicit marker (see step 4).
3. Make twoslash resolve **our own types** (`effect`, `@nikscripts/effect-pm`). Twoslash type-checks
   in an in-memory VFS; point its compiler options at a tsconfig whose `paths` map the package (import
   from `../../src/*` or the built `dist` types) so `QueueResource`, `Resource`, `Effect`, etc.
   resolve. Without this, every snippet errors and twoslash bails.
4. **Opt-in marker.** Decide how a block requests twoslash and wire it through the Djot walker. Djot's
   `code_block` node exposes the info string; confirm whether ` ```ts twoslash ` arrives as
   `n.lang === "ts twoslash"` or whether the second token lands elsewhere (Djot may only keep the
   first word). A block attribute (`{.twoslash}`) may be cleaner — check what the parser gives you and
   pick the form that survives round-trip.

## Gotchas (these will bite)

- **`hastToReact` drops attributes.** Today it copies only `className` and `style` (highlight.ts
  ~line 57-61) and throws away everything else. Twoslash emits nodes with `data-*` attributes and a
  nested popover structure — those must survive to the DOM or hover does nothing. Either extend
  `hastToReact` to carry through `data-*` (and any other props twoslash sets) **and** render the popup
  child nodes, or render twoslash blocks via `dangerouslySetInnerHTML` from `codeToHtml` instead of
  the HAST→React walk. The React walk is preferred (consistency, no innerHTML) but is the bigger lift.
- **Snippets must compile.** Twoslash runs `tsc` on each block. The intro snippets are *fragments* —
  no imports, `Emails`/`Effect`/`nextEmail`/`sendEmail` assumed in scope — so they will not compile
  as-is. Use twoslash's `// ---cut---` convention: put the imports + setup **above** the cut (twoslash
  compiles it, the reader never sees it), and only the lines below the cut render. Net effect: the
  reader still sees just `const emails = yield* Emails` while twoslash has full type context. Every
  intro block needs its hidden preamble authored.
- **Some intro lines are inside a `gen` body** (`const emails = yield* Emails`). The hidden preamble
  must open the `Effect.gen(function* () {` wrapper above the cut and the compile has to stay valid —
  plan the cut boundaries per block.
- **Dual-theme is already set** (github-light + github-dark, switched under `prefers-color-scheme`).
  The twoslash popover CSS must theme both — don't hardcode one background.
- **`distributed`-on-queue TS2589 is real.** Don't put `Emails.pipe(Resource.distributed([...]))` in
  a twoslash block — it overflows instantiation depth (a known type-depth limit of the queue tag). The
  fleet snippets use `Resource.peersLayer({ nodes })`, which compiles clean; keep it that way.

## Acceptance

- Hovering identifiers in the intro's TS blocks shows real inferred types (e.g. `emails` → the queue
  handle, `depth` → `number`, `worker`/`fleet` → `Layer<…>`).
- Non-opted blocks (bash, json, fragments elsewhere) render exactly as before — twoslash does not run
  on them.
- `pnpm run docs:serve` renders with no twoslash compile errors in the intro; popovers theme in both
  light and dark.
- Once verified, strip the now-redundant `// : type` comments from the twoslash'd intro blocks.

## Scope

Intro page only for the first pass. Rolling twoslash across the Standards pages is a follow-up once
the mechanism and the hidden-preamble pattern are proven here.
