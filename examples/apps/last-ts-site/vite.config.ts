import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** last.ts demo site — not Hyperlink docs. Port off Waku (:5190). */
export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  server: {
    host: true,
    port: 5220,
    strictPort: true,
    allowedHosts: true,
  },
});
