import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import zubra from "@zubra/unplugin/vite";
import { defineConfig } from "vite";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // The card room serves the designer at /designer/; the GitHub Pages build sets its own base.
  base: process.env.BASE_PATH ?? "/designer/",
  // In a Svelte project a .zb import is the custom element itself: Svelte sets its properties and
  // listens to its events as it does for any element, so there's no wrapper. The typings go in this
  // app's own folder, since the components are shared with apps in other frameworks.
  plugins: [zubra({ dts: { dir: ".zubra/types" } }), svelte()],
  // `npm run dev -w @spades/server` serves the designs on 8787.
  server: { port: 5174, proxy: { "/designs": "http://localhost:8787" } },
  resolve: {
    alias: {
      // From source, like the card room's app: the Pages build doesn't build the other packages first.
      "@cardroom/decks": local("../decks/src/index.ts"),
      "@spades/ui": local("../ui/src"),
    },
  },
});
