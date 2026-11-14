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
the tests show what a newcomer would hit.

## Known differences

`KNOWN` in `tests/conformance.spec.ts` lists the checks that fail today, each with the Zubra issue
it was reported in. Those are expected to fail, so the run is green. When Zubra fixes one, its
check passes, the run goes red with "Expected to fail, but passed", and the entry comes out of the
list (and any workaround for it out of the card room's apps).

| Check | Fails in | Issue |
| --- | --- | --- |
| Text the page fills in shows in a slot | Angular | [zubra#261](https://github.com/journey-to-code-org/zubra/issues/261) |
| | Solid | [zubra#268](https://github.com/journey-to-code-org/zubra/issues/268) |
| Elements for different slots that arrive together each go to their slot | Angular, Solid | [zubra#262](https://github.com/journey-to-code-org/zubra/issues/262) |
| An element the page puts in a slot stays the page's own | plain elements, React, Vue, Svelte, Solid | [zubra#267](https://github.com/journey-to-code-org/zubra/issues/267) |
| Elements taken away again are gone from every slot | Vue, Svelte, Solid | [zubra#269](https://github.com/journey-to-code-org/zubra/issues/269) |

Until they're fixed, in the card room's own apps:

- Wrap text a framework fills in in an element, and not a `<span>` inside a component whose own
  root is a `<span>` (`status-badge`).
- Keep `slot="…"` elements in the template from the start: show and hide them (`hidden`) instead
  of adding and removing them.

## Adding a check

Add what it needs to all six pages (same `data-t` names), then one `check(...)` in the spec. If a
framework fails it, report it upstream and add it to `KNOWN` with the link.
