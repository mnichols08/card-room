import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import zubra from "@zubra/unplugin/vite";
import { defineConfig } from "vite";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Served from https://<user>.github.io/spades/ on GitHub Pages.
  base: process.env.BASE_PATH ?? "/",
  // In .tsx files, a .zb import is a typed React component: props in, on<Event> handlers out.
  // The start page's game picker is a Vue island inside the React app: in a .vue file, a .zb import
  // is a Vue component (Zubra's Vue adapter), so the same components serve both frameworks.
  plugins: [zubra(), react(), vue()],
  // `npm run dev -w @spades/server` serves the rooms and the sync log on 8787.
  server: { proxy: Object.fromEntries(["/rooms", "/_zb", "/houses", "/challenges", "/push"].map((p) => [p, "http://localhost:8787"])) },
  resolve: {
    alias: {
      "@spades/rules": local("../rules/src/index.ts"),
      // From source, like the rules: the Pages build doesn't build the other packages first.
      "@cardroom/palace": local("../palace/src/index.ts"),
      "@cardroom/games": local("../games/src/index.ts"),
      "@spades/ui": local("../ui/src"),
      "@spades/rooms/client": local("../rooms/src/client.ts"),
      "@spades/rooms/server": local("../rooms/src/server.ts"),
    },
  },
});
