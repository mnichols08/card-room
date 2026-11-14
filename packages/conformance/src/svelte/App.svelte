<!-- The fixture in Svelte: the custom elements' tags, properties set by name, events as on<event>. -->
<script lang="ts">
  import { CARDS, COLUMNS, EXTRA_ROW, ITEMS, ROWS, SEGMENTS, TABS, VARIANTS } from "../shared/fixture";

  let variant = $state(0);
  let count = $state(0);
  let seg = $state("a");
  let name = $state("");
  let on = $state(false);
  let emptyClicks = $state(0);
  let more = $state(false);
  let open = $state(false);
  let confirms = $state(0);
  let items = $state([...ITEMS]);
  let rows = $state(ROWS);
  let selected = $state<string[]>([]);
  let tab = $state("one");
  let card = $state(0);
  let picks = $state(0);
  let bid = $state("");
  let temp = $state(true);
  let tempOn = $state(false);

  type News<T> = CustomEvent<T>;
</script>

<main>
  <section>
    <h2>Props</h2>
    <status-badge data-t="badge" variant={VARIANTS[variant % VARIANTS.length]}>Status</status-badge>
    <button data-t="cycle" type="button" onclick={() => variant++}>Next variant</button>
    <status-badge data-t="count-badge">{count}</status-badge>
    <status-badge data-t="wrapped"><span data-t="wrapped-inner">{count}</span></status-badge>
    <button data-t="inc" type="button" onclick={() => count++}>Count</button>
  </section>

  <section>
    <h2>Events</h2>
    <segmented-control data-t="seg" label="Letters" options={SEGMENTS} value={seg} onvaluechange={(e: News<string>) => (seg = e.detail)}></segmented-control>
    <output data-t="seg-out">{seg}</output>
    <button data-t="seg-set" type="button" onclick={() => (seg = "c")}>Set Gamma</button>
  </section>

  <section>
    <h2>Two-way</h2>
    <text-field data-t="name" label="Name" value={name} onvaluechange={(e: News<string>) => (name = e.detail)}></text-field>
    <output data-t="name-out">{name}</output>
    <button data-t="name-set" type="button" onclick={() => (name = "Grammi")}>Set Grammi</button>
    <toggle-switch data-t="toggle" label="Sound" checked={on} oncheckedchange={(e: News<boolean>) => (on = e.detail)}></toggle-switch>
    <output data-t="toggle-out">{on ? "on" : "off"}</output>
    <button data-t="toggle-off" type="button" onclick={() => (on = false)}>Switch off</button>
  </section>

  <section>
    <h2>Slots</h2>
    <empty-state data-t="empty" heading="Nothing yet">
      <span>Body text</span>
      <action-button slot="actions" data-t="empty-action" onclick={() => emptyClicks++}>Do it</action-button>
    </empty-state>
    <output data-t="empty-out">{emptyClicks}</output>
    <alert-banner data-t="alert" heading="Heads up">
      <span data-t="alert-msg">{more ? "Something more" : "Nothing more"}</span>
      {#if more}
        <span data-t="alert-extra"> and extra</span>
        <action-button slot="actions" data-t="alert-action" size="sm">Act</action-button>
        <action-button slot="actions" data-t="alert-action-2" size="sm" variant="outline">Skip</action-button>
      {/if}
    </alert-banner>
    <button data-t="alert-more" type="button" onclick={() => (more = !more)}>More</button>
  </section>

  <section>
    <h2>Dialog</h2>
    <button data-t="open" type="button" onclick={() => (open = true)}>Open</button>
    <output data-t="dialog-out">{open ? "open" : "closed"}</output>
    <output data-t="confirm-out">{confirms}</output>
    <modal-dialog data-t="dialog" label="Sure?" {open} onopenchange={(e: News<boolean>) => (open = e.detail)}>
      <p data-t="dialog-body">{name}</p>
      <action-button slot="actions" data-t="dialog-cancel" variant="outline" data-close>Cancel</action-button>
      <action-button
        slot="actions"
        data-t="dialog-ok"
        onclick={() => {
          confirms++;
          open = false;
        }}>OK</action-button
      >
      {#if name === "Grammi"}
        <action-button slot="actions" data-t="dialog-extra" variant="outline">For Grammi</action-button>
      {/if}
    </modal-dialog>
  </section>

  <section>
    <h2>Lists</h2>
    <stack-layout data-t="list" gap="0.25rem">
      {#each items as item, i (`${item}-${i}`)}
        <status-badge data-item={item}>{item}</status-badge>
      {/each}
    </stack-layout>
    <button data-t="add" type="button" onclick={() => (items = [...items, `item ${items.length + 1}`])}>Add</button>
    <button data-t="remove-first" type="button" onclick={() => (items = items.slice(1))}>Remove first</button>
  </section>

  <section>
    <h2>Table</h2>
    <data-table data-t="table" label="Players" columns={COLUMNS} {rows} selectable={true} filterable={false} {selected} onselectedchange={(e: News<string[]>) => (selected = e.detail)}></data-table>
    <output data-t="table-out">{selected.join(",")}</output>
    <button data-t="table-select" type="button" onclick={() => (selected = ["r1", "r3"])}>Select first and last</button>
    <button data-t="table-add" type="button" onclick={() => (rows = [...ROWS, EXTRA_ROW])}>Add a row</button>
  </section>

  <section>
    <h2>Tabs</h2>
    <tab-list data-t="tabs" label="Tabs" tabs={TABS} value={tab} onvaluechange={(e: News<string>) => (tab = e.detail)}>
      <section data-tab="one">First panel <span data-t="tab-count">{count}</span></section>
      <section data-tab="two">Second panel</section>
    </tab-list>
    <output data-t="tab-out">{tab}</output>
    <button data-t="tab-set" type="button" onclick={() => (tab = "one")}>Back to One</button>
  </section>

  <section>
    <h2>The card room's own</h2>
    <playing-card data-t="card" card={CARDS[card % CARDS.length]} playable={true} onpick={() => picks++}></playing-card>
    <output data-t="card-out">{picks}</output>
    <button data-t="card-next" type="button" onclick={() => card++}>Next card</button>
    <seat-badge data-t="seat" name={name || "Nobody"} tricks={count} active={true}></seat-badge>
    <bid-pad data-t="bid" onbid={(e: News<number | string>) => (bid = String(e.detail))}></bid-pad>
    <output data-t="bid-out">{bid}</output>
  </section>

  <section>
    <h2>Coming and going</h2>
    <span data-t="temp-home">
      {#if temp}
        <toggle-switch data-t="temp" label="Comes and goes" checked={tempOn} oncheckedchange={(e: News<boolean>) => (tempOn = e.detail)}></toggle-switch>
      {/if}
    </span>
    <output data-t="temp-out">{tempOn ? "on" : "off"}</output>
    <button
      data-t="remount"
      type="button"
      onclick={() => {
        temp = !temp;
        tempOn = false;
      }}>Take away / bring back</button
    >
  </section>
</main>
