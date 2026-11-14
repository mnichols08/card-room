# @spades/ui

The table's components, written in [Zubra](https://github.com/journey-to-code-org/zubra) as `.zb` files.
Each one compiles to a standard custom element, so the same source runs in the React app
(`packages/web`, through `@zubra/unplugin`) and, next, as plain HTML in the open.blog embed.

| Component | What it is | Events |
| --- | --- | --- |
| `playing-card` | A card, a joker or a card back | `pick` |
| `seat-badge` | A player's name, bid and tricks | |
| `score-board` | Both teams' scores and bags | `leave` |
| `bid-pad` | Choosing a bid, including blind nil before looking | `bid`, `look` |
| `hand-summary` | How a hand scored | `next` |

`playing-card` wears a deck's design through the `--deck-*` CSS variables (`deckVars` in
`packages/decks`): set them on the card or anything around it. Without them it's the card room's
own deck.

`zubra-ui/` holds components copied from [zubra-ui](https://github.com/journey-to-code-org/zubra-ui),
and its default theme (`zubra-ui/themes/`). They're ours to edit; each file says which commit it
came from. The card room's setup screens use the text field, select field and toggle switch; the
card designer and the admin app are built from the rest: buttons, tabs, data tables, dialogs,
toasts, alerts, badges, stat cards, content cards, swatches, sliders, the flip card and the layout
helpers.

## One source, four frameworks

| App | Framework | How it gets the components |
| --- | --- | --- |
| `packages/web` | React, and Vue for the game chooser | `@zubra/unplugin`: a `.zb` import is a React or Vue component |
| `packages/designer` | Svelte | `@zubra/unplugin`: a `.zb` import defines the custom element, and Svelte uses the tag |
| `packages/admin` | Angular | `zubra build --lib` compiles this folder to custom elements before `ng build`; templates use the tags (`CUSTOM_ELEMENTS_SCHEMA`), with `zubraModel` from `@zubra/runtime/angular` for `ngModel` |

Two things to know when the tags are used directly in Angular (both are worked around in
`packages/admin/src/app/app.html`, where the comments say so):

- Text that Angular fills in (`{{ … }}`) as a component's direct child doesn't show: Angular
  creates the text node empty, and an empty text node isn't slotted. Wrap it in an element.
- A `slot="…"` element that arrives after its component has started (inside an `@if`) can land in
  the default slot. Keep such elements in the template from the start.

Theming uses shadcn/ui's variable names (`--primary`, `--destructive`, `--muted-foreground`,
`--border`), plus `--team-us`, `--team-them` and `--table-ink` for the table.

The components render in light DOM, so page CSS reaches them. Don't give their insides class
names a page is likely to use (`playing-card` uses `data-size`, not a `.table` class, for this reason).
