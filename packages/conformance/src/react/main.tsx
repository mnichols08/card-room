// The fixture in React. A .zb import in a .tsx file is a React component: props in, on<Event>
// handlers out, children into the slots.
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
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CARDS, COLUMNS, EXTRA_ROW, ITEMS, ROWS, SEGMENTS, TABS, VARIANTS } from "../shared/fixture";
import "../shared/styles.css";

function App() {
  const [variant, setVariant] = useState(0);
  const [count, setCount] = useState(0);
  const [seg, setSeg] = useState("a");
  const [name, setName] = useState("");
  const [on, setOn] = useState(false);
  const [emptyClicks, setEmptyClicks] = useState(0);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirms, setConfirms] = useState(0);
  const [items, setItems] = useState(ITEMS);
  const [rows, setRows] = useState(ROWS);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState("one");
  const [card, setCard] = useState(0);
  const [picks, setPicks] = useState(0);
  const [bid, setBid] = useState("");
  const [temp, setTemp] = useState(true);
  const [tempOn, setTempOn] = useState(false);

  return (
    <main>
      <section>
        <h2>Props</h2>
        <StatusBadge data-t="badge" variant={VARIANTS[variant % VARIANTS.length]}>
          Status
        </StatusBadge>
        <button data-t="cycle" type="button" onClick={() => setVariant(variant + 1)}>
          Next variant
        </button>
        <StatusBadge data-t="count-badge">{count}</StatusBadge>
        <StatusBadge data-t="wrapped">
          <span data-t="wrapped-inner">{count}</span>
        </StatusBadge>
        <button data-t="inc" type="button" onClick={() => setCount(count + 1)}>
          Count
        </button>
      </section>

      <section>
        <h2>Events</h2>
        <SegmentedControl data-t="seg" label="Letters" options={SEGMENTS} value={seg} onValueChange={(e: CustomEvent<string>) => setSeg(e.detail)} />
        <output data-t="seg-out">{seg}</output>
        <button data-t="seg-set" type="button" onClick={() => setSeg("c")}>
          Set Gamma
        </button>
      </section>

      <section>
        <h2>Two-way</h2>
        <TextField data-t="name" label="Name" value={name} onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />
        <output data-t="name-out">{name}</output>
        <button data-t="name-set" type="button" onClick={() => setName("Grammi")}>
          Set Grammi
        </button>
        <ToggleSwitch data-t="toggle" label="Sound" checked={on} onCheckedChange={(e: CustomEvent<boolean>) => setOn(e.detail)} />
        <output data-t="toggle-out">{on ? "on" : "off"}</output>
        <button data-t="toggle-off" type="button" onClick={() => setOn(false)}>
          Switch off
        </button>
      </section>

      <section>
        <h2>Slots</h2>
        <EmptyState data-t="empty" heading="Nothing yet">
          <span>Body text</span>
          <ActionButton slot="actions" data-t="empty-action" onClick={() => setEmptyClicks((n) => n + 1)}>
            Do it
          </ActionButton>
        </EmptyState>
        <output data-t="empty-out">{emptyClicks}</output>
        <AlertBanner data-t="alert" heading="Heads up">
          <span data-t="alert-msg">{more ? "Something more" : "Nothing more"}</span>
          {more && (
            <>
              <span data-t="alert-extra"> and extra</span>
              <ActionButton slot="actions" data-t="alert-action" size="sm">
                Act
              </ActionButton>
              <ActionButton slot="actions" data-t="alert-action-2" size="sm" variant="outline">
                Skip
              </ActionButton>
            </>
          )}
        </AlertBanner>
        <button data-t="alert-more" type="button" onClick={() => setMore(!more)}>
          More
        </button>
      </section>

      <section>
        <h2>Dialog</h2>
        <button data-t="open" type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <output data-t="dialog-out">{open ? "open" : "closed"}</output>
        <output data-t="confirm-out">{confirms}</output>
        <ModalDialog data-t="dialog" label="Sure?" open={open} onOpenChange={(e: CustomEvent<boolean>) => setOpen(e.detail)}>
          <p data-t="dialog-body">{name}</p>
          <ActionButton slot="actions" data-t="dialog-cancel" variant="outline" data-close="">
            Cancel
          </ActionButton>
          <ActionButton
            slot="actions"
            data-t="dialog-ok"
            onClick={() => {
              setConfirms((n) => n + 1);
              setOpen(false);
            }}
          >
            OK
          </ActionButton>
          {name === "Grammi" && (
            <ActionButton slot="actions" data-t="dialog-extra" variant="outline">
              For Grammi
            </ActionButton>
          )}
        </ModalDialog>
      </section>

      <section>
        <h2>Lists</h2>
        <StackLayout data-t="list" gap="0.25rem">
          {items.map((item, i) => (
            <StatusBadge key={`${item}-${i}`} data-item={item}>
              {item}
            </StatusBadge>
          ))}
        </StackLayout>
        <button data-t="add" type="button" onClick={() => setItems([...items, `item ${items.length + 1}`])}>
          Add
        </button>
        <button data-t="remove-first" type="button" onClick={() => setItems(items.slice(1))}>
          Remove first
        </button>
      </section>

      <section>
        <h2>Table</h2>
        <DataTable data-t="table" label="Players" columns={COLUMNS} rows={rows} selectable filterable={false} selected={selected} onSelectedChange={(e: CustomEvent<string[]>) => setSelected(e.detail)} />
        <output data-t="table-out">{selected.join(",")}</output>
        <button data-t="table-select" type="button" onClick={() => setSelected(["r1", "r3"])}>
          Select first and last
        </button>
        <button data-t="table-add" type="button" onClick={() => setRows([...ROWS, EXTRA_ROW])}>
          Add a row
        </button>
      </section>

      <section>
        <h2>Tabs</h2>
        <TabList data-t="tabs" label="Tabs" tabs={TABS} value={tab} onValueChange={(e: CustomEvent<string>) => setTab(e.detail)}>
          <section data-tab="one">
            First panel <span data-t="tab-count">{count}</span>
          </section>
          <section data-tab="two">Second panel</section>
        </TabList>
        <output data-t="tab-out">{tab}</output>
        <button data-t="tab-set" type="button" onClick={() => setTab("one")}>
          Back to One
        </button>
      </section>

      <section>
        <h2>The card room's own</h2>
        <PlayingCard data-t="card" card={CARDS[card % CARDS.length]} playable onPick={() => setPicks((n) => n + 1)} />
        <output data-t="card-out">{picks}</output>
        <button data-t="card-next" type="button" onClick={() => setCard(card + 1)}>
          Next card
        </button>
        <SeatBadge data-t="seat" name={name || "Nobody"} tricks={count} active />
        <BidPad data-t="bid" onBid={(e: CustomEvent<number | string>) => setBid(String(e.detail))} />
        <output data-t="bid-out">{bid}</output>
      </section>

      <section>
        <h2>Coming and going</h2>
        <span data-t="temp-home">{temp && <ToggleSwitch data-t="temp" label="Comes and goes" checked={tempOn} onCheckedChange={(e: CustomEvent<boolean>) => setTempOn(e.detail)} />}</span>
        <output data-t="temp-out">{tempOn ? "on" : "off"}</output>
        <button
          data-t="remount"
          type="button"
          onClick={() => {
            setTemp(!temp);
            setTempOn(false);
          }}
        >
          Take away / bring back
        </button>
      </section>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
