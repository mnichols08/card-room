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
const { seat } = await room.sit(0, "brokennil");
room.onView(seat, ({ view }) => render(view));    // this seat's view only
await room.act({ type: "bid", bid: { kind: "nil" } });
room.onChat((messages) => render(messages));   // the table's chat, oldest first
await room.say("good luck ♠️");                 // seated players; rooms.say(id, seat, text) on the server, for bots
```

## How it keeps a hand private

| Collection | Holds | Who reads it |
| --- | --- | --- |
| `rooms/<id>` | seats, started, summary | everyone |
| `views/<id>/<seat>` | one seat's view | that seat's holder |
| `games/<id>` | options, seed, seat holders | the server |
| `moves/<id>` | every move, one field each | the server |
| `chat/<id>` | the table's chat, one field per message | everyone at the table |

- **Pages never write.** `authorize` refuses every page push. Moves go to `POST /rooms/<id>/act`, and the server writes the result.
- **A seat is a cookie.** Sitting down sets an HttpOnly `rooms_player` cookie, and `authorize` lets a request read a seat's view only when its cookie holds that seat. `newPlayerId()`, `playerCookie()` and `playerOf()` let the app use the same identity (spades uses it for house membership).
- **Moves can't interleave.** The server decides a move and records it with no `await` in between.
- **Finished games leave memory.** With `finished`, a room's state is dropped once the game ends; a later request replays it from the log.
- **Restarts replay.** After a restart, a room's state is rebuilt by replaying `setup` and its move log, so `act` must be deterministic.

## Letting people watch

Give the room a `watch(state, views)` and the server writes one more view after each move,
`views/<id>/watch`, that anyone may read (`spectators()` in the options can say otherwise). A page
follows it with `room.onView("watch", …)`.

`sharedView(views, { blank, from })` builds that view from every seat's: what all the seats see
alike is kept, and what differs between them becomes null or an empty list, so a watcher learns
nothing that every player doesn't already know. Name the private parts in `blank` as well (two
hands that happened to match in some detail would otherwise show it), and in `from` the keys that
say where the viewer sits.

A table that's all computer players can be opened right up instead: `exhibit(id)` lets anyone read
every seat's view.

## Two things learned about Sync along the way

- **The live stream is authorized when it opens.** A browser that gets its cookie after connecting (by sitting down) keeps being treated as a stranger until it reconnects; `sit()` reopens the connection for this reason.
- **Sync has no plain-JavaScript way to follow a document yet**; documents reach `'use collection'` components. The client wraps the store (`configure({ store })`, public API) and tells subscribers about every save. A `subscribe(collection, key)` in Sync itself would make this unnecessary.
