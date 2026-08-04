import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  server: {
    host: true,
    port: 5192,
    strictPort: true,
  },
});
