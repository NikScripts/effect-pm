import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Vision prototype — no backend. Port kept off hyperlink-web (:5177). */
export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  server: {
    host: true,
    port: 5188,
    strictPort: true,
  },
});
