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

`zubra-ui/` holds components copied from [zubra-ui](https://github.com/journey-to-code-org/zubra-ui)
(text field, select field, toggle switch). They're ours to edit; each file says which commit it came from.

Theming uses shadcn/ui's variable names (`--primary`, `--destructive`, `--muted-foreground`,
`--border`), plus `--team-us`, `--team-them` and `--table-ink` for the table.

The components render in light DOM, so page CSS reaches them. Don't give their insides class
names a page is likely to use (`playing-card` uses `data-size`, not a `.table` class, for this reason).
