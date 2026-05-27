import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  server: {
    port: 5173,
    proxy: {
      "/api/control": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/control/, ""),
      },
    },
  },
});
