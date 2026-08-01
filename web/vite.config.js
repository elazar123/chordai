import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.CHORDAI_API || "http://localhost:5178";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    // Proxy keeps the browser on one origin in dev, so audio playback, uploads
    // and SSE all behave exactly as they do in production.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/audio": { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
