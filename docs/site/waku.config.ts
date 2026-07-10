import react from "@vitejs/plugin-react";
import { defineConfig } from "waku/config";

// `@vitejs/plugin-react` wires the `react-server` export condition Waku's RSC
// renderer requires. Waku is pinned to 1.0.0-beta.3 — beta.6 regressed that
// condition wiring (500 on every route). Revisit the pin when a later beta fixes it.
export default defineConfig({
  vite: {
    plugins: [react()],
    // Content `.md` is Djot source (named .md so GitHub renders it), not JS. Declaring
    // it an asset stops Vite from running JS import-analysis on it (which errors on edit
    // and breaks the HMR signal), so `?raw` imports and hot-reload work cleanly.
    assetsInclude: ["**/content/**/*.md"],
  },
});
