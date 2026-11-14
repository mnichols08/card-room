// The pages import components for what they are in each framework; the typings Zubra writes are
// off here (several frameworks share the folder), so an import is loosely typed.
declare module "*.zb" {
  const component: any;
  export default component;
}
declare module "*.zb?element" {
  const element: CustomElementConstructor;
  export default element;
}
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}
