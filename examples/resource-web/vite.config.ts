import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "is-in-ci": fileURLToPath(new URL("./shims/is-in-ci.js", import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5176,
    allowedHosts: true,
    // The browser is a thin client; proxy the WnbaHost's RPC so the client is same-origin (no CORS).
    // `/rpc` → the host served by `server.ts` (pnpm run example:resource-web-server).
    proxy: {
      "/rpc": { target: "http://localhost:7780", changeOrigin: true },
    },
  },
});
