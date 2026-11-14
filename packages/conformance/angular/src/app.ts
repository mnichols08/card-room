// The fixture in Angular: the custom elements' tags (CUSTOM_ELEMENTS_SCHEMA), properties with
// [prop], events with (event), and `zubraModel` for ngModel.
//
// It is written the way an Angular template naturally is, with no workarounds: text straight
// from {{ }} in a slot, and slotted elements inside @if. Where that doesn't work, the tests say so
// (see KNOWN in tests/conformance.spec.ts).
import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ZubraModel } from "@zubra/runtime/angular";
import { CARDS, COLUMNS, EXTRA_ROW, ITEMS, ROWS, SEGMENTS, TABS, VARIANTS } from "../../src/shared/fixture";
import "./zubra";

@Component({
  selector: "app-root",
  imports: [FormsModule, ZubraModel],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <section>
        <h2>Props</h2>
        <status-badge data-t="badge" [variant]="VARIANTS[variant() % VARIANTS.length]">Status</status-badge>
        <button data-t="cycle" type="button" (click)="variant.set(variant() + 1)">Next variant</button>
        <status-badge data-t="count-badge">{{ count() }}</status-badge>
        <status-badge data-t="wrapped"><span data-t="wrapped-inner">{{ count() }}</span></status-badge>
        <button data-t="inc" type="button" (click)="count.set(count() + 1)">Count</button>
      </section>

      <section>
        <h2>Events</h2>
        <segmented-control data-t="seg" label="Letters" [options]="SEGMENTS" [value]="seg()" (valuechange)="seg.set(detail($event))"></segmented-control>
        <output data-t="seg-out">{{ seg() }}</output>
        <button data-t="seg-set" type="button" (click)="seg.set('c')">Set Gamma</button>
      </section>

      <section>
        <h2>Two-way</h2>
        <text-field data-t="name" label="Name" zubraModel [ngModel]="name()" (ngModelChange)="name.set($event)"></text-field>
        <output data-t="name-out">{{ name() }}</output>
        <button data-t="name-set" type="button" (click)="name.set('Grammi')">Set Grammi</button>
        <toggle-switch data-t="toggle" label="Sound" [checked]="on()" (checkedchange)="on.set(detail($event))"></toggle-switch>
        <output data-t="toggle-out">{{ on() ? "on" : "off" }}</output>
        <button data-t="toggle-off" type="button" (click)="on.set(false)">Switch off</button>
      </section>

      <section>
        <h2>Slots</h2>
        <empty-state data-t="empty" heading="Nothing yet">
          <span>Body text</span>
          <action-button slot="actions" data-t="empty-action" (click)="emptyClicks.set(emptyClicks() + 1)">Do it</action-button>
        </empty-state>
        <output data-t="empty-out">{{ emptyClicks() }}</output>
        <alert-banner data-t="alert" heading="Heads up">
          <span data-t="alert-msg">{{ more() ? "Something more" : "Nothing more" }}</span>
          @if (more()) {
            <span data-t="alert-extra"> and extra</span>
            <action-button slot="actions" data-t="alert-action" size="sm">Act</action-button>
            <action-button slot="actions" data-t="alert-action-2" size="sm" variant="outline">Skip</action-button>
          }
        </alert-banner>
        <button data-t="alert-more" type="button" (click)="more.set(!more())">More</button>
      </section>

      <section>
        <h2>Dialog</h2>
        <button data-t="open" type="button" (click)="open.set(true)">Open</button>
        <output data-t="dialog-out">{{ open() ? "open" : "closed" }}</output>
        <output data-t="confirm-out">{{ confirms() }}</output>
        <modal-dialog data-t="dialog" label="Sure?" [open]="open()" (openchange)="open.set(detail($event))">
          <p data-t="dialog-body">{{ name() }}</p>
          <action-button slot="actions" data-t="dialog-cancel" variant="outline" data-close>Cancel</action-button>
          <action-button slot="actions" data-t="dialog-ok" (click)="confirm()">OK</action-button>
          @if (name() === "Grammi") {
            <action-button slot="actions" data-t="dialog-extra" variant="outline">For Grammi</action-button>
          }
        </modal-dialog>
      </section>

      <section>
        <h2>Lists</h2>
        <stack-layout data-t="list" gap="0.25rem">
          @for (item of items(); track item + "-" + $index) {
            <status-badge [attr.data-item]="item">{{ item }}</status-badge>
          }
        </stack-layout>
        <button data-t="add" type="button" (click)="items.set(items().concat('item ' + (items().length + 1)))">Add</button>
        <button data-t="remove-first" type="button" (click)="items.set(items().slice(1))">Remove first</button>
      </section>

      <section>
        <h2>Table</h2>
        <data-table
          data-t="table"
          label="Players"
          [columns]="COLUMNS"
          [rows]="rows()"
          [selectable]="true"
          [filterable]="false"
          [selected]="selected()"
          (selectedchange)="selected.set(detail($event))"
        ></data-table>
        <output data-t="table-out">{{ selected().join(",") }}</output>
        <button data-t="table-select" type="button" (click)="selected.set(['r1', 'r3'])">Select first and last</button>
        <button data-t="table-add" type="button" (click)="rows.set(ROWS.concat(EXTRA_ROW))">Add a row</button>
      </section>

      <section>
        <h2>Tabs</h2>
        <tab-list data-t="tabs" label="Tabs" [tabs]="TABS" [value]="tab()" (valuechange)="tab.set(detail($event))">
          <section data-tab="one">First panel <span data-t="tab-count">{{ count() }}</span></section>
          <section data-tab="two">Second panel</section>
        </tab-list>
        <output data-t="tab-out">{{ tab() }}</output>
        <button data-t="tab-set" type="button" (click)="tab.set('one')">Back to One</button>
      </section>

      <section>
        <h2>The card room's own</h2>
        <playing-card data-t="card" [card]="CARDS[card() % CARDS.length]" [playable]="true" (pick)="picks.set(picks() + 1)"></playing-card>
        <output data-t="card-out">{{ picks() }}</output>
        <button data-t="card-next" type="button" (click)="card.set(card() + 1)">Next card</button>
        <seat-badge data-t="seat" [name]="name() || 'Nobody'" [tricks]="count()" [active]="true"></seat-badge>
        <bid-pad data-t="bid" (bid)="bid.set('' + detail($event))"></bid-pad>
        <output data-t="bid-out">{{ bid() }}</output>
      </section>

      <section>
        <h2>Coming and going</h2>
        <span data-t="temp-home">
          @if (temp()) {
            <toggle-switch data-t="temp" label="Comes and goes" [checked]="tempOn()" (checkedchange)="tempOn.set(detail($event))"></toggle-switch>
          }
        </span>
        <output data-t="temp-out">{{ tempOn() ? "on" : "off" }}</output>
        <button data-t="remount" type="button" (click)="remount()">Take away / bring back</button>
      </section>
    </main>
  `,
})
export class App {
  protected readonly VARIANTS = VARIANTS;
  protected readonly SEGMENTS = SEGMENTS;
  protected readonly TABS = TABS;
  protected readonly COLUMNS = COLUMNS;
  protected readonly ROWS = ROWS;
  protected readonly EXTRA_ROW = EXTRA_ROW;
  protected readonly CARDS = CARDS;

  protected readonly variant = signal(0);
  protected readonly count = signal(0);
  protected readonly seg = signal("a");
  protected readonly name = signal("");
  protected readonly on = signal(false);
  protected readonly emptyClicks = signal(0);
  protected readonly more = signal(false);
  protected readonly open = signal(false);
  protected readonly confirms = signal(0);
  protected readonly items = signal([...ITEMS]);
  protected readonly rows = signal(ROWS);
  protected readonly selected = signal<string[]>([]);
  protected readonly tab = signal("one");
  protected readonly card = signal(0);
  protected readonly picks = signal(0);
  protected readonly bid = signal("");
  protected readonly temp = signal(true);
  protected readonly tempOn = signal(false);

  /** A Zubra component's event carries its news in `detail`. */
  protected detail<T>(event: Event): T {
    return (event as CustomEvent<T>).detail;
  }

  protected confirm(): void {
    this.confirms.update((n) => n + 1);
    this.open.set(false);
  }

  protected remount(): void {
    this.temp.update((shown) => !shown);
    this.tempOn.set(false);
  }
}
