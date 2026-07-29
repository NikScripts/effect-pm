import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Mini docs site on hyperlink-ts Router. Port kept off docs Waku (:5190) + other apps. */
export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  server: {
    host: true,
    port: 5189,
    strictPort: true,
  },
});
