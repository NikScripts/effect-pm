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
  },
});
