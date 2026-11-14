import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  // A click handler on a custom element that renders its own <button> isn't a bare <div>.
  compilerOptions: { warningFilter: (warning) => !warning.code.startsWith("a11y_") },
};
