import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Bound to 0.0.0.0 so it's reachable over Tailscale from another device.
// The queues run client-side; a Node-only transitive dep (CI detection) is stubbed
// for the browser bundle. Tailwind v4 via the official Vite plugin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: import.meta.dirname,
  resolve: {
    alias: {
      "is-in-ci": fileURLToPath(new URL("./shims/is-in-ci.js", import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5175,
    allowedHosts: true,
    // the browser is a thin client; the queues run on the Node server (queue-server.ts).
    // proxy the RPC paths to it so the client is same-origin (no CORS).
    proxy: {
      "/rpc": { target: "http://localhost:7777", changeOrigin: true },
    },
  },
});
