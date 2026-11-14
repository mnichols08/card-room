// The setup screen's frame, shared by every game. On a phone it's one column, in the order you'd fill
// it in: your houses, who's playing, the computer players, how it's played, then the buttons. On a
// laptop it's two: how it's played on the left with room to read and change the rules, and who's
// playing on the right, with the buttons kept in view.
import type { ReactNode } from "react";
import { AllGames } from "./GamePicker";

interface Props {
  emoji: ReactNode;
  title: string;
  tagline: string;
  onHome: () => void;
  /** "Your houses": shown first when you have any. */
  houses?: ReactNode;
  /** Your name, the house rules, how many players. */
  you: ReactNode;
  /** Start a family table, practise, and anything that went wrong. */
  actions: ReactNode;
  /** Computer players, and how this device looks and sounds. */
  table: ReactNode;
  /** The rules in words, and the rules editor. */
  about: ReactNode;
  /** Challenge links, houses, the fine print. */
  more: ReactNode;
  /** A game for one (a solitaire): nobody else to name, and no computer players to set up. */
  solo?: boolean;
}

export function SetupLayout({ emoji, title, tagline, onHome, houses, you, actions, table, about, more, solo = false }: Props) {
  return (
    <main className="setup wide">
      <header className="setup-head">
        <div className="suits" aria-hidden>
          {emoji}
        </div>
        <h1>{title}</h1>
        <p>{tagline}</p>
      </header>
      <AllGames onClick={onHome} />
      <div className="setup-body">
        <div className="setup-col side">
          {houses && <div className="setup-part s-houses">{houses}</div>}
          <section className="setup-card start" aria-label={solo ? "Your game" : "Who's playing"}>
            <h2 className="desk-only">{solo ? "Your game" : "Who's playing"}</h2>
            <div className="setup-part s-you">{you}</div>
            <div className="setup-part s-actions">{actions}</div>
          </section>
          <section className="setup-card" aria-label={solo ? "This device" : "Computer players and this device"}>
            <h2 className="desk-only">{solo ? "This device" : <>Computer players &amp; this device</>}</h2>
            <div className="setup-part s-table">{table}</div>
          </section>
        </div>
        <div className="setup-col main">
          <section className="setup-card" aria-label="How it's played">
            <h2 className="desk-only">How it's played</h2>
            <div className="setup-part s-about">{about}</div>
          </section>
          <section className="setup-card quiet" aria-label="More">
            <div className="setup-part s-more">{more}</div>
          </section>
        </div>
      </div>
    </main>
  );
}
