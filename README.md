# Card Room

Family card and board games online: fifty games with house rules saved as presets, family
**houses** with their own tables, leaderboards and tournaments, computer players with personalities,
challenge links, and a widget that puts a game on any site, including [open.blog](https://github.com/journey-to-code-org/open.blog) ones.

Built first for Grammi and Grammi's House. Everything runs in one small server you can host
yourself (Docker or Railway), and practice games work anywhere, including the GitHub Pages build.

## The games

Spades and Palace have tables of their own; the other forty-eight are built on a shared game kit
(`packages/games`), so they all get the same setup screen, house rules editor, computer players,
houses, challenges and tournaments. The kit has two tables: one that draws any card game, and one
that draws any board game (Tic-Tac-Toe was the first).

| Game | Players | |
| --- | --- | --- |
| Spades | 4, partners | Bid your tricks, spades are trump |
| Palace (Castle) | 2 to 6 | Get rid of every card; don't be the last one holding them |
| Hearts | 3 to 5 | Dodge the hearts and the queen |
| Oh Hell | 3 to 7 | Bid exactly what you'll take |
| Euchre | 4, partners | Partners, bowers and calling trump |
| Whist | 4, partners | Spades' grandparent: partners and tricks |
| Bridge | 4, partners | Contract bridge, Chicago scoring |
| Five Hundred | 4, partners | Partners bid tricks; the joker is boss |
| Pitch (Setback) | 2 to 6 | Bid for High, Low, Jack and Game |
| Pinochle | 4, partners | Partners, bidding, meld and tricks |
| Canasta | 4, partners | Partners, melds and canastas |
| Hand and Foot | 4, partners | Partners, books of seven, and a foot |
| Gin Rummy | 2 | Two players, melds and knocking |
| Rummy 500 | 2 to 6 | Melds, lay-offs and a pile to dig into |
| Contract Rummy | 3 to 8 | Seven rounds, seven contracts to lay down |
| Cribbage | 2 | Fifteen two, fifteen four, and a pair is six |
| Crazy Eights | 2 to 6 | Match the card; eights are wild |
| Switch (Last Card) | 2 to 6 | Uno's ancestor, with an ordinary deck |
| Fruit Salad | 2 to 8 | Our own colour-card game: match the fruit |
| Thirty-One | 2 to 8 | Three cards, one suit, as close to 31 as you dare |
| Durak | 2 to 6 | Attack, defend, and don't be the fool |
| Sevens | 3 to 7 | Build out from the 7s |
| Cuckoo | 3 to 10 | One card each; don't get stuck with the lowest |
| President | 3 to 7 | Climb from Scum to President |
| Golf | 2 to 6 | Swap your way to the lowest score |
| Go Fish | 2 to 6 | Ask for cards, make books |
| Old Maid | 2 to 6 | Pairs, and don't get stuck with her |
| Memory | 1 to 6 | Find the pairs (great for grandkids) |
| War | 2 to 4 | Flip, and the highest card takes all |
| Slapjack | 2 to 6 | Flip, and slap the jacks first |
| Speed | 2 | No turns: play faster than the other player |
| Sevens | 3 to 7 | Build out from the 7s |
| Cuckoo | 3 to 10 | One card each; don't get stuck with the lowest |
| Contract Rummy | 3 to 8 | Seven rounds, seven contracts to lay down |
| Memory | 1 to 6 | Find the pairs (great for grandkids) |
| Kings in the Corner | 2 to 4 | Solitaire for the whole table |
| Spite and Malice | 2 to 4 | Race to play off your pile; kings are wild |
| Five Card Draw | 2 to 6 | Poker for chips: bet, swap, bet, show |
| Texas Hold'em | 2 to 6 | Two cards, five on the board, chips only |
| Bluff (Cheat) | 2 to 6 | Say what you're putting down, true or not |
| Liar's Poker | 2 to 6 | Bid poker hands hiding in everyone's cards |
| Blackjack | 1 to 5 | Get closer to 21 than the dealer (chips only) |
| Klondike Solitaire | 1 | The classic solitaire |
| FreeCell | 1 | Solitaire where every card is face up, with numbered deals |
| Spider | 1 | Two-deck solitaire: build runs from king to ace |
| Pyramid | 1 | Solitaire: clear pairs that make 13 |
| Ride the Bus 🍺 | 2 to 8 | Drinking game: guess, match, and don't ride the bus |
| Kings Cup 🍺 | 2 to 10 | Drinking game: every card has a rule |
| Horse Race 🍺 | 2 to 10 | Drinking game: bet sips on an ace |
| Drinking Pyramid 🍺 | 2 to 8 | Drinking game: remember your cards, match, bluff |
| Tic-Tac-Toe | 2 | A board game: three in a row, Ultimate's nine boards, or Gomoku's five in a row on 15×15 |
| Drop Four | 2 | A board game: drop discs down a rack, four in a row wins; bigger racks, Pop Out, five in a row |

Poker and Blackjack are for chips only: everyone starts with the same stack, and the chips are
just for keeping score.

The 🍺 games are drinking games for adults (water counts). Party games (Thirty-One, President,
Bluff, Liar's Poker, Durak, Slapjack, Sevens, Cuckoo) also have a drinking-mode house rule, off
unless a table turns it on. Kids' games have none. Drop Four's drinking mode is a shot clock: once
the other player's disc lands you have three seconds to drop yours, or you take a drink and lose
your turn.

## The turn timer

A table on the server can give everyone a time limit for each move: **15 seconds, 30 seconds, 1
minute, 2 minutes or a day**. It's off unless someone turns it on, in the lobby or under ⚙︎ at the
table, and anyone seated can change it mid-game. When a person's time runs out, the game's own
computer player makes that one move for them, at the table's level, so a phone left on the sofa
doesn't stop the game for everyone else; they play their next move themselves. The seat whose
clock is running shows the time left, and your own gives a soft tick and a buzz five seconds
before the end.

- The clock is on whoever the table is waiting for: the player whose turn it is, or, when
  everyone moves at once (passing cards in Hearts, Palace's swap, "Deal the next hand"), the first
  person who still owes a move. In those phases it counts from the last move anyone made.
- Computer players keep their own time, a race (Speed, a slap in Slapjack) has no clock, and
  neither does a game for one.
- The server keeps the time, and it survives a restart (see [Clocks and deadlines](#clocks-and-deadlines)).
  "A day" is for games played a move at a time over a week.
- Practice games on your own device have no timer: nobody is waiting on you.
- A game can have a clock of its own as well, which is part of its rules and not a table setting
  (Drop Four's shot clock in drinking mode). When both are running, whichever runs out first counts.
  A game's own clock runs in practice too.

## Finding people to play with

A family table is private: only people with its link can sit down. Two things make a table public.

- **Find players**, on any game's setup screen, seats you at an open table that's waiting for that
  game (tables with your rules first, then whichever has waited longest). If nobody's waiting, it
  opens a table with your rules and you wait there. Turn on **Only tables with my rules** and it
  takes a seat only where the rules and the table size are exactly yours. Anyone seated at a family
  table can also open it to everyone, or close it again.
- **Open tables**, from the front page, lists every table that's waiting, whatever the game: who's
  there, how many seats are left, the rules, and how long it's waited. Jump into any of them.

An open table deals itself when its last seat is taken (add bots if you're tired of waiting).
Leaving before the deal gives your seat back, and a seat whose player has gone quiet for a minute
and a half is freed, so the list only shows tables somebody is really waiting at.

Open tables are where strangers meet, so:

- **The host can remove a player**, before the deal or after it (the host is whoever opened the
  table, or the first seat once they've left). Before the deal the seat is free again; after it, a
  computer player takes the seat and plays on. Either way that player can't come back to the table.
- **The host can mute a player**, and anyone can hide someone's chat on their own device. Both are
  under ⚙︎ at the table. Crude words in an open table's chat are covered up.
- **Names are filtered.** The crudest names are turned away from open tables, and one that came in
  by a table's link shows as "Player". The list is short on purpose; add your own words with
  `CARDROOM_BLOCKED_NAMES`.
- **A buzz when someone's waiting.** On the Open tables page, pick a game (or any game) and turn
  notifications on: your phone buzzes when a table opens for it, at most once every ten minutes.

### The card room's admin

Whoever runs the server can block a player from the whole card room. Set `CARDROOM_ADMIN_KEY`
(8 characters or more), open `/?admin=1` and enter it once: that device is an admin from then on.

- At any table, an admin sees **Block** next to each player (before the deal, in the seat list;
  during a game, under ⚙︎). Blocking takes the player out of their seat, as removing does, and from
  then on their browser can look but can't sit, chat, play, open tables or send challenges.
- At a table that is or was open to everyone, an admin can also remove and mute, as its host can.
- `/?admin=1` lists who's blocked and lets them back in.

A block follows the player's browser, not a person: it stops a casual pest, and someone who clears
their cookies comes back as a new player. Family tables that were never opened to everyone have no
host, no chat filter and no mute; an admin can still block there.

## Packages

| Package | |
| --- | --- |
| [`packages/games`](packages/games) | The game kit and the forty-eight games built on it: `table.ts` (the `TableGame` engine contract every game shares), `kit.ts` (the card kit: `CardGame`, cards, decks, `KitView`) and `board.ts` (the board kit: `BoardGame`, grids, pieces, `BoardView`) |
| [`packages/rules`](packages/rules) | Spades rules engine, bots, and the personas who play every game |
| [`packages/palace`](packages/palace) | Palace rules engine: house-rule presets, seat views, bots and table talk |
| [`packages/physics`](packages/physics) | A small deterministic 2D physics core for the ball games to come: the same shot gives the same table on the server and in every browser |
| [`packages/rooms`](packages/rooms) | Turn-based rooms over `@zubra/sync`: seats, server-decided moves, private views, bots |
| [`packages/server`](packages/server) | The server: every game's rooms, houses, challenges, tournaments, the lobby, the sync log and the web app |
| [`packages/web`](packages/web) | The app (React, with the game chooser in Vue): the card table and the board table, setup screens, houses, practice |
| [`packages/ui`](packages/ui) | Table components in Zubra (cards, seats, fields), and the `<card-room>` embed |

The server decides every move. Each player's browser only ever receives its own view of a table
(its own hand), never the whole game; moves the rules don't allow are refused on the server.

## Development

```sh
npm install
npm test
npm run dev        # the server on :8787 and the app on http://localhost:5173
```

Family tables, houses, challenges and tournaments need the server. Practice against the computer
works anywhere, including the GitHub Pages build of the app.

## Adding a game

Most games belong on the kit, which gives them a table, the setup screen, house rules, computer
players at the table, houses, challenges and tournaments for free. Every kit game is a
`TableGame` (`packages/games/src/table.ts`): presets and rule fields, `newGame` (a deterministic
start from a seed), `apply` (never changes the state it's given, and throws a `GameError` for a
move the rules don't allow), `view` (what one seat may see and do), `bot`, `thinkingTime` and
`summary`. The only thing that differs between a card game and a board game is what `view`
returns.

### A card game

1. **The engine:** `packages/games/src/<game>.ts`, a `CardGame<Rules, State, Move>` (see
   `packages/games/src/kit.ts`), whose `view` returns a `KitView`: the hand and which cards a tap
   plays, the middle of the table, melds, buttons, scores. Go Fish, Golf and Whist are short
   worked examples; `poker.ts` is the shared core for the poker games.
2. **Register it:** add its id to `CardGameId` in `table.ts`, add it to `CARD_GAMES` in
   `registry.ts`, and export it from `index.ts`.
3. **Tests:** `packages/games/test/<game>.test.ts` for its rules. The shared kit tests
   (`test/kit.test.ts`) play every registered card game automatically: computer players finish
   whole games at the smallest, usual and largest table with every preset, the same seed always
   deals the same game, views match the state, and refused moves change nothing.
4. **Its tile on the front page:** a fan of three cards in `packages/web/src/home/Home.tsx`.

### A board game

1. **The engine:** `packages/games/src/<game>.ts`, a `BoardGame<Rules, State, Move>` (see
   `packages/games/src/board.ts`), whose `view` returns a `BoardView`: one or more grids of cells
   with at most one piece each (optional shading, coordinates, blocks of cells, highlights for the
   last move and a winning line), pieces off the board in reserves, buttons, scores. A grid says
   what you can do on it in one of two ways: `tap` lists cells that send `{ type, cell }` when
   tapped (or `{ type, col }` for a drop game), and `select` lists pieces you can pick up (a cell,
   or a kind of piece in your reserve) with where each can go, sending `{ type, from, to }`. List
   exactly the legal moves: the table offers nothing else, and `apply` still refuses the rest.
   `tictactoe.ts` is the worked example, with three computer players: a solved 3×3, a scored
   search for bigger boards, and a look-ahead for Ultimate. `dropfour.ts` is the drop game (column
   taps, a rack with `gravity`), and the example of a game with a clock of its own (`deadline`).
2. **Register it:** add its id to `BoardGameId` in `table.ts`, add it to `BOARD_GAMES` in
   `registry.ts`, and export it from `index.ts`.
3. **Tests:** `packages/games/test/<game>.test.ts` for its rules. The shared board tests
   (`test/board.test.ts`) play every registered board game automatically: computer players finish
   whole games with every preset at every table size, a game can be played from nothing but what
   its views offer, every move a view offers is accepted, the same seed always starts the same
   game, and refused moves change nothing.
4. **Its tile on the front page:** a little board position in `BOARDS` in
   `packages/web/src/home/Home.tsx`.

Nothing else needs touching: `KIT_GAMES` is both lists together, and the room on the server, the
setup screen, the rules editor, houses, challenges, leaderboards, tournaments and practice all go
by it. The web app's `GameTable` picks the card table or the board table from the game.

A game the kit can't express (Spades and Palace predate it) gets its own engine package, a room
definition in [`packages/server/src/games.ts`](packages/server/src/games.ts) and a table in the
web app; Palace is the worked example (`packages/palace`, `packages/server/src/palace.ts`,
`packages/web/src/palace/`).

## Clocks and deadlines

Nothing happens in a room unless a seat or a computer player moves, except by a **deadline**: a
room definition may say what the server does if nobody moves in time
([`packages/rooms`](packages/rooms#deadlines) has the whole contract).

```ts
deadline: (state, { settings, seats }) => ({
  after: 30_000,                 // ms after the last move (or `at`: a server time)
  seat: state.turn,              // whose clock: pages count down on this seat
  move: () => ({ type: "pass" }) // made as that seat when time runs out; null for nothing
}),
```

The timeout move goes through `act` and into the move log like any other, so a replay gives the
same game, and a move that arrives as the timer fires is never applied on top of it. `act` gets a
fourth argument, `{ at, elapsed }` (when the server decided the move, and how long since the one
before); a game with real clocks keeps them in its state from that alone, never from `Date.now()`,
which is what makes a chess clock replay: `after: state.bank[state.turn]`, and `act` takes
`elapsed` off the mover's bank and adds the increment
(`packages/rooms/test/deadlines.test.ts` has one in forty lines).

Every game in the card room already has one deadline, the [turn timer](#the-turn-timer)
(`packages/server/src/timer.ts`). A game on the kit gets it for nothing: it needs `view().turn` to
say whose move it is and `bot()` to give a move for any seat that owes one.

### A game's own clock

A game on the kit can also have a clock that is part of its rules: a shot clock, a chess clock, a
window for claiming a discard. It says so from its state, with the optional `deadline` of
`TableGame` (`packages/games/src/table.ts`):

```ts
deadline(state) {
  // Drop Four in drinking mode: three seconds, once the other player's disc has landed.
  return state.clock ? { after: 3000, seat: state.turn, move: { type: "timeout" } } : null;
},
```

`after` counts from the last move anyone made, `seat` is whose clock it is, and `move` is made as
that seat when time runs out. It's a move like any other: `apply` decides what it does (in Drop
Four, a drink and a lost turn) and refuses it when no clock is running, and it goes into the move
log. `deadline` must be worked out from the state alone, never from the time of day.

- **Wired once.** `kitRoom.deadline` (`packages/server/src/kit.ts`) turns it into the room's
  deadline for every game, and `tableRoom.deadline` (`games.ts`) weighs it against the turn timer
  with `sooner` (`timer.ts`): whichever runs out first is the room's one deadline, and the game's
  own wins a tie. With no clock of its own running, the turn timer is all there is.
- **A little grace.** The clock is meant to run from when you can see the other player's move, and
  both that and your answer take a moment to travel. So the server waits `GAME_CLOCK_GRACE_MS`
  (400 ms, in `kit.ts`) past a game's own clock before it makes the timeout move, using the room
  deadline's `grace`. Pages count down to the time without it, and a move that arrives inside the
  grace is taken like any other. The turn timer has no grace: its shortest setting is 15 seconds.
- **Computer players** aren't held to a game's own clock (no deadline is armed on a bot's seat), and
  `botDelay` keeps them inside six tenths of it whatever the table's pace, so a person is never
  waiting longer for a bot than they'd be allowed themselves.
- **Replays and restarts.** A timeout is in the move log, so a replay gives the same game with the
  missed turn in it. After a restart a clock that was running is armed again from the last move's
  logged time, but never with less than the room's `deadlineGrace` (five seconds) from the restart:
  for a three-second clock that means a restart gives the seat five seconds, not a lost turn.
  Changing the table's settings mid-clock never puts off a clock that's already running.
- **Practice.** `LocalKit` runs the same `deadline` in the browser, on your own seat, with no grace
  (there's no trip to make), and shows the same countdown.
- **Not yet:** a clock that banks time (chess) needs to know how long each move took. Rooms hand
  that to `act` as `{ at, elapsed }`; `TableGame.apply` doesn't take it yet, and passing it through
  `kitRoom.act` is the one line to add when the first such game arrives.

## Putting a game on a site

The web build makes a `<card-room>` widget with Zubra's embed build. Paste this into any page (an
open.blog post, a WordPress HTML block, a Squarespace code block), with the card room's address:

```html
<script type="module" src="https://your-card-room/embed/cardroom.js"></script>
<card-room server="https://your-card-room" game="palace" challenge="abc123" who="Grammi"></card-room>
```

| Attribute | |
| --- | --- |
| `server` | The card room's address. Required. |
| `game` | `palace`, `spades`, or leave it out to offer both. (The widget plays these two; the other games open in the card room.) |
| `challenge` | Your challenge link's code (the end of `?challenge=…`), for a "Challenge Grammi" button. |
| `who` | The name on that button. |

**Play here** deals a practice game against the computer inside the page. **Challenge** and
family tables open the card room in a new tab: browsers don't let a game in a frame on someone
else's site keep you signed in, and the card room is where your houses and tables live.

The build also writes a WordPress plugin and a Shopify app block to `packages/web/dist/embed`
(see its README).

### On an open.blog site

open.blog sites place web components their theme offers from **Admin → Landing page → Add a
section**, with a form and no code ([ADR 0408](https://github.com/journey-to-code-org/open.blog/blob/main/docs/adr/0408-a-theme-offers-components-an-owner-places-with-a-form-and-a-section-holds-only-a-name-and-checked-values.md)).
The web build writes `<card-room>` in that shape to `packages/web/dist/embed/openblog/` (also served at
`/embed/openblog/`):

1. Copy `card-room.js`, `card-room.zb` and `card-room.css` into the theme's `components/` folder.
2. Add the `components` entry from `theme-components.json` to the theme's `theme.json`, and list
   `components/card-room.css` under its `stylesheets`. With seasons, put it on the theme they extend.
3. In Admin: **Landing page → Add a section → Card room**, then the card room's address and, for a
   Challenge button, your challenge link code.

With the `zubra` command installed where the site builds, open.blog renders the widget ahead, so
readers without JavaScript still see it and its link to the card room.

## Hosting the card room

One container runs everything; mount a volume so tables survive restarts:

```sh
docker build -t cardroom .
docker run -p 8787:8787 -v spades:/data cardroom
```

`GET /healthz` answers `ok` for health checks.

### Settings

| Variable | |
| --- | --- |
| `CARDROOM_DB` | The database file (the image uses `/data/spades.db`). Without one, tables live in memory. |
| `CARDROOM_VAPID_PUBLIC_KEY` | Push notifications: the public key (see below) |
| `CARDROOM_VAPID_PRIVATE_KEY` | Push notifications: the private key; keep it secret |
| `CARDROOM_VAPID_SUBJECT` | Optional: a `mailto:` or `https:` address push services can reach you at |
| `CARDROOM_SECRET` | Any long random text: encrypts the AI keys houses connect (see **Bot talk from a model**). Keep it the same for good. |
| `CARDROOM_AI_KEY` | Optional: an Anthropic or OpenAI API key for the whole card room, so every table's bots talk through a model (see **Bot talk from a model**) |
| `CARDROOM_AI_PROVIDER` | `anthropic` or `openai`, if the key doesn't say (a key starting `sk-ant-` is Anthropic's) |
| `CARDROOM_AI_MODEL` | The model for that key. Default: `claude-haiku-5-5` or `gpt-5.6-luna`. |
| `CARDROOM_AI_DAILY` | The most lines a day on that key, everyone together. Default 3000. |
| `CARDROOM_ADMIN_KEY` | Optional: makes any device that enters it at `/?admin=1` the card room's admin, who can block players. 8 characters or more; keep it secret. |
| `CARDROOM_BLOCKED_NAMES` | Optional: more words that names and chat at open tables may not contain, comma-separated |
| `CARDROOM_BOT_DELAY` | Fixed thinking time for computer players, in milliseconds (handy for testing) |
| `CARDROOM_WEB` | Where the built web app is, if not `packages/web/dist` |
| `PORT` | The port to listen on (8787; Railway sets its own) |

The older `SPADES_*` names for these still work; `CARDROOM_*` wins if both are set. Keep the
database file's name (`spades.db`) as it is: renaming it leaves saved tables and houses behind.

### On Railway

`.railway/railway.ts` describes the card room as its own Railway project: the service built
from this repository's Dockerfile, a 1 GB volume at `/data`, the health check, and one replica
(the server holds live connections and game state in one process, so never run two). Keep it in
a project of its own, because applying the file makes the whole project match it.

```sh
npm install -g @railway/cli   # once
railway login
railway init                  # a new, empty project (or `railway link` to an empty one)
railway config plan           # shows what it will create
railway config apply
```

Then, in the dashboard, generate a domain for the service under **Networking**. Generated
domains aren't part of the file. With the service connected to this repository (**Settings →
Source**, auto-deploy on), every merge to `main` deploys; otherwise deploy from the dashboard.

### Bot talk from a model

A house's owner or an admin can connect the house's own AI account on the house page, under
**Bot talk**: pick Claude (Anthropic) or OpenAI, paste an API key from that account, and write a
few notes about the family (who's who, nicknames, in-jokes). From then on the computer players at
that house's tables say hello, react and answer in the model's words. A question to the table, or
a bot's name, gets an answer too.

- The model only talks. The rules engines play every card and decide when a bot speaks.
- It's told only what the whole table sees: names, the public scoreboard, the recent chat and the
  family notes. Never a hand.
- The house's account pays for the lines (a few words each, at most 600 a day per house). If the
  model is slow, out of credit or switched off, the bots say their own lines.
- Leave the model empty and the card room picks a small one the account has, or tap **Choose from
  this account's models** to pick from the account's own list.
- A table outside the house (a quick table, a challenge) talks through the house's account too
  when one of its members is sitting at it. The family notes are only used when everyone at that
  table is in the house.
- The key is tried before it's saved, kept on the server (encrypted when `CARDROOM_SECRET` is
  set) and never sent to a page again: admins see its last four characters. A changed or lost
  `CARDROOM_SECRET` means pasting the keys again.

**One key for everyone.** Whoever runs the card room can set `CARDROOM_AI_KEY` instead (see
**Settings**). Then the bots at every table talk through it, in a house or not, and a house's
owner or admins only add their family notes, switch it off, or connect the house's own account
in its place. That account pays for everyone, so it has ceilings: 3000 lines a day in all
(`CARDROOM_AI_DAILY`), 600 for one house and 60 for a table outside a house. The key lives only in
the server's settings: it's never stored in the database or sent to a page.

Card Room connects with an API key from the provider's developer console; signing in with a Claude
or ChatGPT subscription isn't supported.

### Notifications

The app installs to a phone's Home Screen and can buzz it when someone challenges you or opens
a table in your house. The server needs a VAPID key pair for that; without one, notifications
stay off and the buttons for them don't show.

```sh
npx web-push generate-vapid-keys
```

Put the keys in the service's variables (on Railway: the service → **Variables**) as
`CARDROOM_VAPID_PUBLIC_KEY` and `CARDROOM_VAPID_PRIVATE_KEY` (see **Settings** above). Keep the
same keys for good: new keys quietly cut off every phone that already said yes.

On an iPhone, notifications only work from the Home Screen app (iOS 16.4 or later): open the
site in Safari, tap Share, **Add to Home Screen**, open Card Room from there and turn them on.
The app explains this when it's opened in Safari. Android phones can turn them on straight from
the browser.

#### Setting it up in the dashboard instead

1. **New project → Deploy from GitHub repo → `mnichols08/card-room`.** Railway sees the npm
   workspaces and offers a service per package. **Deploy only one.** The others are libraries
   and the front end, all built into the server. Delete any that get created.
2. **Settings → Source:** root directory `/` (the repository root, not `packages/server`), and
   builder **Dockerfile**. Leave build and start commands empty.
3. **Volume:** <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> → "volume" (desktop browser; the mobile
   dashboard can't add one), attach it to the service, mount path `/data`.
4. **Variables:** none needed: the image keeps its database at `/data/spades.db`. Without the
   volume, tables live in the container and every deploy wipes them.
5. **Networking → Generate Domain.** The target port must be the one the server logs at start
   (`Card Room on http://localhost:8080`). Railway sets `PORT` (usually 8080), which overrides
   the Dockerfile's 8787. Or set `PORT=8787` yourself and use 8787.

#### When it doesn't work

| What you see | Why | Fix |
| --- | --- | --- |
| "Application failed to respond", but the deploy log says `Card Room on http://localhost:8080` | The domain points at another port | Set the domain's target port to the logged one |
| `/healthz` says `ok`, the page says "Build the web app first" | Built from `packages/server`, so the web app wasn't built | Root directory `/`, builder Dockerfile |
| Tables disappear after a deploy | No volume at `/data` | A volume mounted at `/data` |
| Players at one table see different games | More than one replica | One replica |
| A merge to `main` didn't change the site | The service isn't set to deploy on push | **Settings → Source**, auto-deploy on, or deploy from the dashboard |
| A Node version error in the build | The builder picked an old Node | `.nvmrc` pins 24; or set `RAILPACK_NODE_VERSION=24` |

Keep the card room in a project of its own, so `railway config apply` can never touch another app.

See [docs/SPEC.md](docs/SPEC.md) for the original plan.
See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next: board games, dice, tiles and table sports.
