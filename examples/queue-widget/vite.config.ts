import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// No proxy / server: the queue runs client-side in the browser. The RPC-backed
// client layer (out of scope) would later point at a real server runtime.
export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  server: { port: 5174 },
});
