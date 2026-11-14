// One table for every game on the board kit, as KitTable is for the card games. The engine's view
// says everything: the grid and what is on it, which cells a tap plays, which pieces can be picked
// up and where each can go, the buttons, the scores. This only lays it out and sends what the view
// offers: the other players above, the board in the middle, you below.
//
// Every cell is a button with a spoken name ("centre: X, yours"), the arrow keys walk the board,
// and what just happened is read out, so the board can be played without seeing it.
import { cellName, colOf, kitGame, rowOf, type BoardGrid, type BoardPiece, type BoardReserve, type BoardView } from "@cardroom/games";
import { type TableSettings } from "@spades/rules";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bubble, TableChat, useBubbles, type ChatProps } from "../Chat";
import { Confetti } from "../Confetti";
import { loadFeedbackSettings, play, saveFeedbackSettings } from "../feedback/sounds";
import { named, ResultTable, sideName } from "../kit/KitTable";
import { motionScale, useCardFlip } from "../motion";
import { TableSettingsButton } from "../TableSettings";

export interface BoardTableProps {
  view: BoardView;
  names: string[];
  /** Resolves to an error message when the move is refused. */
  act: (move: Record<string, unknown>) => Promise<string | null>;
  onLeave: () => void;
  banner?: React.ReactNode;
  chat?: ChatProps;
  settings?: {
    value: TableSettings;
    change: (next: TableSettings) => Promise<void> | void;
  };
}

/** Something picked up, waiting for where it goes: a cell of a grid, or a kind of piece in your reserve. */
interface Picked {
  grid: string;
  from: number | string;
}

/**
 * The source a tap on `cell` picks up: the piece there, or (for a piece that covers several cells,
 * all with one `span`) the piece that cell is part of.
 */
function sourceAt(grid: BoardGrid, cell: number) {
  const sources = grid.select?.sources ?? [];
  const span = grid.cells[cell]?.span;
  return sources.find((s) => s.from === cell) ?? (span ? sources.find((s) => typeof s.from === "number" && grid.cells[s.from]?.span === span) : undefined);
}

/** A piece's colour: its own, or its owner's (the first seat's, the second's…). */
const SEAT_TONES = ["red", "blue", "green", "gold", "dark", "light"];
const toneOf = (piece: BoardPiece) => piece.tone ?? (piece.owner === null ? "dark" : SEAT_TONES[piece.owner % SEAT_TONES.length]!);

function Piece({ piece, small }: { piece: BoardPiece; small?: boolean }) {
  return (
    <span className={`piece tone-${toneOf(piece)} kind-${piece.kind}${piece.faded ? " faded" : ""}${small ? " small" : ""}`} data-flip={small ? undefined : piece.id} aria-hidden>
      {piece.glyph}
    </span>
  );
}

export function BoardTable({ view, names, act, onLeave, banner, chat, settings }: BoardTableProps) {
  const game = kitGame(view.game)!;
  const me = view.me;
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [soundOn, setSoundOn] = useState(() => loadFeedbackSettings().sound);
  const bubbles = useBubbles(chat?.messages ?? []);
  const root = useRef<HTMLElement>(null);
  // Pieces that keep an id from move to move slide to where they went, the way cards do.
  useCardFlip(root, motionScale(settings?.value.pace));
  const others = Array.from({ length: view.seats - 1 }, (_, i) => (me + 1 + i) % view.seats);
  const draw = !!view.over && view.over.winners.length === view.seats && view.seats > 1;
  const won = !!view.over && !draw && view.over.winners.includes(me);

  // Whatever was picked up is put down when the board moves on, unless it can still be picked up:
  // a ship in your hand stays there while you press the button that turns it.
  const offered = (p: Picked) => !!view.grids.find((g) => g.id === p.grid)?.select?.sources.some((s) => s.from === p.from);
  const selectKey = JSON.stringify(view.grids.map((g) => g.select?.sources ?? null));
  useEffect(() => setPicked((p) => (p && offered(p) ? p : null)), [selectKey]);
  // With nothing picked up, you hold what the view suggests (the next ship to place), if anything.
  const suggesting = view.grids.find((g) => g.select?.suggest !== undefined);
  const held: Picked | null = picked ?? (suggesting ? { grid: suggesting.id, from: suggesting.select!.suggest! } : null);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(t);
  }, [error]);

  // Sounds: a piece landing, your turn, the end.
  const boardKey = JSON.stringify(view.grids.map((g) => g.cells.map((p) => (p ? [p.owner, p.kind] : 0))));
  const pieces = view.grids.reduce((n, g) => n + g.cells.filter(Boolean).length, 0);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    // A board swept clean for the next game makes no sound.
    if (seen.current !== null && seen.current !== boardKey && pieces > 0) play("piece");
    seen.current = boardKey;
  }, [boardKey]);
  const turnSeen = useRef(false);
  useEffect(() => {
    if (view.turn === me && !turnSeen.current) play("yourTurn");
    turnSeen.current = view.turn === me;
  }, [view.turn, me]);
  const overSeen = useRef(!!view.over);
  useEffect(() => {
    if (view.over && !overSeen.current) play(draw ? "handDone" : won ? "won" : "lost");
    overSeen.current = !!view.over;
  }, [view.over, draw, won]);

  /** `keep` leaves what's picked up in your hand: for a button, which isn't a move of that piece. */
  const send = async (move: Record<string, unknown>, keep = false) => {
    if (!keep) setPicked(null);
    const refused = await act(move);
    if (refused) {
      setError(refused);
      play("nope");
    }
  };
  /** A view with two boards says which one a move is on. */
  const onGrid = (grid: BoardGrid) => (view.grids.length > 1 ? { grid: grid.id } : {});

  function tapCell(grid: BoardGrid, cell: number) {
    const sources = grid.select?.sources ?? [];
    const holding = held?.grid === grid.id ? sources.find((s) => s.from === held.from) : undefined;
    if (holding?.to.includes(cell)) return void send({ type: grid.select!.type, from: holding.from, to: cell, ...onGrid(grid) });
    const source = sourceAt(grid, cell);
    if (source) return setPicked(picked?.grid === grid.id && picked.from === source.from ? null : { grid: grid.id, from: source.from });
    if (grid.tap) {
      if (grid.tap.by === "col") {
        const col = colOf(grid.cols, cell);
        if (grid.tap.cells.some((c) => colOf(grid.cols, c) === col)) return void send({ type: grid.tap.type, col, ...onGrid(grid) });
      } else if (grid.tap.cells.includes(cell)) return void send({ type: grid.tap.type, cell, ...onGrid(grid) });
    }
    if (picked) return setPicked(null);
    if (grid.tap || sources.length) {
      setError("You can't play there.");
      play("nope");
    }
  }

  function toggleSound() {
    const next = { ...loadFeedbackSettings(), sound: !soundOn };
    saveFeedbackSettings(next);
    setSoundOn(next.sound);
  }

  const canMove = view.grids.some((g) => g.tap?.cells.length || g.select?.sources.length);
  const status = error ? (
    <span className="error">{error}</span>
  ) : view.over || view.result ? null : held ? (
    <span className="mine">Now pick where it goes</span>
  ) : view.turn === me || (view.turn === null && canMove) ? (
    <span className="mine">Your turn</span>
  ) : view.turn !== null ? (
    `${names[view.turn] ?? "Someone"} is thinking…`
  ) : view.choices ? null : (
    "Waiting for everyone…"
  );

  const reserveOf = (seat: number) => view.reserves.filter((r) => r.owner === seat);
  // A piece in your reserve can be picked up when some grid lists its kind as a source.
  const reserveGrid = (kind: string) => view.grids.find((g) => g.select?.sources.some((s) => s.from === kind));

  return (
    <main className={`table kit board board-${view.game}`} ref={root} onKeyDown={(e) => e.key === "Escape" && setPicked(null)}>
      <header className="palace-bar kit-bar">
        <button type="button" className="leave" aria-label="Leave game" onClick={() => (view.over || confirm("Leave this game?")) && onLeave()}>
          ←
        </button>
        <div className="kit-scores" aria-label="Scores">
          {view.scores.map((s, i) => (
            <span key={i} className={`kit-score${s.seats.includes(me) ? " us" : ""}`}>
              <small>{sideName(s.seats, names)}</small>
              <strong>{s.value}</strong>
            </span>
          ))}
        </div>
        <span className="bar-buttons">
          {settings && <TableSettingsButton settings={settings.value} onChange={settings.change} />}
          <button type="button" className="sound-toggle inline" onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? "Turn sounds off" : "Turn sounds on"}>
            {soundOn ? "🔊" : "🔇"}
          </button>
        </span>
      </header>
      {banner}

      <div className="felt board-felt">
        {others.length > 0 && (
          <div className="board-others">
            {others.map((seat) => (
              <div key={seat} className="opp top" data-seat={seat}>
                <BoardSeat view={view} seat={seat} name={names[seat] ?? `Seat ${seat + 1}`} />
                {reserveOf(seat).map((r, i) => (
                  <Reserve key={i} reserve={r} names={names} />
                ))}
              </div>
            ))}
          </div>
        )}

        <div className={`boards${view.grids.length > 1 ? " many" : ""}`}>
          {view.grids.map((grid, i) => (
            <Grid key={grid.id} grid={grid} view={view} names={names} side={i > 0} titled={view.grids.length > 1} picked={held?.grid === grid.id ? held.from : null} onCell={(cell) => tapCell(grid, cell)} />
          ))}
        </div>

        <div className="center-info">
          {view.info.length > 0 && (
            <ul className="kit-info">
              {view.info.map((line, i) => (
                <li key={i}>{named(line, names)}</li>
              ))}
            </ul>
          )}
          <p className="narration" aria-live="polite">
            {view.narration ? named(view.narration, names) : null}
          </p>
          <div className="status" role="status">
            {status}
          </div>
          {view.choices && !view.result && (
            <div className={`felt-actions kit-choices ${view.choices.layout ?? ""}`}>
              {view.choices.prompt && <p>{named(view.choices.prompt, names)}</p>}
              {view.choices.options.map((o, i) => (
                <button key={i} type="button" className={o.primary ? "primary" : "secondary"} title={o.hint} onClick={() => void send(o.move, true)}>
                  {named(o.label, names)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <section className="me" data-seat={me}>
        {chat && <TableChat {...chat} />}
        <div className="me-badge">
          <BoardSeat view={view} seat={me} name={names[me] ?? "You"} row />
        </div>
        {reserveOf(me).map((r, i) => (
          <Reserve
            key={i}
            reserve={r}
            names={names}
            picked={held && typeof held.from === "string" ? held.from : null}
            canPick={(kind) => !!reserveGrid(kind)}
            onPick={(kind) => {
              const grid = reserveGrid(kind);
              if (grid) setPicked(picked?.from === kind ? null : { grid: grid.id, from: kind });
            }}
          />
        ))}
      </section>

      <div className="bubble-layer" aria-live="polite">
        {[...bubbles.entries()].map(([s, m]) => (
          <Bubble key={`${s}-${m.at}`} message={m} side={s === me ? "bottom" : "top"} />
        ))}
      </div>

      {view.result && !view.over && (
        <div className="sheet">
          <ResultTable result={view.result} names={names} me={me} />
          {view.choices ? (
            view.choices.options.map((o, i) => (
              <button key={i} type="button" className={o.primary ? "primary" : "secondary"} onClick={() => void send(o.move)}>
                {named(o.label, names)}
              </button>
            ))
          ) : (
            <p className="fine">Waiting for everyone…</p>
          )}
        </div>
      )}
      {won && <Confetti />}
      {view.over && (
        <div className="sheet won-sheet board-over">
          <h2>{won ? "You won! 🏆" : named(view.over.title, names)}</h2>
          {won && !view.result && !view.over.title.includes(`{${me}}`) && <p className="won-line">{named(view.over.title, names)}</p>}
          {view.result && <ResultTable result={view.result} names={names} me={me} untitled />}
          <button type="button" className="primary" onClick={onLeave}>
            Play again
          </button>
        </div>
      )}
      <p className="sr-only">{game.name}</p>
    </main>
  );
}

/** A player at the board: name, what they play as, their line, and whether it's their move. */
function BoardSeat({ view, seat, name, row }: { view: BoardView; seat: number; name: string; row?: boolean }) {
  const p = view.players[seat]!;
  const active = view.turn === seat && !view.over;
  const team = view.teams ? (seat % 2 === view.me % 2 ? "us" : "them") : "";
  return (
    <div className={`kit-seat board-seat ${team}${active ? " active" : ""}${p.out ? " out" : ""}${row ? " row" : ""}`} aria-current={active ? "true" : undefined}>
      <strong>
        {p.piece && <Piece piece={p.piece} small />}
        {name}
        {p.piece && <span className="sr-only"> plays {p.piece.label}</span>}
      </strong>
      {p.line && <span>{named(p.line, [])}</span>}
      {p.badge && <em>{p.badge}</em>}
    </div>
  );
}

/** Pieces off the board. Your own can be picked up when the view says where they can go. */
function Reserve({ reserve, names, picked, canPick, onPick }: { reserve: BoardReserve; names: string[]; picked?: string | null; canPick?: (kind: string) => boolean; onPick?: (kind: string) => void }) {
  const shown = reserve.pieces.filter((p) => p.count > 0);
  if (!shown.length) return null;
  return (
    <div className="board-reserve" role="group" aria-label={named(`${reserve.label}: {${reserve.owner}}`, names)}>
      <small>{reserve.label}</small>
      {shown.map(({ piece, count }) => {
        const body = (
          <>
            <Piece piece={piece} small />
            {count > 1 && <span className="count">×{count}</span>}
          </>
        );
        const label = `${piece.label}${count > 1 ? `, ${count}` : ""}`;
        return canPick?.(piece.kind) ? (
          <button key={piece.kind} type="button" className={`reserve-piece${picked === piece.kind ? " picked" : ""}`} aria-pressed={picked === piece.kind} aria-label={label} onClick={() => onPick?.(piece.kind)}>
            {body}
          </button>
        ) : (
          <span key={piece.kind} className="reserve-piece" role="img" aria-label={label}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

const MARK_WORDS: Record<string, string> = { last: "last move", from: "moved from here", win: "winning line", threat: "under threat" };

function Grid({ grid, view, names, side, titled, picked, onCell }: { grid: BoardGrid; view: BoardView; names: string[]; side: boolean; titled: boolean; picked: number | string | null; onCell: (cell: number) => void }) {
  const me = view.me;
  const el = useRef<HTMLDivElement>(null);
  // One cell is in the tab order; the arrow keys move from it.
  const [focus, setFocus] = useState(0);
  const marks = useMemo(() => {
    const at = new Map<number, string[]>();
    for (const m of grid.marks ?? []) at.set(m.cell, [...(at.get(m.cell) ?? []), m.mark]);
    return at;
  }, [grid.marks]);
  const sources = grid.select?.sources ?? [];
  const targets = new Set(picked === null ? [] : (sources.find((s) => s.from === picked)?.to ?? []));
  const tapCols = grid.tap?.by === "col" ? new Set(grid.tap.cells.map((c) => colOf(grid.cols, c))) : null;
  // A picked-up piece that covers several cells is lit along its whole length.
  const pickedSpan = typeof picked === "number" ? grid.cells[picked]?.span : undefined;
  const isPicked = (cell: number) => picked === cell || (pickedSpan !== undefined && grid.cells[cell]?.span === pickedSpan);
  /** The cells of one long piece are joined: which of this cell's sides run on into the same piece. */
  const joins = (cell: number): string[] => {
    const span = grid.cells[cell]?.span;
    if (span === undefined) return [];
    const r = rowOf(grid.cols, cell);
    const c = colOf(grid.cols, cell);
    const same = (rr: number, cc: number) => rr >= 0 && rr < grid.rows && cc >= 0 && cc < grid.cols && grid.cells[rr * grid.cols + cc]?.span === span;
    return ["spanned", same(r - 1, c) ? "join-n" : "", same(r, c + 1) ? "join-e" : "", same(r + 1, c) ? "join-s" : "", same(r, c - 1) ? "join-w" : ""];
  };
  const canTap = (cell: number) => targets.has(cell) || !!sourceAt(grid, cell) || (tapCols ? tapCols.has(colOf(grid.cols, cell)) : !!grid.tap?.cells.includes(cell));
  const blocks = grid.blocks;
  const blockH = blocks ? grid.rows / blocks.rows : 0;
  const blockW = blocks ? grid.cols / blocks.cols : 0;
  /** A block someone has taken is drawn in the colour they play in. */
  const blockTone = (owner: number) => toneOf(view.players[owner]?.piece ?? { owner, kind: "", glyph: "", label: "" });
  const blockOf = (cell: number) => (blocks ? Math.floor(rowOf(grid.cols, cell) / blockH) * blocks.cols + Math.floor(colOf(grid.cols, cell) / blockW) : -1);

  function onKey(e: React.KeyboardEvent) {
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    const r = rowOf(grid.cols, focus);
    const c = colOf(grid.cols, focus);
    let next: number | null = null;
    if (step) next = Math.min(grid.rows - 1, Math.max(0, r + step[0]!)) * grid.cols + Math.min(grid.cols - 1, Math.max(0, c + step[1]!));
    else if (e.key === "Home") next = r * grid.cols;
    else if (e.key === "End") next = r * grid.cols + grid.cols - 1;
    if (next === null) return;
    e.preventDefault();
    setFocus(next);
    el.current?.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus();
  }

  function shadeOf(cell: number): string {
    if (grid.shade === "checker") return (rowOf(grid.cols, cell) + colOf(grid.cols, cell)) % 2 === 0 ? "light" : "dark";
    return grid.shade?.[cell] ?? "plain";
  }

  function label(cell: number): string {
    const piece = grid.cells[cell];
    const whose = !piece || piece.owner === null ? "" : piece.owner === me ? ", yours" : `, ${names[piece.owner] ?? `Seat ${piece.owner + 1}`}'s`;
    const block = blocks?.states[blockOf(cell)]?.label;
    const notes = [...(marks.get(cell) ?? []).map((m) => MARK_WORDS[m] ?? m), ...(block ? [`board ${block}`] : []), ...(isPicked(cell) ? ["picked up"] : []), ...(targets.has(cell) ? ["can go here"] : [])];
    return `${cellName(grid, cell)}: ${piece ? `${piece.label}${whose}` : "empty"}${notes.length ? `, ${notes.join(", ")}` : ""}`;
  }

  const style = { "--cols": grid.cols, "--rows": grid.rows } as React.CSSProperties;
  return (
    <div className={`board-wrap${side ? " side" : ""}${grid.coords ? " with-coords" : ""}`} style={style}>
      {titled && <h3 className="board-title">{named(grid.label, names)}</h3>}
      {grid.coords && (
        <div className="coords cols" aria-hidden>
          {grid.coords.cols.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
      )}
      {grid.coords && (
        <div className="coords rows" aria-hidden>
          {grid.coords.rows.map((r, i) => (
            <span key={i}>{r}</span>
          ))}
        </div>
      )}
      <div ref={el} className={`board-grid${grid.points ? " points" : ""}${blocks ? " blocked" : ""}${grid.cols > 9 ? " fine-lines" : ""}`} role="group" aria-label={`${named(grid.label, names)}, ${grid.rows} by ${grid.cols}. Arrow keys move around it.`} onKeyDown={onKey}>
        {grid.cells.map((piece, cell) => {
          const r = rowOf(grid.cols, cell);
          const c = colOf(grid.cols, cell);
          const tappable = canTap(cell);
          const state = blocks?.states[blockOf(cell)];
          const cls = [
            "cell",
            `shade-${shadeOf(cell)}`,
            ...(marks.get(cell) ?? []).map((m) => `mark-${m}`),
            tappable ? "can" : "",
            isPicked(cell) ? "picked" : "",
            ...joins(cell),
            targets.has(cell) ? "target" : "",
            // Heavier lines where one block of cells ends and the next begins.
            blocks && (c + 1) % blockW === 0 && c + 1 < grid.cols ? "edge-r" : "",
            blocks && (r + 1) % blockH === 0 && r + 1 < grid.rows ? "edge-b" : "",
            state?.active ? "in-active" : "",
            state?.closed ? "in-closed" : "",
            r === 0 ? "row-first" : "",
            r === grid.rows - 1 ? "row-last" : "",
            c === 0 ? "col-first" : "",
            c === grid.cols - 1 ? "col-last" : "",
          ];
          return (
            <button
              key={cell}
              type="button"
              className={cls.filter(Boolean).join(" ")}
              data-cell={cell}
              tabIndex={cell === focus ? 0 : -1}
              // Not `disabled`: a cell you can't play in can still be walked to and read out.
              aria-disabled={!tappable}
              aria-pressed={isPicked(cell) ? true : undefined}
              aria-label={label(cell)}
              onFocus={() => setFocus(cell)}
              onClick={() => onCell(cell)}
            >
              {piece && <Piece piece={piece} />}
            </button>
          );
        })}
        {blocks && (
          <div className="board-blocks" aria-hidden style={{ "--block-cols": blocks.cols, "--block-rows": blocks.rows } as React.CSSProperties}>
            {blocks.states.map((b, i) => (
              <div key={i} className={`block${b.active ? " active" : ""}${b.closed ? " closed" : ""}${b.owner != null ? ` tone-${blockTone(b.owner)}` : ""}`}>
                {b.glyph}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
