import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Mini docs site on hyperlink-ts Router. Port kept off docs Waku (:5190) + other apps. */
export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  server: {
    // 0.0.0.0 — reachable over Tailscale / LAN (same as apps/web + dashboard).
    host: true,
    port: 5189,
    strictPort: true,
    // Vite 6 blocks unknown Host headers (403). MagicDNS names need this.
    allowedHosts: true,
  },
});
