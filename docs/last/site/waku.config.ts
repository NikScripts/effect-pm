import { fileURLToPath } from "node:url";
import { defineConfig } from "waku/config";
import { pageConfig } from "last-ts/vite";

const lastTsSrc = fileURLToPath(
  new URL("../../../packages/last-ts/src", import.meta.url),
);

/** last.ts docs server — not Hyperlink docs/site. */
export default defineConfig({
  vite: {
    plugins: [pageConfig()],
    resolve: {
      dedupe: ["react", "react-dom", "react/jsx-runtime", "effect", "waku"],
      alias: {
        "last-ts/Page/react": `${lastTsSrc}/Page/react.tsx`,
        "last-ts/Page": `${lastTsSrc}/Page.ts`,
        "last-ts/Route": `${lastTsSrc}/Route.ts`,
        "last-ts/Router/waku": `${lastTsSrc}/Router/waku.ts`,
        "last-ts/Router": `${lastTsSrc}/Router.ts`,
        "last-ts/RouterBuilder": `${lastTsSrc}/RouterBuilder.ts`,
        "last-ts/Layout": `${lastTsSrc}/Layout.ts`,
        "last-ts/Waku": `${lastTsSrc}/Waku.ts`,
        "last-ts/View": `${lastTsSrc}/View.tsx`,
        "last-ts/Last": `${lastTsSrc}/Last.ts`,
        "last-ts/Memory": `${lastTsSrc}/Memory.ts`,
        "last-ts/AtomReact": `${lastTsSrc}/AtomReact.tsx`,
        "last-ts/vite": `${lastTsSrc}/vite/fileRouter.ts`,
        "waku/router/client": fileURLToPath(
          new URL("./node_modules/waku/dist/router/client.js", import.meta.url),
        ),
      },
    },
    server: {
      host: true,
      port: 5220,
      strictPort: true,
      allowedHosts: true,
      fs: {
        allow: [fileURLToPath(new URL("../../..", import.meta.url))],
      },
    },
  },
});
