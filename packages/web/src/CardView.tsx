import type { Card } from "@spades/rules";

const SYMBOL = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" } as const;
const LABEL: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };

interface Props {
  card: Card;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  size?: "hand" | "table";
}

export function CardView({ card, disabled, selected, onClick, size = "hand" }: Props) {
  const red = card.kind === "joker" ? card.size === "big" : card.suit === "hearts" || card.suit === "diamonds";
  const classes = ["card", size, red ? "red" : "black", disabled && "disabled", selected && "selected", onClick && "playable"]
    .filter(Boolean)
    .join(" ");

  if (card.kind === "joker") {
    const name = card.size === "big" ? "Big Joker" : "Little Joker";
    return (
      <button type="button" className={classes} onClick={onClick} disabled={!onClick || disabled} aria-label={name}>
        <span className="corner">★</span>
        <span className="pip joker">{card.size === "big" ? "BIG" : "LIL"}<br />JOKER</span>
      </button>
    );
  }

  const rank = LABEL[card.rank] ?? String(card.rank);
  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={!onClick || disabled}
      aria-label={`${rank} of ${card.suit}`}
    >
      <span className="corner">
        {rank}
        <br />
        {SYMBOL[card.suit]}
      </span>
      <span className="pip">{SYMBOL[card.suit]}</span>
    </button>
  );
}

export function CardBack({ size = "hand" }: { size?: "hand" | "table" }) {
  return <div className={`card back ${size}`} aria-hidden />;
}
