# Spades

Family spades online: house rules saved as presets, family tournaments, and an
embed for [open.blog](https://github.com/journey-to-code-org/open.blog) sites.

Built first for **brokennil** and Grammi's House.

See [docs/SPEC.md](docs/SPEC.md) for the plan.

## Packages

| Package | Status |
| --- | --- |
| [`packages/rules`](packages/rules) | Rules engine and bots |
| [`packages/ui`](packages/ui) | Table components in Zubra, shared by the app and the blog embed |
| [`packages/web`](packages/web) | React card table using the Zubra components: family tables, practice against bots, house rules |
| [`packages/rooms`](packages/rooms) | Turn-based rooms over `@zubra/sync`: seats, server-decided moves, private views, bots |
| [`packages/server`](packages/server) | The card room server: houses, rooms, the sync log and the web app |
| `packages/embed` | Planned |

## Development

```sh
npm install
npm test
npm run dev        # the server on :8787 and the app on http://localhost:5173
```

Family tables and houses need the server. A **house** (Grammi's House) keeps a family's
members, house rules and tables together, with one invite link that keeps working. Practice against the computer works anywhere, including the
GitHub Pages build of the app.

## Hosting the card room

One container runs everything; mount a volume so tables survive restarts:

```sh
docker build -t spades .
docker run -p 8787:8787 -v spades:/data spades
```

Without `SPADES_DB`, tables live in memory. `GET /healthz` answers `ok` for health checks.

### On Railway

`.railway/railway.ts` describes the card room as its own Railway project: the service built
from this repository's Dockerfile, a 1 GB volume at `/data`, the health check, and one replica
(the server holds live connections and game state in one process, so never run two). Keep it in
a project of its own, because applying the file makes the whole project match it.

```sh
npm install -g @railway/cli   # once
railway login
railway init                  # a new, empty project named spades (or `railway link` to an empty one)
railway config plan           # shows what it will create
railway config apply
```

Then, in the dashboard, generate a domain for the service under **Networking**. Generated
domains aren't part of the file. Every merge to `main` deploys.

### Notifications

The app installs to a phone's Home Screen and can buzz it when someone challenges you or opens
a table in your house. The server needs a VAPID key pair for that; without one, notifications
stay off and the buttons for them don't show.

```sh
npx web-push generate-vapid-keys
```

Put the two keys in the service's variables (on Railway: the service → **Variables**):

| Variable | |
| --- | --- |
| `SPADES_VAPID_PUBLIC_KEY` | the public key |
| `SPADES_VAPID_PRIVATE_KEY` | the private key; keep it secret |
| `SPADES_VAPID_SUBJECT` | optional: a `mailto:` or `https:` address push services can reach you at |

Keep the same keys for good: new keys quietly cut off every phone that already said yes.

On an iPhone, notifications only work from the Home Screen app (iOS 16.4 or later): open the
site in Safari, tap Share, **Add to Home Screen**, open Spades from there and turn them on. The
app explains this when it's opened in Safari. Android phones can turn them on straight from
the browser.

#### Setting it up in the dashboard instead

1. **New project → Deploy from GitHub repo → `mnichols08/spades`.** Railway sees the npm
   workspaces and offers a service per package (`rules`, `rooms`, `ui`, `web`, `server`).
   **Deploy only one.** The others are libraries and the front end, all built into the server.
   Delete any that get created.
2. **Settings → Source:** root directory `/` (the repository root, not `packages/server`), and
   builder **Dockerfile**. Leave build and start commands empty.
3. **Volume:** <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> → "volume" (desktop browser; the mobile
   dashboard can't add one), attach it to the service, mount path `/data`.
4. **Variables:** `SPADES_DB=/data/spades.db`. Without it, tables live in memory and every deploy
   wipes them.
5. **Networking → Generate Domain.** The target port must be the one the server logs at start
   (`spades on http://localhost:8080`). Railway sets `PORT` (usually 8080), which overrides the
   Dockerfile's 8787. Or set `PORT=8787` yourself and use 8787.

#### When it doesn't work

| What you see | Why | Fix |
| --- | --- | --- |
| "Application failed to respond", but the deploy log says `spades on http://localhost:8080` | The domain points at another port | Set the domain's target port to the logged one |
| `/healthz` says `ok`, the page says "Build the web app first" | Built from `packages/server`, so the web app wasn't built | Root directory `/`, builder Dockerfile |
| Tables disappear after a deploy | No volume, or `SPADES_DB` unset | Volume at `/data` and `SPADES_DB=/data/spades.db` |
| Players at one table see different games | More than one replica | One replica |
| A Node version error in the build | The builder picked an old Node | `.nvmrc` pins 24; or set `RAILPACK_NODE_VERSION=24` |

Keep spades in a project of its own, so `railway config apply` can never touch another app.
