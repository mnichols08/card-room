export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

/** 2–14 (11 = J, 12 = Q, 13 = K, 14 = A). */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type Card =
  | { kind: "pip"; suit: Suit; rank: Rank }
  | { kind: "joker"; size: "big" | "little" };

/** Seats 0–3. Partners sit across: 0 & 2 are team 0, 1 & 3 are team 1. */
export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;

export type Bid =
  | { kind: "tricks"; count: number }
  | { kind: "nil" }
  | { kind: "blind-nil" };

export interface RulePreset {
  id: string;
  name: string;
  /** "ace-high": standard deck, spades trump.
   *  "jokers-and-deuces": 2♣/2♥ removed, Big Joker > Little Joker > 2♦ > 2♠ > A♠ … all trump. */
  trump: "ace-high" | "jokers-and-deuces";
  /** Whether spades (trump) may be led before one has been played, unless a hand holds only trump. */
  spadesMustBeBroken: boolean;
  nil: { enabled: boolean; value: number };
  /** Whether tricks taken by a nil bidder help the partner make their bid. Otherwise they only count as bags. */
  nilTricksCountTowardBid: boolean;
  blindNil: {
    enabled: boolean;
    value: number;
    /** Only allowed when the bidder's team trails by at least this many points. null = always. */
    onlyWhenDownBy: number | null;
    /** Cards the blind nil bidder and partner swap after bidding. 0 = no pass. */
    passCards: number;
  };
  /** null disables the bag penalty. */
  bags: { limit: number; penalty: number } | null;
  playTo: number;
  /** A team at or below this score loses. null = no floor. */
  loseAt: number | null;
  /** Combined non-nil bid a team must reach. null = no minimum. */
  minTeamBid: number | null;
}

export interface TeamScore {
  points: number;
  bags: number;
}
