// @zubra/unplugin 5.9.1 ships no typings for its Vite entry. Remove once it does.
declare module "@zubra/unplugin/vite" {
  import type { Plugin } from "vite";
  export default function zubra(options?: Record<string, unknown>): Plugin;
}
