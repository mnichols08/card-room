import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Svelte can't see inside a custom element, so a click handler on <action-button> looks like
    // one on a bare <div>. It isn't: the element renders a native <button>, and its click bubbles.
    warningFilter: (warning) => !((warning.code === "a11y_click_events_have_key_events" || warning.code === "a11y_no_static_element_interactions") && warning.message.includes("<action-button>")),
  },
};
