// A house's leaderboard, worked out from its finished games. Pure: games in, standings out.
import type { HandRecord, Team } from "@spades/rules";

/** Who sat where in one finished game. A seat is a house member, a guest, or a bot. */
export interface FinishedGame {
  id: string;
  seats: ({ kind: "member"; id: string; name: string } | { kind: "guest"; name: string } | { kind: "bot"; name: string })[];
  winner: Team;
  history: HandRecord[];
}

export interface PlayerLine {
  id: string;
  name: string;
  played: number;
  won: number;
  /** Whole percent, or null before a first game. */
  winPct: number | null;
  nil: { bid: number; made: number };
  blindNil: { bid: number; made: number };
}

export interface PartnersLine {
  ids: [string, string];
  names: [string, string];
  played: number;
  won: number;
}

export interface Leaderboard {
  games: number;
  players: PlayerLine[];
  partners: PartnersLine[];
  highlights: {
    biggestComeback: { names: string[]; behindBy: number; final: [number, number]; game: string } | null;
    mostNils: { name: string; made: number } | null;
  };
}

const teamOfSeat = (seat: number): Team => (seat % 2) as Team;

export function leaderboard(games: FinishedGame[], members: { id: string; name: string }[]): Leaderboard {
  const lines = new Map<string, PlayerLine>();
  const line = (id: string, name: string) => {
    let l = lines.get(id);
    if (!l) lines.set(id, (l = { id, name, played: 0, won: 0, winPct: null, nil: { bid: 0, made: 0 }, blindNil: { bid: 0, made: 0 } }));
    return l;
  };
  // Current names win over names typed at a table.
  for (const m of members) line(m.id, m.name);

  const pairs = new Map<string, PartnersLine>();
  let comeback: Leaderboard["highlights"]["biggestComeback"] = null;

  for (const game of games) {
    for (const [seat, who] of game.seats.entries()) {
      if (who.kind !== "member") continue;
      const l = line(who.id, lines.get(who.id)?.name ?? who.name);
      l.played += 1;
      if (teamOfSeat(seat) === game.winner) l.won += 1;
      for (const hand of game.history) {
        const bid = hand.bids[seat];
        const tookNone = hand.tricksWon[seat] === 0;
        if (bid?.kind === "nil") {
          l.nil.bid += 1;
          if (tookNone) l.nil.made += 1;
        } else if (bid?.kind === "blind-nil") {
          l.blindNil.bid += 1;
          if (tookNone) l.blindNil.made += 1;
        }
      }
    }

    // Partners: both seats of a team held by members.
    for (const team of [0, 1] as Team[]) {
      const [a, b] = [game.seats[team], game.seats[team + 2]];
      if (a?.kind !== "member" || b?.kind !== "member") continue;
      const [first, second] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1)) as [typeof a, typeof a];
      const key = `${first.id}+${second.id}`;
      let p = pairs.get(key);
      if (!p) pairs.set(key, (p = { ids: [first.id, second.id], names: [first.name, second.name], played: 0, won: 0 }));
      p.played += 1;
      if (team === game.winner) p.won += 1;
    }

    // The deepest hole the winners climbed out of, measured after each hand.
    let worst = 0;
    for (const hand of game.history) {
      const us = hand.results[game.winner].after.points;
      const them = hand.results[(1 - game.winner) as Team].after.points;
      worst = Math.min(worst, us - them);
    }
    const last = game.history[game.history.length - 1];
    if (worst < 0 && last && (!comeback || -worst > comeback.behindBy)) {
      const names = [game.seats[game.winner], game.seats[game.winner + 2]].map((s) => s?.name ?? "?");
      const final: [number, number] = [last.results[game.winner].after.points, last.results[(1 - game.winner) as Team].after.points];
      comeback = { names, behindBy: -worst, final, game: game.id };
    }
  }

  for (const l of lines.values()) l.winPct = l.played ? Math.round((100 * l.won) / l.played) : null;
  for (const p of pairs.values()) p.names = p.ids.map((id) => lines.get(id)?.name ?? "?") as [string, string];

  const players = [...lines.values()].sort(
    (a, b) => b.won - a.won || (b.winPct ?? -1) - (a.winPct ?? -1) || b.played - a.played || a.name.localeCompare(b.name),
  );
  const partners = [...pairs.values()].sort((a, b) => b.won - a.won || b.won / b.played - a.won / a.played || b.played - a.played);
  const nilLeader = [...lines.values()].map((l) => ({ name: l.name, made: l.nil.made + l.blindNil.made })).sort((a, b) => b.made - a.made)[0];

  return {
    games: games.length,
    players,
    partners,
    highlights: { biggestComeback: comeback, mostNils: nilLeader && nilLeader.made > 0 ? nilLeader : null },
  };
}

/** One finished Palace game: who sat where, and the seats in the order they went out (the loser last). */
export interface FinishedPalace {
  id: string;
  seats: FinishedGame["seats"];
  order: number[];
}

export interface PalaceLine {
  id: string;
  name: string;
  played: number;
  /** First out. */
  won: number;
  /** Left holding the cards. */
  last: number;
  winPct: number | null;
  /** Average finishing place, 1 is best, to one decimal; null before a first game. */
  avgPlace: number | null;
}

export interface PalaceBoard {
  game: "palace";
  games: number;
  players: PalaceLine[];
}

/** Palace standings for a house's members: most wins first, then fewest last places. */
export function palaceLeaderboard(games: FinishedPalace[], members: { id: string; name: string }[]): PalaceBoard {
  return { ...placesLeaderboard(games, members), game: "palace" };
}

/**
 * Standings for any game that finishes in an order (Palace, Hearts, Gin…): wins, last places and
 * average place. `winners` names every winning seat (both partners in a team game); without it the
 * first seat out wins. In team games nobody is "last".
 */
export function placesLeaderboard(games: (FinishedPalace & { winners?: number[]; teams?: boolean })[], members: { id: string; name: string }[]) {
  const lines = new Map(members.map((m) => [m.id, { id: m.id, name: m.name, played: 0, won: 0, last: 0, places: 0 }]));
  for (const g of games) {
    g.order.forEach((seat, i) => {
      const who = g.seats[seat];
      if (who?.kind !== "member") return;
      const line = lines.get(who.id);
      if (!line) return;
      line.played += 1;
      line.places += g.teams ? (g.winners?.includes(seat) ? 1 : 2) : i + 1;
      if (g.winners ? g.winners.includes(seat) : i === 0) line.won += 1;
      if (!g.teams && i === g.order.length - 1 && !g.winners?.includes(seat)) line.last += 1;
    });
  }
  const players = [...lines.values()]
    .map(({ places, ...l }) => ({ ...l, winPct: l.played ? Math.round((100 * l.won) / l.played) : null, avgPlace: l.played ? Math.round((10 * places) / l.played) / 10 : null }))
    .sort((a, b) => b.won - a.won || a.last - b.last || b.played - a.played || a.name.localeCompare(b.name));
  return { games: games.length, players };
}
