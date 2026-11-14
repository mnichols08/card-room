import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import zubra from "@zubra/unplugin/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const page = (name: string) => local(`./${name}/index.html`);

// One build, a page per framework. Zubra decides what a .zb import is by the file that imports it:
// a React component in .tsx, a Vue component in .vue, the custom element anywhere else. Solid's
// .tsx files ask for the element by name (`?element`), since their JSX isn't React's.
export default defineConfig({
  base: "/",
  plugins: [zubra({ dts: false }), react({ include: /src\/react\/.*\.tsx$/ }), solid({ include: /src\/solid\/.*\.tsx$/ }), vue(), svelte()],
  resolve: { alias: { "@spades/ui": local("../ui/src") } },
  build: { rollupOptions: { input: { element: page("element"), react: page("react"), vue: page("vue"), svelte: page("svelte"), solid: page("solid") } } },
  server: { port: 4179 },
  preview: { port: 4179, strictPort: true },
});
