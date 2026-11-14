// Watch a game: the tables playing now, and tables of computer players that anyone can deal to
// watch and learn from.
//
// The page is Solid; everything on it is a zubra-ui component (see zubra.ts). They're custom
// elements: Solid sets their properties with `prop:` and listens to their events with `on:`.
import { For, Match, Show, Switch, createMemo, createResource, createSignal, onCleanup } from "solid-js";

interface Game {
  id: string;
  name: string;
  emoji: string;
  seats: [number, number];
  teams: boolean;
  on: boolean;
}

interface Table {
  id: string;
  game: string;
  gameName: string;
  emoji: string;
  rules: string;
  label: string;
  /** Computer players only: a watcher sees every hand. At any other table, the table but nobody's hand. */
  computers: boolean;
  seats: { name: string | null; bot: boolean }[];
  standing: string;
}

interface Live {
  tables: Table[];
  /** Whether tables with players at them can be watched. */
  watching: boolean;
  computerTables: { going: number; limit: number };
}

/** The server's endpoints sit beside the page: /watch/ → /spectate, /catalogue. */
const beside = (path: string) => new URL(`../${path}`, document.baseURI).href;
const REFRESH_MS = 4000;

const SKILLS = [
  { value: "mixed", label: "Their own way" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];
const PACES = [
  { value: "fast", label: "Fast" },
  { value: "medium", label: "Medium" },
  { value: "slow", label: "Slow" },
  { value: "natural", label: "Like a person" },
];

async function ask<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(beside(path), body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Couldn't reach the card room. Check your connection and try again.");
  }
  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !answer) throw new Error(answer?.error ?? "This card room can't do that.");
  return answer;
}

/** zubra-ui's <toast-region> listens on the document: any code shows a toast with an event. */
const toast = (message: string, variant: "danger" | "info" = "info") => document.dispatchEvent(new CustomEvent("toast", { detail: { message, variant } }));

export function App() {
  // What's on now, asked again every few seconds while the page is in view.
  const [live, { refetch }] = createResource<Live | null>(() => ask<Live>("spectate").catch(() => null));
  const timer = setInterval(() => document.visibilityState === "visible" && void refetch(), REFRESH_MS);
  onCleanup(() => clearInterval(timer));

  const [games] = createResource<Game[]>(() =>
    ask<{ games: Game[] }>("catalogue").then(
      (c) => c.games.filter((g) => g.on),
      () => [],
    ),
  );

  const [game, setGame] = createSignal("");
  const [players, setPlayers] = createSignal("");
  const [skill, setSkill] = createSignal("hard");
  const [pace, setPace] = createSignal("medium");
  const [dealing, setDealing] = createSignal(false);

  const chosen = createMemo(() => games()?.find((g) => g.id === game()) ?? games()?.[0]);
  /** How many can play the chosen game: a choice only when the game has one. */
  const counts = createMemo(() => {
    const g = chosen();
    if (!g || g.teams || g.seats[0] === g.seats[1]) return [];
    return Array.from({ length: g.seats[1] - g.seats[0] + 1 }, (_, i) => String(g.seats[0] + i)).map((n) => ({ value: n, label: n }));
  });
  const seats = createMemo(() => (counts().some((c) => c.value === players()) ? players() : (counts()[Math.min(1, counts().length - 1)]?.value ?? "")));
  const full = createMemo(() => !!live() && live()!.computerTables.going >= live()!.computerTables.limit);

  const tableLink = (id: string) => `../?table=${encodeURIComponent(id)}`;

  async function deal(event: Event) {
    event.preventDefault();
    const g = chosen();
    if (!g || dealing()) return;
    setDealing(true);
    try {
      const { id } = await ask<{ id: string }>("spectate", { game: g.id, seats: seats() ? Number(seats()) : undefined, skill: skill(), pace: pace() });
      location.href = tableLink(id);
    } catch (error) {
      toast((error as Error).message, "danger");
      setDealing(false);
      void refetch();
    }
  }

  const people = (table: Table) => table.seats.filter((s) => s.name);

  return (
    <>
      <toast-region prop:position="bottom-end" prop:label="Notifications" />
      <div class="page">
        <header class="top">
          <a class="home" href="../">
            <span aria-hidden="true">←</span> Card Room
          </a>
          <h1>Watch a game</h1>
          <p class="quiet">Look in on the tables playing now, or deal a table of computer players and see how the game goes.</p>
        </header>

        <Switch>
          <Match when={live.loading && live() === undefined}>
            <div class="waiting">
              <loading-spinner prop:label="Finding the tables" prop:inline={true} />
            </div>
          </Match>
          <Match when={live() === null}>
            <alert-banner prop:variant="info" prop:heading="Nothing to watch here">
              <span>This copy of the card room has no server behind it, so there are no tables to watch. You can still practise against the computer.</span>
              <action-button slot="actions" prop:variant="outline" prop:size="sm" prop:href="../">
                Back to the card room
              </action-button>
            </alert-banner>
          </Match>
          <Match when={live()}>
            {(now) => (
              <>
                <section class="panel" aria-labelledby="deal-heading">
                  <h2 id="deal-heading">Learn from the computer</h2>
                  <p class="quiet">Pick a game and the computer players sit down and play it out. You see every hand, from any seat.</p>
                  <form class="deal" onSubmit={deal}>
                    <select-field
                      prop:label="Game"
                      prop:options={(games() ?? []).map((g) => ({ value: g.id, label: `${g.emoji} ${g.name}` }))}
                      prop:value={chosen()?.id ?? ""}
                      on:valuechange={(event: CustomEvent<string>) => setGame(event.detail)}
                    />
                    <Show when={counts().length}>
                      <div class="group">
                        <span class="label">Players</span>
                        <segmented-control prop:label="Players" prop:options={counts()} prop:value={seats()} on:valuechange={(event: CustomEvent<string>) => setPlayers(event.detail)} />
                      </div>
                    </Show>
                    <div class="group">
                      <span class="label">How well they play</span>
                      <segmented-control prop:label="How well they play" prop:options={SKILLS} prop:value={skill()} on:valuechange={(event: CustomEvent<string>) => setSkill(event.detail)} />
                    </div>
                    <div class="group">
                      <span class="label">How fast</span>
                      <segmented-control prop:label="How fast" prop:options={PACES} prop:value={pace()} on:valuechange={(event: CustomEvent<string>) => setPace(event.detail)} />
                    </div>
                    <Show when={full()}>
                      <alert-banner prop:variant="warning" prop:heading="The computers' tables are all busy">
                        <span>
                          {now().computerTables.limit} games are going. Watch one of those, or deal a new one when a game ends.
                        </span>
                      </alert-banner>
                    </Show>
                    <action-button prop:type="submit" prop:loading={dealing()} prop:disabled={full() || !chosen()}>
                      <span>{chosen() ? `Deal ${chosen()!.name} and watch` : "Deal and watch"}</span>
                    </action-button>
                  </form>
                </section>

                <section aria-labelledby="now-heading">
                  <h2 id="now-heading">Playing now</h2>
                  <Show when={!now().watching}>
                    <p class="quiet note">This card room's host has kept tables with players private. The computers' tables are always open.</p>
                  </Show>
                  <Show
                    when={now().tables.length}
                    fallback={
                      <empty-state prop:heading="No games going right now">
                        <span>When someone's playing, their table shows up here. Until then, deal the computers a game.</span>
                      </empty-state>
                    }
                  >
                    <auto-grid prop:min="17rem" prop:gap="1rem">
                      <For each={now().tables}>
                        {(table) => (
                          <content-card prop:heading={`${table.emoji} ${table.gameName}`}>
                            <cluster-layout prop:gap="0.4rem">
                              <Show when={table.computers} fallback={<status-badge prop:variant="primary" prop:dot={true}>Players at the table</status-badge>}>
                                <status-badge prop:variant="success" prop:dot={true}>
                                  Computers playing
                                </status-badge>
                              </Show>
                              <Show when={table.rules}>
                                <status-badge prop:variant="outline">
                                  <span>{table.rules}</span>
                                </status-badge>
                              </Show>
                            </cluster-layout>
                            <ul class="seats">
                              <For each={people(table)}>
                                {(seat) => (
                                  <li>
                                    <user-avatar prop:name={seat.name ?? ""} prop:size="sm" />
                                    <span>{seat.name}</span>
                                  </li>
                                )}
                              </For>
                            </ul>
                            <p class="standing">{table.standing || "Just dealt"}</p>
                            <cluster-layout slot="footer" prop:gap="0.75rem">
                              <action-button
                                prop:size="sm"
                                prop:href={tableLink(table.id)}
                                prop:label={table.computers ? `Watch the computers play ${table.gameName}` : `Watch ${people(table).map((s) => s.name).join(", ")} play ${table.gameName}`}
                              >
                                Watch
                              </action-button>
                              <span class="quiet">{table.computers ? "You see every hand." : "You see the table, not their hands."}</span>
                            </cluster-layout>
                          </content-card>
                        )}
                      </For>
                    </auto-grid>
                  </Show>
                </section>
              </>
            )}
          </Match>
        </Switch>
      </div>
    </>
  );
}
