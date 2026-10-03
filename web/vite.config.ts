import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Standalone UI dev (`npm --prefix web run dev`) proxies to the backend.
    proxy: {
      "/api": "http://localhost:5717",
      "/images": "http://localhost:5717",
    },
  },
});
