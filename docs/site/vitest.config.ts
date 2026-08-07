import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = path.dirname(fileURLToPath(import.meta.url))
const lastTsSrc = path.resolve(root, "../../packages/last-ts/src")
const repoSrc = path.resolve(root, "../../src")

const reactRoot = path.resolve(root, "node_modules/react")
const reactDomRoot = path.resolve(root, "node_modules/react-dom")

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime", "effect"],
    // Mirror docs/site/waku.config.ts — more-specific keys first.
    alias: {
      "hyperlink-ts/ui/Router/waku": path.join(repoSrc, "ui/RouterWaku.ts"),
      "hyperlink-ts/ui/Router": path.join(root, "src/ui/Router.tsx"),
      "hyperlink-ts": repoSrc,
      "last-ts/AtomReact": path.join(lastTsSrc, "AtomReact.tsx"),
      "last-ts/View": path.join(lastTsSrc, "View.tsx"),
      "last-ts/Page": path.join(lastTsSrc, "Page.ts"),
      "last-ts/Route": path.join(lastTsSrc, "Route.ts"),
      "last-ts/RouterBuilder": path.join(lastTsSrc, "RouterBuilder.ts"),
      "last-ts/Memory": path.join(lastTsSrc, "Memory.ts"),
      "last-ts/Layout": path.join(lastTsSrc, "Layout.ts"),
      "last-ts/Router/waku": path.join(lastTsSrc, "Router/waku.ts"),
      "last-ts/Router": path.join(lastTsSrc, "Router.ts"),
      "last-ts/Last": path.join(lastTsSrc, "Last.ts"),
      "last-ts": path.join(lastTsSrc, "index.ts"),
      react: reactRoot,
      "react-dom": reactDomRoot,
      "react/jsx-runtime": path.join(reactRoot, "jsx-runtime.js"),
      "react/jsx-dev-runtime": path.join(reactRoot, "jsx-dev-runtime.js"),
      "waku/router/client": path.join(
        root,
        "node_modules/waku/dist/router/client.js",
      ),
    },
  },
})

