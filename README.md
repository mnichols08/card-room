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
| [`packages/server`](packages/server) | The card room server: rooms, the sync log and the web app |
| `packages/embed` | Planned |

## Development

```sh
npm install
npm test
npm run dev        # the server on :8787 and the app on http://localhost:5173
```

Family tables need the server. Practice against the computer works anywhere, including the
GitHub Pages build of the app.

## Hosting the card room

One container runs everything; mount a volume so tables survive restarts:

```sh
docker build -t spades .
docker run -p 8787:8787 -v spades:/data spades
```

Any host that runs a container works (Fly.io, Railway, Render). Without `SPADES_DB`, tables
live in memory.
