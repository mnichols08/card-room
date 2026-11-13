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

## Bots

Two kinds, both playing only from what a seat can see:

- **`botAction`**: quick rules of thumb. Used inside the thinking bot's simulations.
- **`smartAction`**: the thinking bot, used at every table. From its own hand, every card played
  this hand (`state.played`), the bids and the score, it works out what it can't see (who has
  shown they're out of which suit, which cards are still out), deals those cards many ways that
  fit, trusts deals more when they match each player's bid, plays each of its options to the end
  of the hand in every deal, and plays the one that scores best for its team. Partnership comes
  from the scoring: trumping a partner's winner or letting a partner's nil get set loses points.

How it measures up, against the quick bots (`npx tsx scripts/match.ts <games> <deals>`):

| Games | Thinking team won | Card decision |
| --- | --- | --- |
| 20 | 17 (85%) | ~12 ms, slowest ~100 ms |
| 60 | 48 (80%) | ~12 ms |
| 60, bid reading on | 54 (90%) | ~12 ms |
| 60, bid reading off | 51 (85%) | ~12 ms |

## Table talk

`talk.ts` gives bots a personality: who they are, what they say, and how long they think. It's
pure, so the server and the practice table share it.

- **Personas**: fourteen partners, each with a voice (warm, dry, goofy, sharp, quiet, nervous or
  dramatic) and lines of their own, a tempo, and a **play style**: `skill` (how many hands they
  imagine), `sloppy` (chance of a careless card), `bold` (over- or underbidding) and `nilLove`.
  Empty seats get a random one (`pickPersonas`). Any other bot name gets a friendly default.

| Partner | Style | vs. quick bots | Nil bids | Avg bid |
| --- | --- | --- | --- | --- |
| Dot | warm, steady | 7/10 | 2% | 2.3 |
| Hank | grumbles, fast, good | 8/10 | 2% | 2.3 |
| Lou | jokes, overbids a little | 7/10 | 2% | 2.7 |
| Bea | competitive, careful | 6/10 | 2% | 2.4 |
| Maggie | counts every card | 7/10 | 2% | 2.3 |
| Earl | bids low, hates nil | 4/10 | 1% | 2.0 |
| Tammy | loves nil | 9/10 | 13% | 2.6 |
| Junior | still learning, careless | 8/20 | 2% | 2.5 |
| Pearl | sweet and sharp | 10/10 | 2% | 2.4 |
| Duke | bids big, goes blind | 12/20 | 15% | 3.6 |
| Ruthie | hates bags | 5/10 | 1% | 2.3 |
| Skeeter | goofball, fast and loose | 14/20 | 2% | 2.8 |
| Vern | quiet, very good | 13/20 | 2% | 2.4 |
| Gigi | dramatic, plays by feel | 13/20 | 2% | 2.4 |

(`npx tsx scripts/roster.ts <games> [names]`. Ten or twenty games is noisy: bidding habits show
clearly, card-play differences only at the extremes.)
- **`reactToMove(before, after, cast)`**: bids of nil and blind nil, an ace trumped, spades broken, a
  flashy trick, nils made and set, a team set, and the end of the game. At most two bots speak
  about one move, staggered; at the end of the game everyone speaks, graciously.
- **`replyTo(text, fromSeat, cast)`**: laughter, luck, thanks, hearts and oops each get an answer
  from one bot: the one named, or the speaker's partner first.
- **`greet(cast)`**: a hello or two when the game starts.
- **`thinkingTime(state, seat, name)`**: quick for a forced card, a few seconds for a bid, and
  longer when the best two options scored close together, at the persona's tempo.
