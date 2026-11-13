// How each persona plays: a pair of them (seats 0 and 2) against the quick bots.
//   npx tsx scripts/roster.ts [games]
import { botAction } from "../src/bot.js";
import { applyAction, newGame } from "../src/game.js";
import { classic } from "../src/presets.js";
import { smartAction } from "../src/smart.js";
import { PERSONAS } from "../src/talk.js";
import type { Seat } from "../src/types.js";

const games = Number(process.argv[2] ?? 10);
const only = process.argv[3]?.split(",");
for (const p of Object.values(PERSONAS).filter((x) => !only || only.includes(x.name))) {
  let wins = 0;
  let nils = 0;
  let bids = 0;
  let bidTotal = 0;
  for (let g = 0; g < games; g++) {
    let s = newGame(classic, 7000 + g, (g % 4) as Seat);
    for (let step = 0; step < 5000 && s.phase !== "finished"; step++) {
      const seat = ([0, 1, 2, 3] as Seat[]).find((x) => botAction(s, x))!;
      const mine = seat % 2 === 0;
      const action = mine ? smartAction(s, seat, { style: p.style }) : botAction(s, seat);
      if (mine && action!.type === "bid") {
        bids++;
        if (action!.bid.kind !== "tricks") nils++;
        else bidTotal += action!.bid.count;
      }
      s = applyAction(s, action!);
    }
    if (s.winner === 0) wins++;
  }
  console.log(`${p.name.padEnd(7)} won ${String(wins).padStart(2)}/${games}  nil ${Math.round((100 * nils) / bids)}%  avg bid ${(bidTotal / (bids - nils)).toFixed(1)}  (${p.blurb})`);
}
