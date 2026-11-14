// The fixture with no framework: the custom elements, driven by the DOM. This is the baseline the
// framework pages are measured against.
import "@spades/ui/bid-pad.zb";
import "@spades/ui/playing-card.zb";
import "@spades/ui/seat-badge.zb";
import "@spades/ui/zubra-ui/action-button.zb";
import "@spades/ui/zubra-ui/alert-banner.zb";
import "@spades/ui/zubra-ui/data-table.zb";
import "@spades/ui/zubra-ui/empty-state.zb";
import "@spades/ui/zubra-ui/modal-dialog.zb";
import "@spades/ui/zubra-ui/segmented-control.zb";
import "@spades/ui/zubra-ui/stack-layout.zb";
import "@spades/ui/zubra-ui/status-badge.zb";
import "@spades/ui/zubra-ui/tab-list.zb";
import "@spades/ui/zubra-ui/text-field.zb";
import "@spades/ui/zubra-ui/toggle-switch.zb";
import { CARDS, COLUMNS, EXTRA_ROW, ITEMS, ROWS, SEGMENTS, TABS, VARIANTS } from "../shared/fixture";
import "../shared/styles.css";

type Props = Record<string, unknown>;
/** An element with attributes (strings), properties (anything else) and children. */
function el(tag: string, props: Props = {}, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value as EventListener);
    else if (key.startsWith("data-") || key === "slot") node.setAttribute(key, String(value));
    else (node as unknown as Props)[key] = value;
  }
  node.append(...children);
  return node;
}
const t = (name: string) => document.querySelector<HTMLElement>(`[data-t="${name}"]`)!;
const button = (name: string, label: string, onclick: () => void) => el("button", { "data-t": name, type: "button", onclick }, label);
const output = (name: string, text = "") => el("output", { "data-t": name }, text);
const section = (title: string, ...children: Node[]) => el("section", {}, el("h2", {}, title), ...children);
const detail = <T>(event: Event) => (event as CustomEvent<T>).detail;

let variant = 0;
let count = 0;
let emptyClicks = 0;
let confirms = 0;
let rows = ROWS;
let card = 0;
let picks = 0;
let items = [...ITEMS];
let name = "";

const set = (target: string, key: string, value: unknown) => ((t(target) as unknown as Props)[key] = value);
const show = (target: string, text: unknown) => (t(target).textContent = String(text));

function setName(next: string) {
  name = next;
  set("name", "value", name);
  show("name-out", name);
  show("dialog-body", name);
  set("seat", "name", name || "Nobody");
  // The dialog's third button is there only for Grammi.
  const extra = document.querySelector('[data-t="dialog-extra"]');
  if (name === "Grammi" && !extra) t("dialog").append(el("action-button", { slot: "actions", "data-t": "dialog-extra", variant: "outline" }, "For Grammi"));
  else if (name !== "Grammi") extra?.remove();
}

function drawItems() {
  t("list").replaceChildren(...items.map((item) => el("status-badge", { "data-item": item }, item)));
}

function temp(): HTMLElement {
  return el("toggle-switch", { "data-t": "temp", label: "Comes and goes", oncheckedchange: (e: Event) => show("temp-out", detail<boolean>(e) ? "on" : "off") });
}

document.getElementById("app")!.append(
  el(
    "main",
    {},
    section(
      "Props",
      el("status-badge", { "data-t": "badge", variant: VARIANTS[0] }, "Status"),
      button("cycle", "Next variant", () => set("badge", "variant", VARIANTS[++variant % VARIANTS.length])),
      el("status-badge", { "data-t": "count-badge" }, "0"),
      el("status-badge", { "data-t": "wrapped" }, el("span", { "data-t": "wrapped-inner" }, "0")),
      button("inc", "Count", () => {
        count++;
        show("count-badge", count);
        show("wrapped-inner", count);
        set("seat", "tricks", count);
        show("tab-count", count);
      }),
    ),
    section(
      "Events",
      el("segmented-control", { "data-t": "seg", label: "Letters", options: SEGMENTS, value: "a", onvaluechange: (e: Event) => show("seg-out", detail<string>(e)) }),
      output("seg-out", "a"),
      button("seg-set", "Set Gamma", () => {
        set("seg", "value", "c");
        show("seg-out", "c");
      }),
    ),
    section(
      "Two-way",
      el("text-field", { "data-t": "name", label: "Name", value: "", onvaluechange: (e: Event) => setName(detail<string>(e)) }),
      output("name-out"),
      button("name-set", "Set Grammi", () => setName("Grammi")),
      el("toggle-switch", { "data-t": "toggle", label: "Sound", checked: false, oncheckedchange: (e: Event) => show("toggle-out", detail<boolean>(e) ? "on" : "off") }),
      output("toggle-out", "off"),
      button("toggle-off", "Switch off", () => {
        set("toggle", "checked", false);
        show("toggle-out", "off");
      }),
    ),
    section(
      "Slots",
      el(
        "empty-state",
        { "data-t": "empty", heading: "Nothing yet" },
        el("span", {}, "Body text"),
        el("action-button", { slot: "actions", "data-t": "empty-action", onclick: () => show("empty-out", ++emptyClicks) }, "Do it"),
      ),
      output("empty-out", "0"),
      el("alert-banner", { "data-t": "alert", heading: "Heads up" }, el("span", { "data-t": "alert-msg" }, "Nothing more")),
      button("alert-more", "More", () => {
        const there = document.querySelectorAll('[data-t="alert-extra"], [data-t="alert-action"], [data-t="alert-action-2"]');
        if (there.length) there.forEach((node) => node.remove());
        else
          t("alert").append(
            el("span", { "data-t": "alert-extra" }, " and extra"),
            el("action-button", { slot: "actions", "data-t": "alert-action", size: "sm" }, "Act"),
            el("action-button", { slot: "actions", "data-t": "alert-action-2", size: "sm", variant: "outline" }, "Skip"),
          );
        show("alert-msg", there.length ? "Nothing more" : "Something more");
      }),
    ),
    section(
      "Dialog",
      button("open", "Open", () => {
        set("dialog", "open", true);
        show("dialog-out", "open");
      }),
      output("dialog-out", "closed"),
      output("confirm-out", "0"),
      el(
        "modal-dialog",
        { "data-t": "dialog", label: "Sure?", onopenchange: (e: Event) => show("dialog-out", detail<boolean>(e) ? "open" : "closed") },
        el("p", { "data-t": "dialog-body" }, ""),
        el("action-button", { slot: "actions", "data-t": "dialog-cancel", variant: "outline", "data-close": "" }, "Cancel"),
        el(
          "action-button",
          {
            slot: "actions",
            "data-t": "dialog-ok",
            onclick: () => {
              show("confirm-out", ++confirms);
              set("dialog", "open", false);
              show("dialog-out", "closed");
            },
          },
          "OK",
        ),
      ),
    ),
    section(
      "Lists",
      el("stack-layout", { "data-t": "list", gap: "0.25rem" }),
      button("add", "Add", () => {
        items = [...items, `item ${items.length + 1}`];
        drawItems();
      }),
      button("remove-first", "Remove first", () => {
        items = items.slice(1);
        drawItems();
      }),
    ),
    section(
      "Table",
      el("data-table", { "data-t": "table", label: "Players", columns: COLUMNS, rows, selectable: true, filterable: false, selected: [], onselectedchange: (e: Event) => show("table-out", detail<string[]>(e).join(",")) }),
      output("table-out"),
      button("table-select", "Select first and last", () => {
        set("table", "selected", ["r1", "r3"]);
        show("table-out", "r1,r3");
      }),
      button("table-add", "Add a row", () => {
        rows = [...ROWS, EXTRA_ROW];
        set("table", "rows", rows);
      }),
    ),
    section(
      "Tabs",
      el(
        "tab-list",
        { "data-t": "tabs", label: "Tabs", tabs: TABS, value: "one", onvaluechange: (e: Event) => show("tab-out", detail<string>(e)) },
        el("section", { "data-tab": "one" }, "First panel ", el("span", { "data-t": "tab-count" }, "0")),
        el("section", { "data-tab": "two" }, "Second panel"),
      ),
      output("tab-out", "one"),
      button("tab-set", "Back to One", () => {
        set("tabs", "value", "one");
        show("tab-out", "one");
      }),
    ),
    section(
      "The card room's own",
      el("playing-card", { "data-t": "card", card: CARDS[0], playable: true, onpick: () => show("card-out", ++picks) }),
      output("card-out", "0"),
      button("card-next", "Next card", () => set("card", "card", CARDS[++card % CARDS.length])),
      el("seat-badge", { "data-t": "seat", name: "Nobody", tricks: 0, active: true }),
      el("bid-pad", { "data-t": "bid", onbid: (e: Event) => show("bid-out", detail<number | string>(e)) }),
      output("bid-out"),
    ),
    section(
      "Coming and going",
      el("span", { "data-t": "temp-home" }, temp()),
      output("temp-out", "off"),
      button("remount", "Take away / bring back", () => {
        const home = t("temp-home");
        if (home.firstChild) home.replaceChildren();
        else home.append(temp());
        show("temp-out", "off");
      }),
    ),
  ),
);
drawItems();
