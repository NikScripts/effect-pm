import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Port kept off docs Waku (:5190) and the other example apps (:5177, :5189).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5195,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      // The browser talks to whatever origin it loaded the page from (e.g. a
      // Tailscale IP on a phone) — `127.0.0.1:4096` from client.ts would mean
      // "the phone itself" there, and opencode's own server only binds to
      // loopback by default anyway. Proxying through this (already
      // network-reachable) dev server means opencode never has to be exposed
      // to the network directly.
      "/opencode": {
        target: "http://127.0.0.1:4096",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opencode/, ""),
      },
    },
  },
});
