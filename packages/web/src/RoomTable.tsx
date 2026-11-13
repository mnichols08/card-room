import { openRoom, RoomError, type ChatMessage, type Room } from "@spades/rooms/client";
import { TableChat, type ChatProps } from "./Chat";
import type { RoomDoc } from "@spades/rooms/server";
import { personaFor, pickPersonas, type Seat, type SeatView } from "@spades/rules";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useEffect, useMemo, useState } from "react";
import { loadSavedName, saveName } from "./storage";
import { Table } from "./Table";
import { useTable, type Move } from "./useTable";

type Summary = { rules: string; scores: { points: number }[]; hand: number };
type SpadesRoom = Room<SeatView, Move, Summary>;

const SEAT_LABELS = ["South", "West", "North", "East"];

/** A family table on the server: sit down, invite people, fill seats with bots, then play. */
export function RoomTable({ id, onLeave }: { id: string; onLeave: () => void }) {
  const room: SpadesRoom = useMemo(() => openRoom<SeatView, Move, Summary>(id), [id]);
  const [doc, setDoc] = useState<RoomDoc<Summary> | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [view, setView] = useState<SeatView | null>(null);
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
  const names = Object.fromEntries(doc.seats.map((s, i) => [i, s.name ?? SEAT_LABELS[i]!])) as Record<Seat, string>;

  if (doc.started && mySeat !== null && view) {
    return <PlayingTable room={room} view={view} seat={mySeat} names={names} onLeave={onLeave} code={id} chat={chat} />;
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
  room: SpadesRoom;
  doc: RoomDoc<Summary>;
  mySeat: Seat | null;
  onSat: (seat: Seat) => void;
  problem: string | null;
  setProblem: (p: string | null) => void;
  onLeave: () => void;
  chat: ChatProps;
}) {
  const { room, doc, mySeat } = props;
  const [name, setName] = useState(loadSavedName);
  const [copied, setCopied] = useState(false);
  const link = typeof location === "undefined" ? "" : `${location.origin}${location.pathname}?table=${room.id}`;
  const full = doc.seats.every((s) => s.bot || s.name);

  const attempt = (work: () => Promise<unknown>) => {
    props.setProblem(null);
    work().catch((e: Error) => props.setProblem(e.message));
  };

  async function share() {
    const text = "Pull up a chair: join my spades table.";
    try {
      if (navigator.share) await navigator.share({ title: "Spades", text, url: link });
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
          ♠ ♥ ♣ ♦
        </div>
        <h1>Table {room.id}</h1>
        <p>{doc.started ? "This game has started." : "Partners sit across from each other."}</p>
      </header>

      {mySeat === null && !doc.started && (
        <TextField label="Your spades name" required value={name} maxlength={20} autocomplete="nickname" onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />
      )}

      <ol className="seats" aria-label="Seats">
        {doc.seats.map((s, i) => {
          const mine = mySeat === i;
          const empty = !s.bot && !s.name;
          return (
            <li key={i} className={`seat-row team-${i % 2 === 0 ? "a" : "b"} ${mine ? "mine" : ""}`}>
              <span className="where">{SEAT_LABELS[i]}</span>
              <strong>
                {s.bot ? `${s.name} (bot)` : (s.name ?? "Empty")}
                {s.bot && s.name && personaFor(s.name).blurb && <small className="blurb">{personaFor(s.name).blurb}</small>}
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
      {doc.started && mySeat === null && doc.summary && (
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
