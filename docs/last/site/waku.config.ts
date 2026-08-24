import { fileURLToPath } from "node:url";
import * as Config from "last-ts/config";
import * as Vite from "last-ts/vite";

const lastTsSrc = fileURLToPath(
  new URL("../../../packages/last-ts/src", import.meta.url),
);

/** last.ts docs server — host CLI entry; apps import last-ts only, never waku. */
export default Config.defineConfig({
  vite: {
    plugins: [
      Vite.fileRouter({
        pagesDir: "src/pages",
        outFile: "src/paths.gen.ts",
      }),
    ],
    resolve: {
      dedupe: ["react", "react-dom", "react/jsx-runtime", "effect", "waku"],
      alias: {
        "last-ts/Page/react": `${lastTsSrc}/Page/react.tsx`,
        "last-ts/Page": `${lastTsSrc}/Page.ts`,
        "last-ts/Route": `${lastTsSrc}/Route.ts`,
        "last-ts/Router/waku": `${lastTsSrc}/Waku.ts`,
        "last-ts/Router": `${lastTsSrc}/Router.ts`,
        "last-ts/RouterBuilder": `${lastTsSrc}/RouterBuilder.ts`,
        "last-ts/Layout": `${lastTsSrc}/Layout.tsx`,
        "last-ts/RootLayout": `${lastTsSrc}/RootLayout.tsx`,
        "last-ts/Document": `${lastTsSrc}/Document.tsx`,
        "last-ts/Waku": `${lastTsSrc}/Waku.ts`,
        "last-ts/View": `${lastTsSrc}/View.tsx`,
        "last-ts/Last": `${lastTsSrc}/Last.ts`,
        "last-ts/Memory": `${lastTsSrc}/Memory.ts`,
        "last-ts/AtomReact": `${lastTsSrc}/AtomReact.tsx`,
        "last-ts/server": `${lastTsSrc}/server.ts`,
        "last-ts/vite": `${lastTsSrc}/vite/fileRouter.ts`,
        "last-ts/config": `${lastTsSrc}/config.ts`,
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
