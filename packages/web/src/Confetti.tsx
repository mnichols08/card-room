import { useEffect, useMemo, useState } from "react";

const SUITS = ["♠︎", "♥︎", "♦︎", "♣︎"];

/** A shower of suits for the winner, once, then gone. Hidden for reduced motion (in the CSS). */
export function Confetti({ count = 24 }: { count?: number }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), 2200);
    return () => clearTimeout(t);
  }, []);
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const suit = SUITS[i % 4]!;
        const tone = i % 6 === 5 ? "gold" : suit.startsWith("♥") || suit.startsWith("♦") ? "red" : "black";
        return {
          suit,
          tone,
          style: {
            "--x": `${Math.random() * 100}vw`,
            "--d": `${Math.round(Math.random() * 400)}ms`,
            "--r": `${Math.round(Math.random() * 1080 - 540)}deg`,
            "--s": (0.8 + Math.random() * 0.6).toFixed(2),
          } as React.CSSProperties,
        };
      }),
    [count],
  );
  if (!on) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span key={i} className={b.tone} style={b.style}>
          {b.suit}
        </span>
      ))}
    </div>
  );
}
