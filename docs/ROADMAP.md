# Roadmap: beyond cards

Card Room has the card games covered. This is the plan for the next kinds of game: board games,
dice, tiles and words first, then games with a ball in them (mini golf, billiards, bowling).

The rule that got us this far still holds: **one PR per game**, and a game isn't done until it has
house-rule presets, computer players at every skill and pace, tests, sounds, a tile on the front
page, and works in houses, challenges, tournaments and practice.

## Where we start from

What already carries over to any game, untouched:

- `packages/rooms`: seats, server-decided moves, private per-seat views, bots, chat, the move log.
  Nothing in it knows what a card is.
- Houses, presets, challenges, leaderboards, single-elimination tournaments, push notifications.
- The engine shape in `packages/games/src/kit.ts`: a pure, deterministic
  `newGame / apply / view / bot / thinkingTime / summary` with presets and rule fields.
- Seats that all move at once (`turn: null`) and races (`reactionTime`), from Speed and Slapjack.

What is card-shaped and has to grow:

- `KitView` describes a hand, a centre, melds and tricks. A chessboard doesn't fit in it.
  (`center.kind: "board"` exists, but it is a grid of cards for Memory.)
- `KitTable.tsx` draws that one shape. `KitGameId`, `CardGame` and the home page's card-fan tiles
  all assume cards.
- Rooms have no clocks: nothing happens unless a seat or a bot moves.
- Bots think on the server's one thread, inside a `setTimeout`. Fine for Hearts; not for chess.

## Phase 0: foundations

Each of these is its own PR, and each lands just ahead of the first game that needs it.

- [ ] **Split the engine contract from the card view.** Pull the game-agnostic part of `CardGame`
      (id, seats, presets, fields, `normalize`, `validate`, `describe`, `newGame`, `apply`, `bot`,
      `thinkingTime`, `reactionTime`, `summary`) into a `TableGame<R, S, M, View>`. `CardGame`
      becomes `TableGame<…, KitView>`. The server's `kitRoom` already only calls those methods, so
      it serves every kind of game once `view` is generic.
- [ ] **A board kit** (`packages/boards`): `BoardGame = TableGame<…, BoardView>`, and one
      `BoardTable` screen that draws any `BoardView`, the way `KitTable` draws any `KitView`.
      A first sketch of what a seat sees:
      - `grid`: rows, columns, cell shading, and the pieces on it (kind, owner, a label or glyph)
      - `tap`: cells you can tap now; or `from → to` pairs for pick-up-and-put-down moves
      - `last`: the cells the last move touched, for highlighting and animation
      - `reserve`: pieces off the board per side (captured men, stones in hand, a tile rack)
      - `dice`, `choices`, `info`, `narration`, `scores`, `result`, `over`: as in `KitView`
      - a second, private grid for games with hidden boards (Combat)
- [ ] **The shared kit tests, for boards.** `test/kit.test.ts` plays every registered card game
      with bots at every table size and preset. The same harness should run every board game.
- [ ] **Offers.** Resign, offer a draw, ask to take a move back. One mechanic in the board kit,
      since nearly every two-player game wants it.
- [ ] **Clocks and deadlines in rooms.** `RoomDefinition.deadline?(state)` returning a time and
      the move to apply when it passes. That gives chess clocks, a turn timer for any table, and
      "a day per move" games, with a push notification when it's your move.
- [ ] **Bots off the main thread.** A worker pool with a time budget per move, so a chess or Go
      bot searching can't stall every other table. Practice games get the same thing as a Web
      Worker.
- [ ] **The front page.** With forty-odd games it needs sections (Cards, Boards, Dice, Tiles,
      Table sports), search, and tiles that aren't a fan of three cards.
- [ ] **A new name.** "Card Room" stops describing it, so the app gets a name that fits a whole
      game room (see open questions). The rename touches the app, the manifest, the embed's
      element name (keep `<card-room>` working) and the docs; the database file keeps its name.
- [ ] **Our own game names.** Several of the games below are sold under trademarked names, so
      they ship under ours, as Fruit Salad did: Drop Four, Combat, Yacht, Criss-Crosswords.

## Phase 1: grid games

Small engines, strong bots are cheap, and together they prove the board kit.

| # | Game | Players | House rules to offer | Computer player | Size |
| --- | --- | --- | --- | --- | --- |
| 1 | Tic-Tac-Toe | 2 | 3×3, Ultimate, bigger boards with N in a row (Gomoku falls out of this) | Perfect at 3×3, dialled down by skill | S |
| 2 | Drop Four | 2 | 7×6, larger boards, pop-out, five in a row; drinking mode with a shot clock | Alpha-beta, depth by skill | S |
| 3 | Reversi | 2 | Board size, who starts | Alpha-beta with corner and edge weights | S |
| 4 | Checkers | 2 | American 8×8, International 10×10 with flying kings, Russian; forced captures on or off | Alpha-beta | M |
| 5 | Combat | 2, later 3 to 4 | Fleet, ships may touch or not, salvo (a shot per ship afloat) | Hunt and target, parity search at higher skill | M |

Tic-Tac-Toe goes first: it is the smallest thing that exercises the contract split, `BoardView`,
`BoardTable`, the board test harness and a front-page tile. Combat is the first board game
with hidden information and a placing phase where both seats move at once, which the rooms
already support.

**Drop Four's shot clock** (drinking mode, using the kit's existing `drinkingField`): you have
three seconds to drop a piece after your opponent does. Miss it and you drink and lose your turn.
It is the first use of room deadlines, so Drop Four ships without it if deadlines aren't in yet,
and the shot clock follows as its own PR. Three seconds has to be fair over a slow connection:
the clock starts when your browser shows the opponent's piece, with a little grace on the server.

## Phase 2: dice

| # | Game | Players | House rules to offer | Computer player | Size |
| --- | --- | --- | --- | --- | --- |
| 6 | Yacht | 1 to 6 | Yacht or Yatzy scorecards, bonus rules, everyone rolls at once or in turn; **Shotzee** drinking mode | Expected-value play, sloppier at low skill | S |
| 7 | Backgammon | 2 | Doubling cube, match to N points with the Crawford rule, Jacoby; later Nackgammon and Acey-Deucey | Pip count, blots, primes and anchors | M |

Dice come from the game's seeded random source on the server, like a deal. This phase adds a
shared `dice` piece to the views and the table (roll animation, sound, haptics).

**Shotzee** is Yacht with drinking mode on, and the table takes that name when it is: roll five
of a kind and everyone else at the table takes a shot; scratch a zero on your scorecard and you
drink.

## Phase 3: chess and Go

The two that need Phase 0's clocks, offers and worker bots.

| # | Game | What it takes | Size |
| --- | --- | --- | --- |
| 8 | Chess | Full rules (castling, en passant, promotion, threefold repetition, fifty moves, insufficient material). Clocks: blitz, rapid, a day per move. Move list in standard notation, step back through a finished game. Our own alpha-beta engine; skill sets depth and how often it blunders. Chess960 as a preset later. | L |
| 9 | Go (Weiqi, Baduk) | 9×9, 13×13, 19×19. Chinese (area) scoring first, since it scores itself; Japanese (territory) after, with a phase where both players mark dead stones. Komi, handicap stones, superko. Monte Carlo bot: decent on 9×9, honest about being weak on 19×19. | L |

"A day per move" games are where tournaments "played over days" and the installed app's
notifications pay off for board games.

## Phase 4: tiles and words

| # | Game | Players | Notes | Size |
| --- | --- | --- | --- | --- |
| 10 | Mahjong Shanghai | 1; 2 to 4 racing the same deal | The tile-matching solitaire on stacked layouts. Builds the tile set and tile art Riichi uses. Deals are checked solvable. Several layouts, as presets. | M |
| 11 | Mahjong Riichi | 4, then 3 (Sanma) | The four-player game: wall, draws and discards, chi, pon, kan, calls out of turn, winning-hand detection, then yaku, riichi, dora and furiten in a scoring module of their own. The most played online and the most rules. | L |
| 12 | Criss-Crosswords | 2 to 4 | A crossword tile game on our own board layout and letter values. Needs a freely usable word list (ENABLE is the usual one; check its terms before shipping). House rules: challenges or automatic checking, time per turn. Bot: move generator with a vocabulary that grows with skill. | L |

Riichi is built so the table rules (wall, calls, hand detection) sit apart from the scoring. If
other styles are wanted later (Hong Kong, Sichuan, Taiwanese, American), each is a scoring module
and a preset on the same core.

Mahjong hands sit in a rack and melds on the table, which is closer to the card kit than the
board kit. Decide at #11 whether tiles become another card kind in `KitView` (as fruit cards did)
or get their own view. Calls out of turn (anyone may claim a discard) need a short claim window,
which uses room deadlines again.

## Phase 5: table sports

Mini golf, billiards and bowling in the spirit of the old Candystand games, with a family at the
table. Our own courses, tables and art.

The plan is to keep these **turn-based on the same rooms**, so no new netcode:

- A move is a shot: `{ angle, power, spin }`. The server's `apply` runs the physics until
  everything stops and stores where things came to rest.
- The view carries the shot, and each browser runs the same simulation to animate it. Practice
  games run it locally, as now.
- That only works if the simulation gives the same answer everywhere. So: fixed time step,
  whole-number or fixed-point positions, and no `Math.sin`/`Math.cos` inside the loop (engines
  may round them differently). `packages/physics` gets a test that replays recorded shots and
  compares results exactly.
- The room replays its move log after a restart; with physics that is slow, so store a snapshot
  of the state every so often.

| # | Game | Players | Notes | Size |
| --- | --- | --- | --- | --- |
| 13 | Physics core + aiming | | `packages/physics`: discs, walls, friction, cushions, pockets, slopes. A canvas table with drag-to-aim, a power meter and touch controls that work on a phone. | L |
| 14 | Mini golf | 1 to 6 | One ball, still walls: the gentlest test of the core. Nine holes to start, then a course format so new courses are data. Modes: in turn, or everyone putts at once (balls don't collide, so each seat's shot is simulated on its own). Later: moving obstacles, a course editor. | L |
| 15 | Billiards | 2, or 4 as partners | Eight-ball first, then nine-ball, straight pool, snooker. House rules are a natural fit: call your shot, ball in hand, what a scratch on the eight costs. Bot: aim error grows as skill drops. | L |
| 16 | Carrom | 2, or 4 as partners | The flick board: a striker, nine pieces a side, the queen and four corner pockets. Discs and pockets from #15 with a flick from the baseline in place of a cue. House rules: covering the queen, fouls and dues, points or first to clear. | M |
| 17 | Bowling | 1 to 6 | Ten-pin, top-down pins as discs or a faked-3D lane. Aim, power and hook. Scoring and frames are the easy part. Later: duckpin, candlepin. | L |

After that, if it is wanted: real-time play (air hockey, mini golf as a race), which does need
new netcode and is a separate decision.

## Running alongside

- **Watching.** Spectators and all-bot exhibition games should work for board games from the
  first one, and a finished game should be replayable move by move.
- **The embed.** `<card-room>` plays Spades and Palace in the page. Tic-Tac-Toe, Drop Four and
  Reversi are small enough to join them.
- **Tournaments.** Brackets work for any two-sided game already. Chess and backgammon will want
  matches of several games; Yacht and bowling want a score-based format with no bracket.
- **The side apps.** The admin's "which games appear and in what order" needs the new sections.
  The card designer could grow into board and piece themes.

## Open questions

1. **The new name.** Decided: "Card Room" goes. Not decided: what replaces it.
2. **Chess and Go bots:** write our own (fits the repo, modest strength), or wrap an existing
   engine for the top skill levels?
3. **Order across phases:** Phase 5 is the most new work and the most fun. Mini golf could start
   in parallel with Phase 1, since it shares nothing with the board kit but the rooms.

## Decided

- Carom means **Carrom**, the flick board game.
- Names: **Drop Four**, **Combat**, **Yacht** (**Shotzee** with drinking mode on),
  **Criss-Crosswords**.
- Mahjong: **Shanghai** and **Riichi**.
