// Smart bots (seats 0 and 2) against the simple bots (1 and 3), over many games.
//   npx tsx scripts/match.ts [games] [deals]
import { botAction } from "../src/bot.js";
import { applyAction, newGame } from "../src/game.js";
import { classic } from "../src/presets.js";
import { smartAction } from "../src/smart.js";
import type { Seat } from "../src/types.js";

const games = Number(process.argv[2] ?? 30);
const deals = Number(process.argv[3] ?? 40);
let smartWins = 0;
let thinkMs = 0;
let decisions = 0;
let slowest = 0;
for (let g = 0; g < games; g++) {
  let s = newGame(classic, Number(process.env.SEED ?? 1000) + g, (g % 4) as Seat);
  for (let step = 0; step < 5000 && s.phase !== "finished"; step++) {
    const seat = ([0, 1, 2, 3] as Seat[]).find((x) => botAction(s, x))!;
    const smart = seat % 2 === 0;
    const t0 = performance.now();
    const action = smart ? smartAction(s, seat, { deals }) : botAction(s, seat);
    const dt = performance.now() - t0;
    if (smart && s.phase === "playing") {
      thinkMs += dt;
      decisions++;
      slowest = Math.max(slowest, dt);
    }
    s = applyAction(s, action!);
  }
  if (s.winner === 0) smartWins++;
}
console.log(`smart won ${smartWins}/${games} (${Math.round((100 * smartWins) / games)}%); card decisions: avg ${(thinkMs / decisions).toFixed(1)} ms, slowest ${slowest.toFixed(0)} ms`);
