import { openRoom, RoomError, type ChatMessage, type Room } from "@spades/rooms/client";
import { TableChat, type ChatProps } from "./Chat";
import type { RoomDoc } from "@spades/rooms/server";
import { cleanSettings, personaFor, pickPersonas, type Seat, type SeatView, type TableSettings } from "@spades/rules";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useEffect, useMemo, useState } from "react";
import { lobby } from "./lobbyApi";
import { loadSavedName, saveName, saveTableSettings } from "./storage";
import { Table } from "./Table";
import { useTable, type Move } from "./useTable";
import type { PalaceMove, PalaceView } from "@cardroom/palace";
import { PalaceTable } from "./palace/PalaceTable";
import { isBoardGame, isKitGame, isSportGame, kitGame, type BoardView, type KitView, type SportView } from "@cardroom/games";
import { GAME_LIST } from "./GamePicker";
import { GameTable } from "./kit/GameTable";
import { OnlineTable, TablePlayers, TableSettingsFields, TurnTimerField, type TablePlayersValue } from "./TableSettings";
import { admin } from "./adminApi";
import { TurnClock } from "./TurnClock";

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

/** A family table on the server: sit down, invite people, fill seats with bots, then play. */
export function RoomTable({ id, onLeave }: { id: string; onLeave: () => void }) {
  const room: AnyRoom = useMemo(() => openRoom<unknown, unknown, Summary>(id), [id]);
  const [doc, setDoc] = useState<RoomDoc<Summary> | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [view, setView] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Seats whose chat this device has hidden, and whether this device is the card room's admin.
  const [hidden, setHidden] = useState<number[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => void admin.amI().then(setIsAdmin), []);

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
    // A phone that slept has a stale idea of the server's clock: ask again when it wakes.
    const woke = () => document.visibilityState === "visible" && void room.syncClock().catch(() => {});
    document.addEventListener("visibilitychange", woke);
    return () => {
      off();
      offChat();
      document.removeEventListener("visibilitychange", woke);
      room.close();
    };
  }, [room]);

  useEffect(() => {
    if (mySeat === null) return;
    return room.onView(mySeat, (doc) => setView(doc.view));
  }, [room, mySeat]);

  // Your seat can be taken away before the deal (the host removed you, or you went quiet at an open
  // table). The public seats say so; check with the server before believing it.
  const seatGone = mySeat !== null && doc !== null && (doc.started ? Boolean(doc.seats[mySeat]?.bot) : !doc.seats[mySeat]?.name);
  useEffect(() => {
    if (!seatGone) return;
    room.info().then((info) => {
      if (info.seat !== null) return;
      setMySeat(null);
      setProblem("You're no longer seated at this table.");
    }, () => undefined);
  }, [room, seatGone]);

  // At an open table, waiting: keep telling the lobby you're still here, or it frees your seat for
  // someone else. A phone that slept may have lost its seat, so look again when the page comes back.
  const waiting = Boolean(doc?.open) && !doc?.started && mySeat !== null;
  useEffect(() => {
    if (!waiting) return;
    const here = () => {
      if (document.visibilityState === "hidden") return;
      lobby.here(id).catch(() => undefined);
    };
    const back = () => {
      if (document.visibilityState === "hidden") return;
      room.info().then((info) => {
        if (info.seat !== null || info.started) return void here();
        setMySeat(null);
        setProblem("You were away a while, so your seat was freed for someone else. Sit back down if one's still open.");
      }, () => undefined);
    };
    // Closing the tab gives the seat back straight away, rather than after the lobby notices the quiet.
    const gone = () => navigator.sendBeacon?.(`/rooms/${encodeURIComponent(id)}/stand`);
    here();
    const timer = setInterval(here, 20_000);
    document.addEventListener("visibilitychange", back);
    addEventListener("pagehide", gone);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
      removeEventListener("pagehide", gone);
    };
  }, [room, id, waiting]);

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

  const chat: ChatProps = {
    messages: hidden.length ? messages.filter((m) => !hidden.includes(m.seat)) : messages,
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
      // Opponents and pace are remembered for the next table; a turn timer belongs to this one.
      saveTableSettings({ skill: next.skill, pace: next.pace });
      await room.settings(next);
    },
  };
  // Every table gets the same countdown, on whichever seat the server's deadline names, and its
  // settings offer the turn timer.
  // The other players, for the ⚙︎ sheet. Anyone can hide someone's chat on their own device. At a
  // table that is or was open to everyone, its host (and the card room's admin) can mute and remove.
  const hosting = doc.host != null && (doc.host === mySeat || isAdmin);
  const players: TablePlayersValue = {
    players: doc.seats.flatMap((s, i) => (i === mySeat || !s.name ? [] : [{ seat: i, name: s.name, bot: s.bot, hidden: hidden.includes(i), muted: Boolean(doc.muted?.includes(i)) }])),
    hide: (seat, hide) => setHidden((was) => (hide ? [...was, seat] : was.filter((s) => s !== seat))),
    mute: hosting ? (seat, muted) => lobby.mute(id, seat, muted) : undefined,
    remove: hosting ? (seat) => lobby.remove(id, seat) : undefined,
    block: isAdmin ? (seat) => admin.block(id, seat) : undefined,
  };
  const online = (table: React.ReactNode) => (
    <OnlineTable.Provider value={true}>
      <TablePlayers.Provider value={players}>
        {table}
        <TurnClock deadline={doc.deadline} mySeat={mySeat} now={room.serverNow} />
      </TablePlayers.Provider>
    </OnlineTable.Provider>
  );

  if (doc.started && mySeat !== null && view) {
    if (isKitGame(game)) {
      return online(
        <GameTable
          view={view as KitView | BoardView | SportView}
          names={doc.seats.map((s, i) => s.name ?? seatLabel(game, i))}
          act={(move) => room.act(move).then(() => null, (e: Error) => e.message)}
          onLeave={onLeave}
          banner={<div className="banner">{(doc as { label?: string }).label ?? `Table ${id}`}</div>}
          chat={chat}
          settings={tableSettings}
        />,
      );
    }
    if (game === "palace") {
      return online(
        <PalaceTable
          view={view as PalaceView}
          seat={mySeat}
          names={doc.seats.map((s, i) => s.name ?? seatLabel(game, i))}
          act={(move: PalaceMove) => room.act(move).then(() => null, (e: Error) => e.message)}
          onLeave={onLeave}
          banner={<div className="banner">Table {id}</div>}
          chat={chat}
          settings={tableSettings}
        />,
      );
    }
    return online(<PlayingTable room={room as unknown as SpadesRoom} view={view as SeatView} seat={mySeat} names={names} onLeave={onLeave} code={id} chat={chat} settings={tableSettings} />);
  }

  // Leaving an open table before the deal gives the seat back, so nobody waits on an empty chair.
  const leave = () => {
    if (waiting) void room.stand().catch(() => undefined);
    onLeave();
  };
  return <Lobby room={room} doc={doc} mySeat={mySeat} onSat={setMySeat} problem={problem} setProblem={setProblem} onLeave={leave} chat={chat} settings={tableSettings} isAdmin={isAdmin} />;
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
}) {
  const table = useTable({
    view: props.view,
    seat: props.seat,
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
      banner={<div className="banner">Table {props.code}</div>}
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
  /** This device is the card room's admin: it may remove at open tables and block anywhere. */
  isAdmin: boolean;
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
          {doc.open && !doc.started ? "An open table: anyone in the card room can take a seat, and it deals as soon as every seat is taken. " : ""}
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
              {!mine && doc.open && !doc.started && doc.host === i && <em>host</em>}
              {doc.muted?.includes(i) && <em>muted</em>}
              {props.isAdmin && !mine && !s.bot && s.name && (
                <button
                  type="button"
                  className="link danger"
                  onClick={() => {
                    if (window.confirm(`Block ${s.name} from the whole card room?`)) attempt(() => admin.block(room.id, i));
                  }}
                >
                  Block
                </button>
              )}
              {doc.open && !doc.started && ((mySeat !== null && doc.host === mySeat) || props.isAdmin) && !mine && !s.bot && s.name && (
                <button
                  type="button"
                  className="link danger"
                  onClick={() => {
                    if (window.confirm(`Remove ${s.name} from the table? They won't be able to sit back down here.`)) attempt(() => lobby.remove(room.id, i));
                  }}
                >
                  Remove
                </button>
              )}
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

      {!doc.started && props.settings && doc.seats.length > 1 && (
        <section className="house-block" aria-label="Turn timer">
          <TurnTimerField settings={props.settings.value} onChange={(next) => attempt(() => props.settings!.change(next))} />
        </section>
      )}
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
          {mySeat !== null && !doc.locked && doc.seats.length > 1 && !full && (
            <button type="button" className="secondary" aria-pressed={Boolean(doc.open)} onClick={() => attempt(() => lobby.setOpen(room.id, !doc.open))}>
              {doc.open ? "Close the table (invited people only)" : "Open the table to everyone"}
            </button>
          )}
          {mySeat !== null && (
            <button type="button" className="primary deal" disabled={!full} onClick={() => attempt(() => room.start())}>
              {full ? (isBoardGame(game) || isSportGame(game) ? "Start the game" : "Deal") : doc.open ? "Waiting for players…" : "Waiting for every seat"}
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
