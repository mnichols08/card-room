import { teamOf, type SeatView } from "@spades/rules";
import { useEffect, useRef } from "react";
import type { TableState } from "../useTable";
import { play, type SoundName } from "./sounds";

/**
 * Sounds for what happens at the table, read from how the view changed. A view from the server
 * can jump several steps at once (bots are quick), so this compares states rather than counting
 * on seeing every step.
 */
export function useTableSounds(t: TableState) {
  const view = t.view;
  const prev = useRef<SeatView | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!view || !before) {
      if (view && view.phase === "bidding") play("deal");
      return;
    }
    const sounds: SoundName[] = [];
    const myTeam = teamOf(t.seat);

    // A new hand: the deck was dealt.
    if (view.handNumber > before.handNumber) sounds.push("deal");

    // Cards played: the trick grew, or a trick was completed (it empties into lastTrick).
    const trickDone = !!view.lastTrick && JSON.stringify(view.lastTrick) !== JSON.stringify(before.lastTrick);
    if (view.trick.length > before.trick.length || trickDone) sounds.push("card");

    // Spades broken for the first time this hand.
    if (view.spadesBroken && !before.spadesBroken && view.handNumber === before.handNumber) sounds.push("spadesBroken");

    // A bid went down.
    const bidsBefore = before.bids.filter(Boolean).length;
    if (view.handNumber === before.handNumber && view.bids.filter(Boolean).length > bidsBefore) sounds.push("bid");

    // It became your turn.
    const myTurn = (v: SeatView) => (v.phase === "bidding" || v.phase === "playing") && v.turn === t.seat;
    if (myTurn(view) && !(myTurn(before) && before.phase === view.phase && before.handNumber === view.handNumber)) sounds.push("yourTurn");

    // A hand was scored: say how it went for us.
    if (view.history.length > before.history.length) {
      const result = view.history[view.history.length - 1]!.results[myTeam];
      sounds.push(result.nilPoints > 0 ? "nilMade" : result.made === false || result.nilPoints < 0 ? "set" : "handDone");
    }

    if (view.phase === "finished" && before.phase !== "finished") sounds.push(view.winner === myTeam ? "won" : "lost");

    // Space them out a little so a burst of bot moves reads as moves, not a crash.
    sounds.forEach((name, i) => setTimeout(() => play(name), i * 110));
  }, [view, t.seat]);

  // Who took the trick: played when the table shows it, after the last card lands.
  const winner = t.trickWinner;
  useEffect(() => {
    if (winner === null) return;
    const timer = setTimeout(() => play(teamOf(winner) === teamOf(t.seat) ? "trickUs" : "trickThem"), 220);
    return () => clearTimeout(timer);
  }, [winner, t.seat]);

  // A refused move.
  useEffect(() => {
    if (t.error) play("nope");
  }, [t.error]);
}
