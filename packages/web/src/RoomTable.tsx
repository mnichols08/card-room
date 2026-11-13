import { openRoom, RoomError, type ChatMessage, type Room } from "@spades/rooms/client";
import { TableChat, type ChatProps } from "./Chat";
import type { RoomDoc } from "@spades/rooms/server";
import { personaFor, pickPersonas, type Seat, type SeatView } from "@spades/rules";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useEffect, useMemo, useState } from "react";
import { loadSavedName, saveName } from "./storage";
import { Table } from "./Table";
import { useTable, type Move } from "./useTable";
import type { PalaceMove, PalaceView } from "@cardroom/palace";
import { PalaceTable } from "./palace/PalaceTable";

type Summary = { game?: string; rules: string; scores?: { points: number }[]; hand?: number; finished?: number[] };
type AnyRoom = Room<unknown, unknown, Summary>;
type SpadesRoom = Room<SeatView, Move, Summary>;
type Info = { game?: "spades" | "palace"; rules?: string } | null;
const gameOf = (doc: RoomDoc<Summary>) => ((doc as { info?: Info }).info?.game === "palace" || doc.summary?.game === "palace" ? "palace" : "spades");
const seatLabel = (game: string, i: number) => (game === "palace" ? `Seat ${i + 1}` : SEAT_LABELS[i]!);

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

  useEffect(() => {
    if (mySeat === null) return;
    return room.onView(mySeat, (doc) => setView(doc.view));
  }, [room, mySeat]);

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

  if (doc.started && mySeat !== null && view) {
    if (game === "palace") {
      return (
        <PalaceTable
          view={view as PalaceView}
          seat={mySeat}
          names={doc.seats.map((s, i) => s.name ?? seatLabel(game, i))}
          act={(move: PalaceMove) => room.act(move).then(() => null, (e: Error) => e.message)}
          onLeave={onLeave}
          banner={<div className="banner">Table {id}</div>}
          chat={chat}
        />
      );
    }
    return <PlayingTable room={room as unknown as SpadesRoom} view={view as SeatView} seat={mySeat} names={names} onLeave={onLeave} code={id} chat={chat} />;
  }

  return <Lobby room={room} doc={doc} mySeat={mySeat} onSat={setMySeat} problem={problem} setProblem={setProblem} onLeave={onLeave} chat={chat} />;
}

function PlayingTable(props: { room: SpadesRoom; view: SeatView; seat: Seat; names: Record<Seat, string>; onLeave: () => void; code: string; chat: ChatProps }) {
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
}) {
  const { room, doc, mySeat } = props;
  const game = gameOf(doc);
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
    const text = game === "palace" ? "Pull up a chair: join my Palace table 🏰" : "Pull up a chair: join my spades table.";
    try {
      if (navigator.share) await navigator.share({ title: game === "palace" ? "Palace" : "Spades", text, url: link });
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
          {game === "palace" ? "🏰" : "♠ ♥ ♣ ♦"}
        </div>
        <h1>{game === "palace" ? "Palace" : "Spades"} · Table {room.id}</h1>
        <p>
          {doc.started ? "This game has started." : game === "palace" ? "First one out wins. Fill empty seats with bots." : "Partners sit across from each other."}
          {info?.rules ? ` ${info.rules}.` : ""}
        </p>
      </header>

      {mySeat === null && !doc.started && (
        <TextField label={game === "palace" ? "Your name" : "Your spades name"} required value={name} maxlength={20} autocomplete="nickname" onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />
      )}

      <ol className="seats" aria-label="Seats">
        {doc.seats.map((s, i) => {
          const mine = mySeat === i;
          const empty = !s.bot && !s.name;
          return (
            <li key={i} className={`seat-row ${game === "palace" ? "" : `team-${i % 2 === 0 ? "a" : "b"}`} ${mine ? "mine" : ""}`}>
              <span className="where">{seatLabel(game, i)}</span>
              <strong>
                {s.bot ? `${s.name} (bot)` : (s.name ?? "Empty")}
                {/* The blurbs describe how they play spades. */}
                {game === "spades" && s.bot && s.name && personaFor(s.name).blurb && <small className="blurb">{personaFor(s.name).blurb}</small>}
              </strong>
              {mine && <em>you</em>}
              {!doc.started && empty && mySeat === null && (
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
              {!doc.started && empty && mySeat !== null && (
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
              {!doc.started && s.bot && mySeat !== null && (
                <button type="button" className="link" onClick={() => attempt(() => room.removeBot(i))}>
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {!doc.started && (
        <>
          <button type="button" className="secondary" onClick={share}>
            {copied ? "Link copied" : "Invite people"}
          </button>
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
