import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import compression from "compression";
import { defineConfig } from "waku/config";

// DEV-MODE compression: the hover-dense pages are megabytes raw but ~95% compressible (repetitive
// shiki spans), and Vite's dev server sends identity encoding — browsing the dev box from a phone
// (documenting while building) downloads it all uncompressed. Gzip at the dev middleware layer
// cuts an 11 MB page to ~0.5 MB. Production hosting compresses at the edge; this is dev parity.
// CLIENT-only stub for @effect/platform-node: Hyperlink.ts / internal/node.ts reach it through
// DYNAMIC import() on node-transport paths a browser can never take, but the bundler chases
// dynamic imports into node:fs/http/worker_threads. A resolveId hook scoped to the client
// environment is deterministic where environment-level alias merging proved not to be; the server
// environments keep the real package.
const platformNodeStubPath = fileURLToPath(new URL("./shims/platform-node-stub.js", import.meta.url));
const clientPlatformNodeStub = {
  name: "client-platform-node-stub",
  enforce: "pre" as const,
  applyToEnvironment: (env: { name: string }) => env.name === "client",
  resolveId(id: string, importer?: string) {
    // the package by any specifier…
    if (id === "@effect/platform-node" || id.startsWith("@effect/platform-node/")) {
      return platformNodeStubPath;
    }
    // …and anything resolved FROM INSIDE it (its internal relative imports), so the subtree can
    // never expand into node builtins no matter which entry reached it.
    if (importer !== undefined && importer.includes("/@effect/platform-node/")) {
      return platformNodeStubPath;
    }
    return undefined;
  },
};

const devCompression = {
  name: "dev-compression",
  configureServer(server: { middlewares: { use: (mw: unknown) => void } }) {
    server.middlewares.use(compression());
  },
};

// Content lives outside this app's root (at docs/), so Vite's watcher doesn't see
// NEW files there — a new chapter wouldn't appear until restart. Add the content dirs
// to the watcher so `import.meta.glob` hot-detects added/removed chapters.
const watchDocsContent = {
  name: "watch-docs-content",
  configureServer(server: { watcher: { add: (paths: ReadonlyArray<string>) => void } }) {
    // Keep in sync with src/lib/content.ts globs / scripts/docsContentWalk.ts roots.
    server.watcher.add(
      [
        "../index.md",
        "../examples.md",
        "../examples",
        "../getting-started",
        "../services",
        "../guides",
        "../observe",
        "../standards",
        // Paired Twoslash includes (`include="examples/…"`) — HMR when teaching scripts change.
        "../../examples/work-pool",
        "../../examples/gate",
        "../../examples/daemon",
        "../../examples/node",
        "../../examples/fleet",
        "../../examples/launcher",
        "../../examples/hyperlink",
        "../../examples/store",
        "../../examples/schedule",
        "../../examples/polling",
        "../../examples/config",
        "../../examples/scenarios",
        "../../examples/apps",
        "../../examples/shared",
      ].map((p) => fileURLToPath(new URL(p, import.meta.url))),
    );
  },
};

// `@vitejs/plugin-react` wires the `react-server` export condition Waku's RSC
// renderer requires. Waku is pinned to 1.0.0-beta.3 — beta.6 regressed that
// condition wiring (500 on every route). Revisit the pin when a later beta fixes it.
export default defineConfig({
  vite: {
    plugins: [tailwindcss(), react(), watchDocsContent, devCompression, clientPlatformNodeStub],
    // Content `.md` is Djot source, not JS. Declaring it an asset stops Vite from running
    // JS import-analysis on it (which errors on edit and breaks the HMR signal), so `?raw`
    // imports and hot-reload work cleanly.
    assetsInclude: ["**/*.md"],
    // `@pm` -> the hyperlink-ts package SOURCE, so island widgets bundle with THIS app's
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
      rsc: { resolve: { external: ["typescript", "twoslash", "@shikijs/twoslash", "prettier"] } },
      ssr: { resolve: { external: ["typescript", "twoslash", "@shikijs/twoslash", "prettier"] } },
    },
    // Content is at docs/ and the package source is at repo/src — both above this app's
    // root (docs/site). Allow the dev server to read up to the repo root.
    server: { fs: { allow: ["../.."] } },
  },
});
