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
  },
});
