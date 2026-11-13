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
