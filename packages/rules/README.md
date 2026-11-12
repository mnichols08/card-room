# @spades/rules

Pure, deterministic spades rules engine. No I/O — the server and the UI both call into it.

Every house rule is a field on a `RulePreset`, so tables can play by whatever rules
the house saved. Built-ins: `classic`, `jokersAndDeuces`, `quick250`, plus
`brokennilsTable` (Classic with blind nil on).

```ts
import { newGame, applyAction, viewFor, brokennilsTable } from "@spades/rules";

let game = newGame(brokennilsTable, seed);
game = applyAction(game, { type: "bid", seat: game.turn, bid: { kind: "blind-nil" } });
// ...
const whatSeat2Sees = viewFor(game, 2); // other hands are hidden
```

- `applyAction` throws `RuleError` with a player-friendly message for anything illegal.
- Shuffles are seeded, so any game can be replayed from its seed and action log.
- The preset is snapshotted onto the game, so editing a house preset never changes a game in progress.

| Preset option | What it controls |
| --- | --- |
| `trump` | `ace-high`, or `jokers-and-deuces` (BJ > LJ > 2♦ > 2♠ > A♠, 2♣/2♥ removed) |
| `spadesMustBeBroken` | Whether spades can be led before one is played |
| `nil` | On/off and point value |
| `nilTricksCountTowardBid` | Whether a nil bidder's tricks help the partner's bid (otherwise they're bags) |
| `blindNil` | On/off, value, only-when-down-by, cards passed with partner |
| `bags` | Limit and penalty, or `null` for no penalty |
| `playTo` / `loseAt` | Game end |
| `minTeamBid` | Minimum combined bid for a team |
