import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Bound to 0.0.0.0 so it's reachable over Tailscale from another device.
// The queues run client-side; a couple of Node-only transitive deps (CI/colour
// detection) are stubbed for the browser bundle.
export default defineConfig({
  plugins: [react()],
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
