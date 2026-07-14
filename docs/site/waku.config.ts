import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "waku/config";

// Content lives outside this app's root (at docs/), so Vite's watcher doesn't see
// NEW files there — a new chapter wouldn't appear until restart. Add the content dirs
// to the watcher so `import.meta.glob` hot-detects added/removed chapters.
const watchDocsContent = {
  name: "watch-docs-content",
  configureServer(server: { watcher: { add: (paths: ReadonlyArray<string>) => void } }) {
    server.watcher.add(
      ["../standards", "../guides", "../index.md"].map((p) => fileURLToPath(new URL(p, import.meta.url))),
    );
  },
};

// `@vitejs/plugin-react` wires the `react-server` export condition Waku's RSC
// renderer requires. Waku is pinned to 1.0.0-beta.3 — beta.6 regressed that
// condition wiring (500 on every route). Revisit the pin when a later beta fixes it.
export default defineConfig({
  vite: {
    plugins: [tailwindcss(), react(), watchDocsContent],
    // Content `.md` is Djot source, not JS. Declaring it an asset stops Vite from running
    // JS import-analysis on it (which errors on edit and breaks the HMR signal), so `?raw`
    // imports and hot-reload work cleanly.
    assetsInclude: ["**/*.md"],
    // `@pm` -> the effect-pm package SOURCE, so island widgets bundle with THIS app's
    // single `effect`/`react` instance (a dual instance would break atom reactivity).
    resolve: {
      // Source-imported package widgets pull react/lucide/recharts from the repo's
      // node_modules; dedupe forces ONE react instance (else "Invalid hook call").
      dedupe: ["react", "react-dom", "react/jsx-runtime", "effect"],
      alias: {
        "@pm": fileURLToPath(new URL("../../src", import.meta.url)),
        // Node-only deps the package pulls transitively (SQLite storage, CI check).
        // A demo queue is in-memory, so stub them out of the browser bundle.
        "@effect/sql-sqlite-node/SqliteClient": fileURLToPath(new URL("./shims/sqlite-node-stub.js", import.meta.url)),
        "@effect/sql-sqlite-node": fileURLToPath(new URL("./shims/sqlite-node-stub.js", import.meta.url)),
        "is-in-ci": fileURLToPath(new URL("./shims/is-in-ci.js", import.meta.url)),
      },
    },
    // `highlight.ts` runs the TypeScript compiler (via `twoslash`) at SSG time to type-check
    // code blocks. Left bundled, the TS compiler's CJS `__filename` reference is undefined in the
    // ESM server bundle and `waku build` throws `__filename is not defined`. Externalize the
    // build-time Node deps (per server environment — rsc + ssr) so the SSG server loads them
    // normally (`waku dev` was unaffected — it doesn't bundle a server chunk).
    environments: {
      rsc: { resolve: { external: ["typescript", "twoslash", "@shikijs/twoslash"] } },
      ssr: { resolve: { external: ["typescript", "twoslash", "@shikijs/twoslash"] } },
    },
    // Content is at docs/ and the package source is at repo/src — both above this app's
    // root (docs/site). Allow the dev server to read up to the repo root.
    server: { fs: { allow: ["../.."] } },
  },
});
