import { openRoom, RoomError, type ChatMessage, type Room } from "@spades/rooms/client";
import { TableChat, type ChatProps } from "./Chat";
import type { RoomDoc } from "@spades/rooms/server";
import { cleanSettings, partnerOf, personaFor, pickPersonas, seatsOf, teamOf, type Seat, type SeatView, type TableSettings } from "@spades/rules";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { applyDeck, deckAtTable, prefersOwnDeck, savedDeck, type TableDeck } from "@cardroom/decks";
import { TableDeckPicker } from "./TableDeck";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadSavedName, saveName, saveTableSettings } from "./storage";
import { Table } from "./Table";
import { useTable, type Move } from "./useTable";
import type { PalaceMove, PalaceView } from "@cardroom/palace";
import { PalaceTable } from "./palace/PalaceTable";
import { isKitGame, kitGame, type KitView } from "@cardroom/games";
import { GAME_LIST } from "./GamePicker";
import { KitTable } from "./kit/KitTable";
import { TableSettingsFields } from "./TableSettings";

type Summary = { game?: string; rules: string; scores?: { points: number }[]; hand?: number; finished?: number[] };
type AnyRoom = Room<unknown, unknown, Summary>;
type SpadesRoom = Room<SeatView, Move, Summary>;
type Info = { game?: string; rules?: string } | null;
const gameOf = (doc: RoomDoc<Summary>): string => {
  const g = (doc as { info?: Info }).info?.game ?? doc.summary?.game;
  return g === "palace" || isKitGame(g) ? g! : "spades";
};
/** Seats by compass point in spades and other four-seat partnership games; numbered otherwise. */
const seatLabel = (game: string, i: number) => (game === "spades" ? SEAT_LABELS[i]! : `Seat ${i + 1}`);

const SEAT_LABELS = ["South", "West", "North", "East"];
const WATCHING = "You're watching: the computer plays this seat.";

/** A family table on the server: sit down, invite people, fill seats with bots, then play. */
export function RoomTable({ id, onLeave }: { id: string; onLeave: () => void }) {
  const room: AnyRoom = useMemo(() => openRoom<unknown, unknown, Summary>(id), [id]);
  const [doc, setDoc] = useState<RoomDoc<Summary> | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [view, setView] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Someone without a seat watches. At a table of computer players they look over one seat's
  // shoulder and see its hand. At a table with people they see the table from one seat's side and
  // nobody's hand (the server's watch view), if the card room's host lets people watch.
  const [watchSeat, setWatchSeat] = useState(0);
  const overShoulder = mySeat === null && !!doc?.watchable;
  const fromTheSide = mySeat === null && !!doc?.started && !doc.watchable;
  const source: Seat | "watch" | null = overShoulder ? (watchSeat as Seat) : fromTheSide ? "watch" : mySeat;
  const watching = overShoulder || (fromTheSide && view !== null);
  const seat = watching ? (watchSeat as Seat) : mySeat;

  useEffect(() => {
    room
      .info()
      .then((info) => {
        setDoc(info);
        setMySeat(info.seat as Seat | null);
      })
      .catch((e) => (e instanceof RoomError && e.status === 404 ? setMissing(true) : setProblem(String(e.message ?? e))));
    const off = room.onRoom((next) => setDoc((prev) => ({ ...prev, ...next }) as RoomDoc<Summary>));
    const offChat = room.onChat(setMessages);
    return () => {
      off();
      offChat();
      room.close();
    };
  }, [room]);

  // The table's deck dresses every card on the page while this table is open: the same cards for
  // everyone here, unless this browser's owner always wants their own (set in the card designer).
  const tableDeck = (doc?.deck ?? null) as TableDeck | null;
  const deckKey = tableDeck ? JSON.stringify(tableDeck) : "";
  useEffect(() => {
    const dress = () => applyDeck(document.documentElement, deckAtTable(tableDeck, savedDeck(), prefersOwnDeck()));
    dress();
    // Choosing another deck in the designer's tab changes the cards here at once.
    window.addEventListener("storage", dress);
    return () => {
      window.removeEventListener("storage", dress);
      applyDeck(document.documentElement, savedDeck());
    };
  }, [deckKey]);

  useEffect(() => {
    if (source === null) return;
    setView(null);
    return room.onView(source, (doc) => setView(doc.view));
  }, [room, source]);

  if (missing) {
    return (
      <main className="setup lobby">
        <h1>No table here</h1>
        <p>There's no table with the code {id}. Check the link, or start a new one.</p>
        <button type="button" className="primary" onClick={onLeave}>
          Back
        </button>
      </main>
    );
  }
  if (!doc) return <main className="setup lobby"><p>Finding the table…</p></main>;
  // The card room's host closed this table (the admin app): nothing more can happen here.
  if (doc.closed) {
    return (
      <main className="setup lobby">
        <h1>This table is closed</h1>
        <p>{doc.closed}</p>
        <button type="button" className="primary" onClick={onLeave}>
          Back
        </button>
      </main>
    );
  }

  const chat: ChatProps = {
    messages,
    mySeat,
    send: (text) =>
      room.say(text).then(
        () => null,
        (e: Error) => e.message,
      ),
  };
  const game = gameOf(doc);
  const names = Object.fromEntries(doc.seats.map((s, i) => [i, s.name ?? seatLabel(game, i)])) as Record<Seat, string>;

  // The table's settings, which anyone seated can change mid-game.
  const tableSettings = mySeat === null ? undefined : {
    value: cleanSettings((doc as { settings?: unknown }).settings),
    change: async (next: TableSettings) => {
      saveTableSettings(next);
      await room.settings(next);
    },
  };

  // A watcher's taps don't play: the computer plays every seat.
  const act = watching ? () => Promise.resolve<string | null>(WATCHING) : (move: unknown) => room.act(move).then(() => null, (e: Error) => e.message);
  const banner = watching ? (
    <div className="banner watching">
      <label>
        👀 Watching {overShoulder ? "over" : "from"}{" "}
        <select value={watchSeat} onChange={(e) => setWatchSeat(Number(e.target.value))}>
          {doc.seats.map((s, i) => (
            <option key={i} value={i}>
              {s.name ?? seatLabel(game, i)}
            </option>
          ))}
        </select>
        {overShoulder ? "’s shoulder" : "’s side"}
      </label>
      {!overShoulder && <span className="hint">Hands are hidden</span>}
    </div>
  ) : null;

  if (doc.started && seat !== null && view) {
    if (isKitGame(game)) {
      return (
        <KitTable
          // The watch view looks on from the first seat; turn it to the side being watched from.
          view={fromTheSide ? { ...(view as KitView), me: seat } : (view as KitView)}
          watching={watching}
          names={doc.seats.map((s, i) => s.name ?? seatLabel(game, i))}
          act={act}
          onLeave={onLeave}
          banner={banner ?? <div className="banner">{(doc as { label?: string }).label ?? `Table ${id}`}</div>}
          chat={chat}
          settings={tableSettings}
        />
      );
    }
    if (game === "palace") {
      return (
        <PalaceTable
          view={view as PalaceView}
          seat={seat}
          watching={watching}
          names={doc.seats.map((s, i) => s.name ?? seatLabel(game, i))}
          act={act as (move: PalaceMove) => Promise<string | null>}
          onLeave={onLeave}
          banner={banner ?? <div className="banner">Table {id}</div>}
          chat={chat}
          settings={tableSettings}
        />
      );
    }
    // Spades asks its room to act: a watcher's room refuses.
    const spades = (watching ? { ...room, act: () => Promise.reject(new Error(WATCHING)) } : room) as unknown as SpadesRoom;
    const turned = fromTheSide ? ({ ...(view as SeatView), seat, team: teamOf(seat), partner: partnerOf(seat), teamSeats: seatsOf(teamOf(seat)) } as SeatView) : (view as SeatView);
    return <PlayingTable room={spades} view={turned} seat={seat} names={names} onLeave={onLeave} code={id} chat={chat} settings={tableSettings} banner={banner} watching={watching} />;
  }
  if (overShoulder) {
    return (
      <main className="setup lobby">
        <p>Pulling up a chair…</p>
      </main>
    );
  }

  return <Lobby room={room} doc={doc} mySeat={mySeat} onSat={setMySeat} problem={problem} setProblem={setProblem} onLeave={onLeave} chat={chat} settings={tableSettings} />;
}

function PlayingTable(props: {
  room: SpadesRoom;
  view: SeatView;
  seat: Seat;
  names: Record<Seat, string>;
  onLeave: () => void;
  code: string;
  chat: ChatProps;
  settings?: { value: TableSettings; change: (next: TableSettings) => Promise<void> };
  banner?: ReactNode;
  watching?: boolean;
}) {
  const table = useTable({
    view: props.view,
    seat: props.seat,
    watching: props.watching,
    act: (move) =>
      props.room.act(move).then(
        () => null,
        (e: Error) => e.message,
      ),
  });
  return (
    <Table
      table={table}
      names={props.names}
      onLeave={props.onLeave}
      banner={props.banner ?? <div className="banner">Table {props.code}</div>}
      chat={props.chat}
      settings={props.settings}
    />
  );
}

function Lobby(props: {
  room: AnyRoom;
  doc: RoomDoc<Summary>;
  mySeat: Seat | null;
  onSat: (seat: Seat) => void;
  problem: string | null;
  setProblem: (p: string | null) => void;
  onLeave: () => void;
  chat: ChatProps;
  settings?: { value: TableSettings; change: (next: TableSettings) => Promise<void> };
}) {
  const { room, doc, mySeat } = props;
  const game = gameOf(doc);
  const about = GAME_LIST.find((g) => g.id === game) ?? GAME_LIST[0]!;
  const partners = game === "spades" || (isKitGame(game) && kitGame(game)!.teams);
  const info = (doc as { info?: Info }).info;
  const [name, setName] = useState(loadSavedName);
  const [copied, setCopied] = useState(false);
  const link = typeof location === "undefined" ? "" : `${location.origin}${location.pathname}?table=${room.id}`;
  const full = doc.seats.every((s) => s.bot || s.name);

  const attempt = (work: () => Promise<unknown>) => {
    props.setProblem(null);
    work().catch((e: Error) => props.setProblem(e.message));
  };

  async function share() {
    const text = `Pull up a chair: join my ${about.name} table ${about.emoji}`;
    try {
      if (navigator.share) await navigator.share({ title: about.name, text, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* the person closed the share sheet */
    }
  }

  return (
    <main className="setup lobby">
      <TableChat {...props.chat} />
      <header className="setup-head">
        <div className="suits" aria-hidden>
          {game === "spades" ? "♠ ♥ ♣ ♦" : about.emoji}
        </div>
        <h1>{doc.label ?? `${about.name} · Table ${room.id}`}</h1>
        <p>
          {doc.started ? "This game has started." : doc.locked ? (mySeat !== null ? "Your tournament match. Deal when you're ready; the game waits for whoever's turn it is." : "A tournament match. The seats are set.") : game === "palace" ? "First one out wins. Fill empty seats with bots." : partners ? "Partners sit across from each other." : `${about.blurb}. Fill empty seats with bots.`}
          {info?.rules ? ` ${info.rules}.` : ""}
        </p>
      </header>

      {mySeat === null && !doc.started && (
        <TextField label={game === "spades" ? "Your spades name" : "Your name"} required value={name} maxlength={20} autocomplete="nickname" onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />
      )}

      <ol className="seats" aria-label="Seats">
        {doc.seats.map((s, i) => {
          const mine = mySeat === i;
          const empty = !s.bot && !s.name;
          return (
            <li key={i} className={`seat-row ${partners ? `team-${i % 2 === 0 ? "a" : "b"}` : ""} ${mine ? "mine" : ""}`}>
              <span className="where">{seatLabel(game, i)}</span>
              <strong>
                {s.bot ? `${s.name} (bot)` : (s.name ?? "Empty")}
                {/* The blurbs describe how they play spades. */}
                {game === "spades" && s.bot && s.name && personaFor(s.name).blurb && <small className="blurb">{personaFor(s.name).blurb}</small>}
              </strong>
              {mine && <em>you</em>}
              {!doc.started && !doc.locked && empty && mySeat === null && (
                <button
                  type="button"
                  className="secondary small"
                  disabled={!name.trim()}
                  onClick={() =>
                    attempt(async () => {
                      saveName(name.trim());
                      const { seat } = await room.sit(i, name.trim());
                      props.onSat(seat as Seat);
                    })
                  }
                >
                  Sit here
                </button>
              )}
              {!doc.started && !doc.locked && empty && mySeat !== null && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    // A random partner from the roster, not one already at the table.
                    const taken = doc.seats.flatMap((s) => (s.bot && s.name ? [s.name] : []));
                    const [pick] = pickPersonas(1, Math.random, taken);
                    void attempt(() => room.addBot(i, pick?.name));
                  }}
                >
                  Add a bot
                </button>
              )}
              {!doc.started && !doc.locked && s.bot && mySeat !== null && (
                <button type="button" className="link" onClick={() => attempt(() => room.removeBot(i))}>
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <TableDeckPicker table={room.id} deck={(doc.deck ?? null) as TableDeck | null} canChoose={!doc.started && mySeat !== null} onProblem={props.setProblem} />
      {!doc.started && props.settings && doc.seats.some((s) => s.bot) && (
        <section className="house-block" aria-label="Computer players">
          <TableSettingsFields settings={props.settings.value} onChange={(next) => attempt(() => props.settings!.change(next))} />
        </section>
      )}
      {!doc.started && (
        <>
          {!doc.locked && (
            <button type="button" className="secondary" onClick={share}>
              {copied ? "Link copied" : "Invite people"}
            </button>
          )}
          {mySeat !== null && (
            <button type="button" className="primary deal" disabled={!full} onClick={() => attempt(() => room.start())}>
              {full ? "Deal" : "Waiting for every seat"}
            </button>
          )}
        </>
      )}
      {doc.started && mySeat === null && doc.summary?.scores && (
        <p className="rules-summary">
          Hand {doc.summary.hand} · {doc.summary.scores[0]!.points} to {doc.summary.scores[1]!.points}
        </p>
      )}
      {props.problem && <p className="error">{props.problem}</p>}
      <button type="button" className="link" onClick={props.onLeave}>
        Leave
      </button>
    </main>
  );
}
