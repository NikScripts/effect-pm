import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Documentation dev server — bind all interfaces for Tailscale / LAN phone access.
 * No RPC backends; static HTML + optional future React shell.
 */
export default defineConfig({
  root,
  publicDir: "public",
  plugins: [tailwindcss()],
  server: {
    host: true,
    port: Number(process.env.DOCS_PORT ?? 5190),
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: Number(process.env.DOCS_PORT ?? 5190),
    strictPort: false,
  },
});
