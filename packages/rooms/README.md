# @spades/rooms

Turn-based rooms over [`@zubra/sync`](https://github.com/journey-to-code-org/zubra/blob/main/docs/sync.md):
seats, moves the server decides, a private view per seat, bots, and a move log. Nothing in it is
about spades; a room is defined by five functions.

It lives here while spades shapes its API, and moves to its own repository once that settles.

## Defining a room

```ts
import { createRooms, RefusedMove } from "@spades/rooms/server";

const rooms = createRooms({
  seats: 4,
  setup: (options, seed) => newGame(options, seed),
  act: (state, seat, move) => applyAction(state, { ...move, seat }), // throw to refuse; the message goes to the player
  view: (state, seat) => viewFor(state, seat),                       // what that seat may see
  summary: (state) => ({ scores: state.scores }),                    // what everyone may see
  bot: (state, seat) => botMove(state, seat),                        // or null when it isn't that seat's move
  finished: (state) => state.phase === "finished",                   // optional: finished rooms leave memory
}, { log: sqliteLog("rooms.db", { keep: "latest" }) });

const id = await rooms.create(options);   // open a room from server code (a house opening a table)

// Node: answers /rooms/* and /_zb/sync/*
http.createServer(async (req, res) => { if (!(await rooms.handle(req, res))) serveApp(req, res); });
```

## In the browser

```ts
import { createRoom, openRoom } from "@spades/rooms/client";

const id = await createRoom(houseRules);
const room = openRoom(id);
room.onRoom((doc) => render(doc.seats));          // who's sitting where, started or not
const { seat } = await room.sit(0, "brokennil");   // room.stand() gives the seat back, before the deal
room.onView(seat, ({ view }) => render(view));    // this seat's view only
await room.act({ type: "bid", bid: { kind: "nil" } });
room.onChat((messages) => render(messages));   // the table's chat, oldest first
await room.say("good luck ♠️");                 // seated players; rooms.say(id, seat, text) on the server, for bots
```

## Deadlines

A room waits for its seats for ever unless its definition has a `deadline`: by when, and the move
the server makes for which seat if nothing else happens first. A turn timer, a flag falling on a
chess clock, a window for claiming a discard and "a day a move" are all this.

```ts
createRooms({
  // ...
  act(state, seat, move, time) { /* time = { at, elapsed }: see below */ },
  deadline: (state, { settings, seats }) =>
    state.over ? null : { after: settings.limit, seat: state.turn, move: () => botMove(state, state.turn) },
});
```

| | |
| --- | --- |
| `after` | Ms after the last move (or the deal). "30 seconds a turn" is `after: 30_000`; a chess clock is `after: state.bank[state.turn]`. |
| `at` | Instead of `after`: a server time, for a state that keeps times itself. |
| `seat` | Whose clock it is. The timeout move is made as this seat. |
| `move()` | The move, worked out only when time runs out. `null`: nothing happens, and the room waits. |

- **One timer a room.** The server asks for the deadline after every move, arms one timer, and
  puts it away when the game finishes. It's separate from the bot's timer; both can be waiting.
- **A timeout is a move.** It goes through `act`, into the move log, and out through `onMove`
  (with `timeout: true`), so a replay gives the same game.
- **Never both.** A move puts the deadline away in the same breath that it's decided, and the
  timer checks it's still the armed one before it moves: a move and a timeout can't both land on
  one state. Whichever is decided first wins; the other is refused or dropped.
- **Moves have times.** `act`'s fourth argument is `{ at, elapsed }`: the server time the move was
  decided, and the ms since the move before it. The log keeps `at`, and a replay hands `act` the
  same numbers, so a state may hold clocks (a bank per seat, with an increment) as long as they
  change only by `elapsed`. `deadline` and `act` must never read the clock themselves.
- **Restarts.** The clock keeps running while the server is down: a deadline counts from the last
  move's logged time, not from the restart, so nobody gets a fresh period (and a chess bank loses
  the downtime). Rooms that had a deadline running are restored when the server starts, without
  waiting for a request (`await rooms.restored`). If the time has already passed, the seat gets
  `deadlineGrace` (default 5 seconds) from the restart before the timeout move is made. A game
  dealt before moves had times starts its clock the first time it's restored.
- **Settings.** A deadline may depend on the table's settings; it's worked out again when they
  change, without restarting the clock. One that lands in the past that way gets the same grace.
- **Pages see when, never what.** The public room doc has `deadline: { at, seat } | null`, in
  server time. `GET /rooms/<id>` answers with the server's `now`, and the client measures the
  difference from the browser's clock on every `info()`:

```ts
room.onRoom((doc) => show(doc.deadline?.seat, room.timeLeft(doc.deadline)));  // ms left, by the server's clock
room.serverNow();      // the server's time, as near as this browser can tell
room.clockOffset();    // how far ahead the server's clock is, in ms
await room.syncClock(); // ask again (after the phone slept)
```

## How it keeps a hand private

| Collection | Holds | Who reads it |
| --- | --- | --- |
| `rooms/<id>` | seats, started, summary, the deadline that's running | everyone |
| `views/<id>/<seat>` | one seat's view | that seat's holder |
| `games/<id>` | options, seed, seat holders | the server |
| `moves/<id>` | every move and when it was decided, one field each | the server |
| `chat/<id>` | the table's chat, one field per message | everyone at the table |

- **Pages never write.** `authorize` refuses every page push. Moves go to `POST /rooms/<id>/act`, and the server writes the result.
- **A seat is a cookie.** Sitting down sets an HttpOnly `rooms_player` cookie, and `authorize` lets a request read a seat's view only when its cookie holds that seat. `newPlayerId()`, `playerCookie()` and `playerOf()` let the app use the same identity (spades uses it for house membership).
- **Moves can't interleave.** The server decides a move and records it with no `await` in between.
- **Finished games leave memory.** With `finished`, a room's state is dropped once the game ends; a later request replays it from the log.
- **Restarts replay.** After a restart, a room's state is rebuilt by replaying `setup` and its move log, so `act` must be deterministic.

## Two things learned about Sync along the way

- **The live stream is authorized when it opens.** A browser that gets its cookie after connecting (by sitting down) keeps being treated as a stranger until it reconnects; `sit()` reopens the connection for this reason.
- **Sync has no plain-JavaScript way to follow a document yet**; documents reach `'use collection'` components. The client wraps the store (`configure({ store })`, public API) and tells subscribers about every save. A `subscribe(collection, key)` in Sync itself would make this unnecessary.
