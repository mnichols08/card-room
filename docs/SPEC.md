# Spades — Spec

A place for families to play spades together online, run family tournaments,
and (later) invite the rest of the world to the table. It stands on its own and
also ships a small embed that drops into an [open.blog](https://github.com/journey-to-code-org/open.blog)
site such as Grammi's House.

The first player is **brokennil**. If it works for her, it works.

## Goals

1. Four people who live far apart can sit down at a table and play a full game of spades in their browsers.
2. Nobody has to agree on rules ahead of time: the rules are a **preset** chosen before the deal and saved to the **house**.
3. A family can run a tournament and keep a leaderboard.
4. A blog can show the house's game nights and a "Pull up a chair" button without becoming a dynamic site.

## Non-goals (for now)

- Public matchmaking, ratings, moderation. The model leaves room for it (a public lobby is just an open house), but v1 is family play.
- Real-money anything.
- Native apps. Mobile web must work well, though — most of the family will play on phones.

## Core concepts

### Player

A person with a **spades name** (e.g. `brokennil`) that follows them from house to house.
v1 auth: magic link by email, or a house invite link that creates a lightweight player.

### House

A group of players who play together.

| Field | Notes |
| --- | --- |
| `name` | e.g. "Grammi's House" |
| `slug` | URL-safe, used by the blog embed |
| `inviteCode` | rotatable; joining makes you a member |
| `members` | `{ playerId, role: "owner" \| "admin" \| "member" }` |
| `presets` | rule presets saved to this house |
| `defaultPresetId` | used when a host doesn't pick one |

- Owners and admins edit presets, start tournaments, manage members.
- Members play and can suggest a preset change.
- A player can belong to many houses.

### Rule preset

Every rule the engine knows about is a field on a preset. Nothing is hard-coded.
Built-in presets ship with the engine (`classic`, `jokers-and-deuces`, `quick-250`);
houses copy and tweak them. The active preset is shown to everyone before each deal
and is snapshotted onto the game so later edits don't change a game in progress.

See `packages/rules/src/types.ts` (`RulePreset`) for the authoritative shape. Current options:

- **Trump**: ace-high spades, or jokers & deuces (Big Joker > Little Joker > 2♦ > 2♠ > A♠ …; 2♣ and 2♥ removed).
- **Nil**: on/off, point value.
- **Blind nil**: on/off, point value, only allowed when the team is down by N, number of cards passed with partner.
- **Bags**: limit and penalty (or off).
- **Game end**: play-to score, lose-at floor.
- **Minimum team bid**.
- **Spades broken**: whether spades may be led before they're broken.

### Table & game

A table is opened inside a house with a preset. Four seats, partners sit across (seats 0 & 2 vs 1 & 3).
Empty seats can be filled by a bot so three people can still play.

Game phases: `bidding → (passing) → playing → scoring → bidding … → finished`.

### Tournament

Belongs to a house, locks one preset for every match, single-elimination bracket of teams
in v1. Results feed the house leaderboard.

## Architecture

```
packages/
  rules/    pure TypeScript rules engine — no I/O, fully deterministic, unit tested
  ui/       table components written in Zubra (.zb): custom elements shared by web and embed
  web/      the card table app: React, using the ui components through @zubra/unplugin
  rooms/    a kit over @zubra/sync for server-decided, turn-based rooms with private per-seat views
  server/   the card room: rooms + the sync log + the web app, in one Node process
  embed/    the ui components on open.blog pages: game nights, leaderboard, join button
```

- **One set of components, two consumers.** The table's pieces are Zubra components, used from
  React in the app and as plain HTML on the blog. Proving Zubra works inside React is a goal in itself.
- **The server is the source of truth.** Clients send moves (`bid`, `play`) to a server action,
  which runs them through `rules` and writes each seat's view to `@zubra/sync`. Each player's
  connection is scoped so it can read only its own hand. The `rooms` package packages that pattern;
  it starts here and moves to its own repo once its API settles.
- **Deterministic engine.** Shuffles take a seed so any game can be replayed from its log,
  which makes disputes ("I know I had the big joker!") and bug reports easy.
- **Embed is read-mostly.** It fetches public house info (name, upcoming game nights,
  leaderboard) and links into the web app. The blog stays static.

## Milestones

1. **Rules engine** — presets, deck, legal plays, tricks, bidding, scoring, game reducer, tests. ✅
2. **Local table** — `web` plays a full game against simple bots, no server. Rules editor saves presets in the browser. ✅
3. **Zubra components** — the table and setup screen rebuilt on `.zb` components inside React. ✅
4. **Rooms kit + family tables** — `packages/rooms` over `@zubra/sync`: seats, server-checked moves, per-seat views, bots and a move log; invite links and a lobby in the app; one container to host it. ✅
5. **Houses** — accounts, invite links, roles, preset editor, house default preset.
6. **Tournaments & leaderboard.**
7. **open.blog embed** for Grammi's House.
8. *(Later)* Public lobby.

## Open questions

- Hosting: one small Node server + SQLite (Fly.io / Railway) is plenty for family scale.
- Bots: rule-based is enough for filling a seat; no need to be clever.
- Chat / emoji reactions at the table — almost certainly yes, scope later.
