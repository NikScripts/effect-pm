import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "is-in-ci": fileURLToPath(new URL("./shims/is-in-ci.js", import.meta.url)),
      // Node-only SQLite storage — stubbed out of the browser bundle (this demo is in-memory).
      "@effect/sql-sqlite-node/SqliteClient": fileURLToPath(new URL("./shims/sqlite-node-stub.js", import.meta.url)),
      "@effect/sql-sqlite-node": fileURLToPath(new URL("./shims/sqlite-node-stub.js", import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5176,
    allowedHosts: true,
    // The browser is a thin client; proxy each node's RPC so the client is same-origin (no CORS).
    // `/rpc` → WnbaNode, `/live` → LiveNode, `/stats` → StatsNode (all from server.ts).
    proxy: {
      "/rpc": { target: "http://localhost:7780", changeOrigin: true },
      "/live": {
        target: "http://localhost:7781",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live/, ""),
      },
      "/stats": {
        target: "http://localhost:7782",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/stats/, ""),
      },
    },
  },
});
