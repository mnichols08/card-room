// The card room's admin page, for whoever runs the server: sign in with the server's key
// (CARDROOM_ADMIN_KEY), see who's blocked, let people back in. Blocking itself happens at a table.
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useEffect, useState } from "react";
import { admin, type BlockedPlayer } from "./adminApi";

export function AdminPage({ onLeave }: { onLeave: () => void }) {
  const [me, setMe] = useState<{ enabled: boolean; admin: boolean } | null>(null);
  const [key, setKey] = useState("");
  const [blocked, setBlocked] = useState<BlockedPlayer[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const attempt = (work: () => Promise<unknown>) => {
    setProblem(null);
    work().catch((e: Error) => setProblem(e.message));
  };
  useEffect(() => attempt(async () => setMe(await admin.me())), []);
  useEffect(() => {
    if (me?.admin) attempt(async () => setBlocked(await admin.blocked()));
  }, [me?.admin]);

  return (
    <main className="setup lobby">
      <header className="setup-head">
        <div className="suits" aria-hidden>
          ♠ ♥ ♣ ♦
        </div>
        <h1>Card room admin</h1>
        <p>{me?.admin ? "This device is an admin. Open any table to remove, mute or block a player there." : "For whoever runs this card room."}</p>
      </header>

      {me && !me.enabled && <p className="rules-summary">This card room has no admin yet. Set CARDROOM_ADMIN_KEY on the server (8 characters or more), then come back here and enter it.</p>}
      {me?.enabled && !me.admin && (
        <form
          className="house-block"
          onSubmit={(e) => {
            e.preventDefault();
            attempt(async () => {
              setMe(await admin.signIn(key));
              setKey("");
            });
          }}
        >
          <TextField label="Admin key" type="password" required value={key} autocomplete="current-password" onValueChange={(e: CustomEvent<string>) => setKey(e.detail)} />
          <button type="submit" className="primary" disabled={!key.trim()}>
            Sign in
          </button>
        </form>
      )}
      {me?.admin && (
        <section className="house-block" aria-label="Blocked players">
          <h2>Blocked players</h2>
          {blocked.length === 0 ? (
            <p className="rules-summary">Nobody's blocked. To block someone, open the table they're at and choose Block next to their name.</p>
          ) : (
            <ul className="house-list">
              {blocked.map((b) => (
                <li key={b.id}>
                  <div>
                    <strong>{b.name}</strong>
                    <small>Blocked {new Date(b.at).toLocaleDateString()}</small>
                  </div>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() =>
                      attempt(async () => {
                        await admin.unblock(b.id);
                        setBlocked(await admin.blocked());
                      })
                    }
                  >
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="fine">A block follows the player's browser, so it stops a casual pest; someone who clears their cookies can come back as a new player.</p>
          <button type="button" className="link" onClick={() => attempt(async () => setMe(await admin.signOut()))}>
            Sign out on this device
          </button>
        </section>
      )}
      {problem && <p className="error">{problem}</p>}
      <button type="button" className="link" onClick={onLeave}>
        ← All games
      </button>
    </main>
  );
}
