# Spades

Family spades online: house rules saved as presets, family tournaments, and an
embed for [open.blog](https://github.com/journey-to-code-org/open.blog) sites.

Built first for **brokennil** and Grammi's House.

See [docs/SPEC.md](docs/SPEC.md) for the plan.

## Packages

| Package | Status |
| --- | --- |
| [`packages/rules`](packages/rules) | Rules engine and bots |
| `packages/server` | Planned |
| [`packages/ui`](packages/ui) | Table components in Zubra, shared by the app and the blog embed |
| [`packages/web`](packages/web) | React card table using the Zubra components: play against bots, set and save house rules |
| `packages/embed` | Planned |

## Development

```sh
npm install
npm test
npm run dev -w @spades/web   # open the table at http://localhost:5173
```

The table deploys to GitHub Pages on every push to `main`.
