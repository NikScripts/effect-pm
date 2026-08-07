import { fileURLToPath } from "node:url";
import { defineConfig } from "waku/config";

const lastTsSrc = fileURLToPath(
  new URL("../../../packages/last-ts/src", import.meta.url),
);

/** last.ts RSC demo — Waku pages + Page stamps. */
export default defineConfig({
  vite: {
    resolve: {
      dedupe: ["react", "react-dom", "react/jsx-runtime", "effect", "waku"],
      alias: {
        "last-ts/Page/react": `${lastTsSrc}/Page/react.tsx`,
        "last-ts/Page": `${lastTsSrc}/Page.ts`,
        "last-ts/Route": `${lastTsSrc}/Route.ts`,
        "last-ts/Router/waku": `${lastTsSrc}/Router/waku.ts`,
        "last-ts/Router": `${lastTsSrc}/Router.ts`,
        "last-ts/View": `${lastTsSrc}/View.tsx`,
        "last-ts/Last": `${lastTsSrc}/Last.ts`,
        "last-ts/AtomReact": `${lastTsSrc}/AtomReact.tsx`,
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
