import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Served from https://<user>.github.io/spades/ on GitHub Pages.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  resolve: {
    alias: { "@spades/rules": fileURLToPath(new URL("../rules/src/index.ts", import.meta.url)) },
  },
});
