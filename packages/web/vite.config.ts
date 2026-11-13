import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import zubra from "@zubra/unplugin/vite";
import { defineConfig } from "vite";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Served from https://<user>.github.io/spades/ on GitHub Pages.
  base: process.env.BASE_PATH ?? "/",
  // In .tsx files, a .zb import is a typed React component: props in, on<Event> handlers out.
  plugins: [zubra(), react()],
  resolve: {
    alias: {
      "@spades/rules": local("../rules/src/index.ts"),
      "@spades/ui": local("../ui/src"),
    },
  },
});
