# Zubra conformance

One fixture of Zubra components, written six times (plain elements, React, Vue, Svelte, Solid,
Angular), and one set of browser tests run against all six. A check that passes in five and fails
in the sixth is a difference in how the components behave in that framework.

```sh
npm run build -w @cardroom/conformance        # the six pages
npm run conformance -w @cardroom/conformance  # 18 checks × 6 frameworks, in Chrome
npm run dev -w @cardroom/conformance          # http://localhost:4179/react/ and friends (not Angular)
```

## What's checked

Each page shows the same components, wired to the same buttons and outputs (`data-t` names), from
`src/shared/fixture.ts`:

| | Components |
| --- | --- |
| Props in: strings, numbers, booleans, lists, objects | `status-badge`, `segmented-control`, `data-table`, `playing-card`, `seat-badge` |
| Events out | `segmented-control`, `bid-pad`, `playing-card`, `action-button` |
| Two-way binding | `text-field`, `toggle-switch`, `modal-dialog`, `tab-list`, `data-table` |
| Slots: static text, text the page fills in, the page's own elements, named slots, elements that arrive and leave later, lists | `status-badge`, `empty-state`, `alert-banner`, `modal-dialog`, `stack-layout`, `tab-list` |
| Coming and going | `toggle-switch` taken off the page and put back |

Every check also fails if the page logged an error.

How each framework gets the components:

| Page | A `.zb` import is |
| --- | --- |
| `src/element` | the custom element, driven by DOM calls: the baseline |
| `src/react` | a React component (`@zubra/unplugin`) |
| `src/vue` | a Vue component (`@zubra/unplugin`) |
| `src/svelte` | the custom element; Svelte uses its tag |
| `src/solid` | the custom element (`?element`); JSX uses its tag with `prop:` and `on:` |
| `angular` | the custom element, compiled ahead by `zubra build --lib`; templates use its tag |

The pages are written the way each framework's templates naturally are, with no workarounds, so
the tests show what a newcomer would hit. They import the components loosely typed; the card
room's apps are where the typings Zubra writes are checked.

## Known differences

None today: all 18 checks pass in all six frameworks on Zubra 5.15.0.

`KNOWN` in `tests/conformance.spec.ts` is where a difference goes when one turns up: the check's
title and the Zubra issue it was reported in. A listed check is expected to fail, so the run stays
green. When Zubra fixes it, the check passes, the run goes red with "Expected to fail, but
passed", and the entry comes out (with any workaround in the card room's apps).

The first run of this suite, on Zubra 5.9, found five (zubra#261, #262, #267, #268, #269) and a
gap in the typings (#270). All were fixed in 5.15.0, and the workarounds they needed are gone from
the admin app and the card room.

## Adding a check

Add what it needs to all six pages (same `data-t` names), then one `check(...)` in the spec. If a
framework fails it, report it upstream and add it to `KNOWN` with the link.
