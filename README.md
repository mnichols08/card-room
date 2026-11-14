# Card Room

Family card games online: twenty-six games with house rules saved as presets, family **houses** with
their own tables, leaderboards and tournaments, computer players with personalities, challenge
links, and a widget that puts a game on any site, including [open.blog](https://github.com/journey-to-code-org/open.blog) ones.

Built first for Grammi and Grammi's House. Everything runs in one small server you can host
yourself (Docker or Railway), and practice games work anywhere, including the GitHub Pages build.

## The games

Spades and Palace have tables of their own; the other twenty-four are built on a shared game kit
(`packages/games`), so they all get the same table, setup screen, house rules editor, computer
players, houses, challenges and tournaments.

| Game | Players | |
| --- | --- | --- |
| Spades | 4, partners | Bid your tricks, spades are trump |
| Palace (Castle) | 2 to 6 | Get rid of every card; don't be the last one holding them |
| Hearts | 3 to 5 | Dodge the hearts and the queen |
| Oh Hell | 3 to 7 | Bid exactly what you'll take |
| Euchre | 4, partners | Partners, bowers and calling trump |
| Whist | 4, partners | Spades' grandparent: partners and tricks |
| Pinochle | 4, partners | Partners, bidding, meld and tricks |
| Canasta | 4, partners | Partners, melds and canastas |
| Hand and Foot | 4, partners | Partners, books of seven, and a foot |
| Gin Rummy | 2 | Two players, melds and knocking |
| Rummy 500 | 2 to 6 | Melds, lay-offs and a pile to dig into |
| Cribbage | 2 | Fifteen two, fifteen four, and a pair is six |
| Crazy Eights | 2 to 6 | Match the card; eights are wild |
| President | 3 to 7 | Climb from Scum to President |
| Golf | 2 to 6 | Swap your way to the lowest score |
| Go Fish | 2 to 6 | Ask for cards, make books |
| Old Maid | 2 to 6 | Pairs, and don't get stuck with her |
| War | 2 to 4 | Flip, and the highest card takes all |
| Five Card Draw | 2 to 6 | Poker for chips: bet, swap, bet, show |
| Texas Hold'em | 2 to 6 | Two cards, five on the board, chips only |
| Bluff (Cheat) | 2 to 6 | Say what you're putting down, true or not |
| Liar's Poker | 2 to 6 | Bid poker hands hiding in everyone's cards |
| Klondike Solitaire | 1 | The classic solitaire |
| FreeCell | 1 | Solitaire where every card is face up, with numbered deals |

Poker is for chips only: everyone starts with the same stack, and the chips are just for keeping
score.

## Packages

| Package | |
| --- | --- |
| [`packages/games`](packages/games) | The game kit (`kit.ts`: the `CardGame` contract, cards, decks, views) and the twenty-four games built on it |
| [`packages/rules`](packages/rules) | Spades rules engine, bots, and the personas who play every game |
| [`packages/palace`](packages/palace) | Palace rules engine: house-rule presets, seat views, bots and table talk |
| [`packages/rooms`](packages/rooms) | Turn-based rooms over `@zubra/sync`: seats, server-decided moves, private views, bots |
| [`packages/server`](packages/server) | The server: every game's rooms, houses, challenges, tournaments, the sync log and the web app |
| [`packages/web`](packages/web) | The app (React, with the game chooser in Vue): tables, setup screens, houses, practice |
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

Most games belong on the kit, which gives them the table, the setup screen, house rules, computer
players at the table, houses, challenges and tournaments for free:

1. **The engine:** `packages/games/src/<game>.ts`, a `CardGame<Rules, State, Move>` (see
   `packages/games/src/kit.ts`): presets and rule fields, `newGame` (a deterministic deal from a
   seed), `apply` (throws a `GameError` for a move the rules don't allow), `view` (what one seat
   may see and do), `bot`, `thinkingTime` and `summary`. Go Fish, Golf and Whist are short worked
   examples; `poker.ts` is the shared core for the poker games.
2. **Register it:** add its id to `KitGameId` in `kit.ts`, add it to `KIT_GAMES` in
   `registry.ts`, and export it from `index.ts`.
3. **Tests:** `packages/games/test/<game>.test.ts` for its rules. The shared kit tests
   (`test/kit.test.ts`) play every registered game automatically: computer players finish whole
   games at the smallest, usual and largest table with every preset, the same seed always deals
   the same game, views match the state, and refused moves change nothing.
4. **Its tile on the front page:** a fan of three cards in `packages/web/src/home/Home.tsx`.

A game the kit can't express (Spades and Palace predate it) gets its own engine package, a room
definition in [`packages/server/src/games.ts`](packages/server/src/games.ts) and a table in the
web app; Palace is the worked example (`packages/palace`, `packages/server/src/palace.ts`,
`packages/web/src/palace/`).

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
