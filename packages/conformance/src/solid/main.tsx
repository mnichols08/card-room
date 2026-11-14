/* @jsxImportSource solid-js */
// The fixture in Solid: the custom elements' tags, properties with prop:, events with on:.
import { For, Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { CARDS, COLUMNS, EXTRA_ROW, ITEMS, ROWS, SEGMENTS, TABS, VARIANTS } from "../shared/fixture";
import "./zubra";
import "../shared/styles.css";

function App() {
  const [variant, setVariant] = createSignal(0);
  const [count, setCount] = createSignal(0);
  const [seg, setSeg] = createSignal("a");
  const [name, setName] = createSignal("");
  const [on, setOn] = createSignal(false);
  const [emptyClicks, setEmptyClicks] = createSignal(0);
  const [more, setMore] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [confirms, setConfirms] = createSignal(0);
  const [items, setItems] = createSignal([...ITEMS]);
  const [rows, setRows] = createSignal(ROWS);
  const [selected, setSelected] = createSignal<string[]>([]);
  const [tab, setTab] = createSignal("one");
  const [card, setCard] = createSignal(0);
  const [picks, setPicks] = createSignal(0);
  const [bid, setBid] = createSignal("");
  const [temp, setTemp] = createSignal(true);
  const [tempOn, setTempOn] = createSignal(false);

  return (
    <main>
      <section>
        <h2>Props</h2>
        <status-badge data-t="badge" prop:variant={VARIANTS[variant() % VARIANTS.length]}>
          Status
        </status-badge>
        <button data-t="cycle" type="button" onClick={() => setVariant(variant() + 1)}>
          Next variant
        </button>
        <status-badge data-t="count-badge">{count()}</status-badge>
        <status-badge data-t="wrapped">
          <span data-t="wrapped-inner">{count()}</span>
        </status-badge>
        <button data-t="inc" type="button" onClick={() => setCount(count() + 1)}>
          Count
        </button>
      </section>

      <section>
        <h2>Events</h2>
        <segmented-control data-t="seg" prop:label="Letters" prop:options={SEGMENTS} prop:value={seg()} on:valuechange={(e: CustomEvent<string>) => setSeg(e.detail)} />
        <output data-t="seg-out">{seg()}</output>
        <button data-t="seg-set" type="button" onClick={() => setSeg("c")}>
          Set Gamma
        </button>
      </section>

      <section>
        <h2>Two-way</h2>
        <text-field data-t="name" prop:label="Name" prop:value={name()} on:valuechange={(e: CustomEvent<string>) => setName(e.detail)} />
        <output data-t="name-out">{name()}</output>
        <button data-t="name-set" type="button" onClick={() => setName("Grammi")}>
          Set Grammi
        </button>
        <toggle-switch data-t="toggle" prop:label="Sound" prop:checked={on()} on:checkedchange={(e: CustomEvent<boolean>) => setOn(e.detail)} />
        <output data-t="toggle-out">{on() ? "on" : "off"}</output>
        <button data-t="toggle-off" type="button" onClick={() => setOn(false)}>
          Switch off
        </button>
      </section>

      <section>
        <h2>Slots</h2>
        <empty-state data-t="empty" prop:heading="Nothing yet">
          <span>Body text</span>
          <action-button slot="actions" data-t="empty-action" on:click={() => setEmptyClicks(emptyClicks() + 1)}>
            Do it
          </action-button>
        </empty-state>
        <output data-t="empty-out">{emptyClicks()}</output>
        <alert-banner data-t="alert" prop:heading="Heads up">
          <span data-t="alert-msg">{more() ? "Something more" : "Nothing more"}</span>
          <Show when={more()}>
            <span data-t="alert-extra"> and extra</span>
            <action-button slot="actions" data-t="alert-action" prop:size="sm">
              Act
            </action-button>
            <action-button slot="actions" data-t="alert-action-2" prop:size="sm" prop:variant="outline">
              Skip
            </action-button>
          </Show>
        </alert-banner>
        <button data-t="alert-more" type="button" onClick={() => setMore(!more())}>
          More
        </button>
      </section>

      <section>
        <h2>Dialog</h2>
        <button data-t="open" type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <output data-t="dialog-out">{open() ? "open" : "closed"}</output>
        <output data-t="confirm-out">{confirms()}</output>
        <modal-dialog data-t="dialog" prop:label="Sure?" prop:open={open()} on:openchange={(e: CustomEvent<boolean>) => setOpen(e.detail)}>
          <p data-t="dialog-body">{name()}</p>
          <action-button slot="actions" data-t="dialog-cancel" prop:variant="outline" data-close="">
            Cancel
          </action-button>
          <action-button
            slot="actions"
            data-t="dialog-ok"
            on:click={() => {
              setConfirms(confirms() + 1);
              setOpen(false);
            }}
          >
            OK
          </action-button>
          <Show when={name() === "Grammi"}>
            <action-button slot="actions" data-t="dialog-extra" prop:variant="outline">
              For Grammi
            </action-button>
          </Show>
        </modal-dialog>
      </section>

      <section>
        <h2>Lists</h2>
        <stack-layout data-t="list" prop:gap="0.25rem">
          <For each={items()}>{(item) => <status-badge attr:data-item={item}>{item}</status-badge>}</For>
        </stack-layout>
        <button data-t="add" type="button" onClick={() => setItems([...items(), `item ${items().length + 1}`])}>
          Add
        </button>
        <button data-t="remove-first" type="button" onClick={() => setItems(items().slice(1))}>
          Remove first
        </button>
      </section>

      <section>
        <h2>Table</h2>
        <data-table
          data-t="table"
          prop:label="Players"
          prop:columns={COLUMNS}
          prop:rows={rows()}
          prop:selectable={true}
          prop:filterable={false}
          prop:selected={selected()}
          on:selectedchange={(e: CustomEvent<string[]>) => setSelected(e.detail)}
        />
        <output data-t="table-out">{selected().join(",")}</output>
        <button data-t="table-select" type="button" onClick={() => setSelected(["r1", "r3"])}>
          Select first and last
        </button>
        <button data-t="table-add" type="button" onClick={() => setRows([...ROWS, EXTRA_ROW])}>
          Add a row
        </button>
      </section>

      <section>
        <h2>Tabs</h2>
        <tab-list data-t="tabs" prop:label="Tabs" prop:tabs={TABS} prop:value={tab()} on:valuechange={(e: CustomEvent<string>) => setTab(e.detail)}>
          <section data-tab="one">
            First panel <span data-t="tab-count">{count()}</span>
          </section>
          <section data-tab="two">Second panel</section>
        </tab-list>
        <output data-t="tab-out">{tab()}</output>
        <button data-t="tab-set" type="button" onClick={() => setTab("one")}>
          Back to One
        </button>
      </section>

      <section>
        <h2>The card room's own</h2>
        <playing-card data-t="card" prop:card={CARDS[card() % CARDS.length]} prop:playable={true} on:pick={() => setPicks(picks() + 1)} />
        <output data-t="card-out">{picks()}</output>
        <button data-t="card-next" type="button" onClick={() => setCard(card() + 1)}>
          Next card
        </button>
        <seat-badge data-t="seat" prop:name={name() || "Nobody"} prop:tricks={count()} prop:active={true} />
        <bid-pad data-t="bid" on:bid={(e: CustomEvent<number | string>) => setBid(String(e.detail))} />
        <output data-t="bid-out">{bid()}</output>
      </section>

      <section>
        <h2>Coming and going</h2>
        <span data-t="temp-home">
          <Show when={temp()}>
            <toggle-switch data-t="temp" prop:label="Comes and goes" prop:checked={tempOn()} on:checkedchange={(e: CustomEvent<boolean>) => setTempOn(e.detail)} />
          </Show>
        </span>
        <output data-t="temp-out">{tempOn() ? "on" : "off"}</output>
        <button
          data-t="remount"
          type="button"
          onClick={() => {
            setTemp(!temp());
            setTempOn(false);
          }}
        >
          Take away / bring back
        </button>
      </section>
    </main>
  );
}

render(() => <App />, document.getElementById("app")!);
