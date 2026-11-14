<!--
  The fixture in Vue. A .zb import in a .vue file is a Vue component: props in, Vue events out,
  v-model for every <prop> + <prop>change pair, children into the slots.
-->
<script setup lang="ts">
import BidPad from "@spades/ui/bid-pad.zb";
import PlayingCard from "@spades/ui/playing-card.zb";
import SeatBadge from "@spades/ui/seat-badge.zb";
import ActionButton from "@spades/ui/zubra-ui/action-button.zb";
import AlertBanner from "@spades/ui/zubra-ui/alert-banner.zb";
import DataTable from "@spades/ui/zubra-ui/data-table.zb";
import EmptyState from "@spades/ui/zubra-ui/empty-state.zb";
import ModalDialog from "@spades/ui/zubra-ui/modal-dialog.zb";
import SegmentedControl from "@spades/ui/zubra-ui/segmented-control.zb";
import StackLayout from "@spades/ui/zubra-ui/stack-layout.zb";
import StatusBadge from "@spades/ui/zubra-ui/status-badge.zb";
import TabList from "@spades/ui/zubra-ui/tab-list.zb";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import ToggleSwitch from "@spades/ui/zubra-ui/toggle-switch.zb";
import { ref } from "vue";
import { CARDS, COLUMNS, EXTRA_ROW, ITEMS, ROWS, SEGMENTS, TABS, VARIANTS } from "../shared/fixture";

const variant = ref(0);
const count = ref(0);
const seg = ref("a");
const name = ref("");
const on = ref(false);
const emptyClicks = ref(0);
const more = ref(false);
const open = ref(false);
const confirms = ref(0);
const items = ref([...ITEMS]);
const rows = ref(ROWS);
const selected = ref<string[]>([]);
const tab = ref("one");
const card = ref(0);
const picks = ref(0);
const bid = ref("");
const temp = ref(true);
const tempOn = ref(false);

function confirm() {
  confirms.value++;
  open.value = false;
}
function remount() {
  temp.value = !temp.value;
  tempOn.value = false;
}
</script>

<template>
  <main>
    <section>
      <h2>Props</h2>
      <StatusBadge data-t="badge" :variant="VARIANTS[variant % VARIANTS.length]">Status</StatusBadge>
      <button data-t="cycle" type="button" @click="variant++">Next variant</button>
      <StatusBadge data-t="count-badge">{{ count }}</StatusBadge>
      <StatusBadge data-t="wrapped"><span data-t="wrapped-inner">{{ count }}</span></StatusBadge>
      <button data-t="inc" type="button" @click="count++">Count</button>
    </section>

    <section>
      <h2>Events</h2>
      <SegmentedControl data-t="seg" label="Letters" :options="SEGMENTS" :value="seg" @valuechange="seg = $event.detail" />
      <output data-t="seg-out">{{ seg }}</output>
      <button data-t="seg-set" type="button" @click="seg = 'c'">Set Gamma</button>
    </section>

    <section>
      <h2>Two-way</h2>
      <TextField v-model="name" data-t="name" label="Name" />
      <output data-t="name-out">{{ name }}</output>
      <button data-t="name-set" type="button" @click="name = 'Grammi'">Set Grammi</button>
      <ToggleSwitch v-model:checked="on" data-t="toggle" label="Sound" />
      <output data-t="toggle-out">{{ on ? "on" : "off" }}</output>
      <button data-t="toggle-off" type="button" @click="on = false">Switch off</button>
    </section>

    <section>
      <h2>Slots</h2>
      <EmptyState data-t="empty" heading="Nothing yet">
        <span>Body text</span>
        <ActionButton slot="actions" data-t="empty-action" @click="emptyClicks++">Do it</ActionButton>
      </EmptyState>
      <output data-t="empty-out">{{ emptyClicks }}</output>
      <AlertBanner data-t="alert" heading="Heads up">
        <span data-t="alert-msg">{{ more ? "Something more" : "Nothing more" }}</span>
        <template v-if="more">
          <span data-t="alert-extra"> and extra</span>
          <ActionButton slot="actions" data-t="alert-action" size="sm">Act</ActionButton>
          <ActionButton slot="actions" data-t="alert-action-2" size="sm" variant="outline">Skip</ActionButton>
        </template>
      </AlertBanner>
      <button data-t="alert-more" type="button" @click="more = !more">More</button>
    </section>

    <section>
      <h2>Dialog</h2>
      <button data-t="open" type="button" @click="open = true">Open</button>
      <output data-t="dialog-out">{{ open ? "open" : "closed" }}</output>
      <output data-t="confirm-out">{{ confirms }}</output>
      <ModalDialog v-model:open="open" data-t="dialog" label="Sure?">
        <p data-t="dialog-body">{{ name }}</p>
        <ActionButton slot="actions" data-t="dialog-cancel" variant="outline" data-close>Cancel</ActionButton>
        <ActionButton slot="actions" data-t="dialog-ok" @click="confirm">OK</ActionButton>
        <ActionButton v-if="name === 'Grammi'" slot="actions" data-t="dialog-extra" variant="outline">For Grammi</ActionButton>
      </ModalDialog>
    </section>

    <section>
      <h2>Lists</h2>
      <StackLayout data-t="list" gap="0.25rem">
        <StatusBadge v-for="(item, i) in items" :key="`${item}-${i}`" :data-item="item">{{ item }}</StatusBadge>
      </StackLayout>
      <button data-t="add" type="button" @click="items = [...items, `item ${items.length + 1}`]">Add</button>
      <button data-t="remove-first" type="button" @click="items = items.slice(1)">Remove first</button>
    </section>

    <section>
      <h2>Table</h2>
      <DataTable v-model:selected="selected" data-t="table" label="Players" :columns="COLUMNS" :rows="rows" :selectable="true" :filterable="false" />
      <output data-t="table-out">{{ selected.join(",") }}</output>
      <button data-t="table-select" type="button" @click="selected = ['r1', 'r3']">Select first and last</button>
      <button data-t="table-add" type="button" @click="rows = [...ROWS, EXTRA_ROW]">Add a row</button>
    </section>

    <section>
      <h2>Tabs</h2>
      <TabList v-model="tab" data-t="tabs" label="Tabs" :tabs="TABS">
        <section data-tab="one">First panel <span data-t="tab-count">{{ count }}</span></section>
        <section data-tab="two">Second panel</section>
      </TabList>
      <output data-t="tab-out">{{ tab }}</output>
      <button data-t="tab-set" type="button" @click="tab = 'one'">Back to One</button>
    </section>

    <section>
      <h2>The card room's own</h2>
      <PlayingCard data-t="card" :card="CARDS[card % CARDS.length]" :playable="true" @pick="picks++" />
      <output data-t="card-out">{{ picks }}</output>
      <button data-t="card-next" type="button" @click="card++">Next card</button>
      <SeatBadge data-t="seat" :name="name || 'Nobody'" :tricks="count" :active="true" />
      <BidPad data-t="bid" @bid="bid = String($event.detail)" />
      <output data-t="bid-out">{{ bid }}</output>
    </section>

    <section>
      <h2>Coming and going</h2>
      <span data-t="temp-home"><ToggleSwitch v-if="temp" v-model:checked="tempOn" data-t="temp" label="Comes and goes" /></span>
      <output data-t="temp-out">{{ tempOn ? "on" : "off" }}</output>
      <button data-t="remount" type="button" @click="remount">Take away / bring back</button>
    </section>
  </main>
</template>
