import { fileURLToPath } from "node:url";
import zubra from "@zubra/unplugin/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  // The card room serves this page at /watch/; the GitHub Pages build sets its own base.
  base: process.env.BASE_PATH ?? "/watch/",
  // In a Solid project a .zb import is the custom element itself: Solid sets its properties
  // (prop:) and listens to its events (on:) as it does for any element. The typings (which teach
  // Solid's JSX the tags) go in this app's own folder, since the components are shared with apps
  // in other frameworks.
  plugins: [zubra({ dts: { dir: ".zubra/types" } }), solid()],
  // `npm run dev -w @spades/server` serves the tables on 8787.
  server: { port: 5176, proxy: { "/spectate": "http://localhost:8787", "/catalogue": "http://localhost:8787" } },
  resolve: { alias: { "@spades/ui": fileURLToPath(new URL("../ui/src", import.meta.url)) } },
});
