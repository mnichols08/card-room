// Solid's JSX checks tag names; these are the Zubra elements this page uses. Each takes its
// properties with `prop:` and its events with `on:`, plus the usual attributes.
import "solid-js";


type ZubraElement = import("solid-js").JSX.HTMLAttributes<HTMLElement> & { [key: `prop:${string}`]: unknown; [key: `on:${string}`]: ((event: CustomEvent) => void) | undefined; slot?: string };

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "action-button": ZubraElement;
      "alert-banner": ZubraElement;
      "auto-grid": ZubraElement;
      "cluster-layout": ZubraElement;
      "content-card": ZubraElement;
      "empty-state": ZubraElement;
      "loading-spinner": ZubraElement;
      "segmented-control": ZubraElement;
      "select-field": ZubraElement;
      "status-badge": ZubraElement;
      "toast-region": ZubraElement;
      "user-avatar": ZubraElement;
    }
  }
}
