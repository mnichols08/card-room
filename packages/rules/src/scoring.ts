import type { Bid, RulePreset, Seat, Team, TeamScore } from "./types.js";

export const teamOf = (seat: Seat): Team => (seat % 2) as Team;
export const partnerOf = (seat: Seat): Seat => ((seat + 2) % 4) as Seat;
export const seatsOf = (team: Team): [Seat, Seat] => (team === 0 ? [0, 2] : [1, 3]);

const isNil = (b: Bid) => b.kind === "nil" || b.kind === "blind-nil";

export interface TeamHandResult {
  team: Team;
  bid: number;
  tricks: number;
  made: boolean | null; // null when the team bid only nils
  contractPoints: number;
  nilPoints: number;
  bagsTaken: number;
  bagPenalty: number;
  delta: number;
  after: TeamScore;
}

/** Score one team's hand and roll bags into its running total. */
export function scoreTeamHand(
  team: Team,
  bids: readonly Bid[],
  tricksWon: readonly number[],
  before: TeamScore,
  preset: RulePreset,
): TeamHandResult {
  const seats = seatsOf(team);
  let contract = 0;
  let contractTricks = 0;
  let nilPoints = 0;
  let bagsFromNil = 0;

  for (const seat of seats) {
    const bid = bids[seat]!;
    const won = tricksWon[seat]!;
    if (isNil(bid)) {
      const value = bid.kind === "blind-nil" ? preset.blindNil.value : preset.nil.value;
      nilPoints += won === 0 ? value : -value;
      if (preset.nilTricksCountTowardBid) contractTricks += won;
      else bagsFromNil += won;
    } else {
      contract += bid.count;
      contractTricks += won;
    }
  }

  const hasContract = seats.some((s) => !isNil(bids[s]!));
  let made: boolean | null = null;
  let contractPoints = 0;
  let bagsTaken = bagsFromNil;

  if (hasContract) {
    made = contractTricks >= contract;
    if (made) {
      contractPoints = contract * 10;
      bagsTaken += contractTricks - contract;
    } else {
      contractPoints = -contract * 10;
    }
  } else if (preset.nilTricksCountTowardBid) {
    // Nil-only team: tricks counted "toward" a zero bid are still bags.
    bagsTaken += contractTricks;
  }

  // Each bag is worth 1 point when taken.
  let points = before.points + contractPoints + nilPoints + bagsTaken;
  let bags = before.bags + bagsTaken;
  let bagPenalty = 0;
  if (preset.bags) {
    while (bags >= preset.bags.limit) {
      bags -= preset.bags.limit;
      points -= preset.bags.penalty;
      bagPenalty += preset.bags.penalty;
    }
  }

  return {
    team,
    bid: contract,
    tricks: tricksWon[seats[0]]! + tricksWon[seats[1]]!,
    made,
    contractPoints,
    nilPoints,
    bagsTaken,
    bagPenalty,
    delta: points - before.points,
    after: { points, bags },
  };
}

/** Winner after a hand, or null to keep playing. Ties at the top keep playing. */
export function gameWinner(scores: readonly [TeamScore, TeamScore], preset: RulePreset): Team | null {
  const [a, b] = [scores[0].points, scores[1].points];
  const aOut = preset.loseAt !== null && a <= preset.loseAt;
  const bOut = preset.loseAt !== null && b <= preset.loseAt;
  const aIn = a >= preset.playTo;
  const bIn = b >= preset.playTo;
  if (aOut || bOut || aIn || bIn) {
    if (a === b) return null;
    return a > b ? 0 : 1;
  }
  return null;
}
