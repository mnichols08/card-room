import { createRoom } from "@spades/rooms/client";
import type { PalaceRules } from "@cardroom/palace";
import type { RulePreset } from "@spades/rules";
import { useEffect, useState } from "react";
import { ChallengePage } from "./ChallengePage";
import { EmbedHome } from "./EmbedHome";
import { HousePage } from "./HousePage";
import { houses } from "./housesApi";
import { LocalTable } from "./LocalTable";
import { RoomTable } from "./RoomTable";
import { LocalPalace } from "./palace/LocalPalace";
import { PalaceSetup } from "./palace/PalaceSetup";
import { Setup } from "./Setup";
import { loadGame, rememberHouse, saveGame, type GameId } from "./storage";

type Screen =
  | { kind: "setup" }
  | { kind: "local"; name: string; preset: RulePreset; seed: number }
  | { kind: "local-palace"; name: string; rules: PalaceRules; seats: number; seed: number }
  | { kind: "room"; id: string; house: string | null }
  | { kind: "house"; slug: string; code: string | null }
  | { kind: "challenge"; code: string };

/** The screen is in the URL, so links work and the back button does what people expect. */
function fromUrl(): Screen {
  const q = new URLSearchParams(location.search);
  const table = q.get("table");
  const house = q.get("house");
  if (table) return { kind: "room", id: table, house };
  if (house) return { kind: "house", slug: house, code: q.get("code") };
  const challenge = q.get("challenge");
  if (challenge) return { kind: "challenge", code: challenge };
  return { kind: "setup" };
}

function go(params: Record<string, string | null>) {
  const url = new URL(location.href);
  url.search = "";
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  history.pushState(null, "", url);
}

export function App() {
  const [screen, setScreen] = useState<Screen>(fromUrl);
  const embedded = new URLSearchParams(location.search).get("embed") === "1";
  const [game, setGame] = useState<GameId>(() => {
    const asked = new URLSearchParams(location.search).get("game");
    return asked === "palace" || asked === "spades" ? asked : loadGame();
  });
  const pickGame = (g: GameId) => {
    saveGame(g);
    setGame(g);
    scrollTo(0, 0);
  };

  useEffect(() => {
    const onPop = () => setScreen(fromUrl());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const home = () => {
    go(embedded ? { embed: "1", game } : {});
    setScreen({ kind: "setup" });
  };
  const openHouse = (slug: string) => {
    go({ house: slug });
    setScreen({ kind: "house", slug, code: null });
  };
  const openTable = (id: string, house: string | null) => {
    go({ table: id, house });
    setScreen({ kind: "room", id, house });
  };

  // Inside the <card-room> embed on someone's page: practice only.
  if (embedded && screen.kind === "setup") {
    return (
      <EmbedHome
        game={game}
        onPractice={(name, rules, seats) => {
          const seed = Math.floor(Math.random() * 2 ** 31);
          setScreen(game === "palace" ? { kind: "local-palace", name, rules: rules as PalaceRules, seats, seed } : { kind: "local", name, preset: rules as RulePreset, seed });
        }}
      />
    );
  }
  if (screen.kind === "local") return <LocalTable key={screen.seed} {...screen} onLeave={home} />;
  if (screen.kind === "local-palace") return <LocalPalace key={screen.seed} {...screen} onLeave={home} />;
  if (screen.kind === "room") {
    return <RoomTable key={screen.id} id={screen.id} onLeave={screen.house ? () => openHouse(screen.house!) : home} />;
  }
  if (screen.kind === "challenge") return <ChallengePage code={screen.code} onSent={(id) => openTable(id, null)} onLeave={home} />;
  if (screen.kind === "house") {
    return <HousePage key={screen.slug} slug={screen.slug} code={screen.code} onOpenTable={(id) => openTable(id, screen.slug)} onLeave={home} />;
  }
  if (game === "palace") {
    return (
      <PalaceSetup
        onPickGame={pickGame}
        onPractice={(name, rules, seats) => setScreen({ kind: "local-palace", name, rules, seats, seed: Math.floor(Math.random() * 2 ** 31) })}
        onFamilyTable={async (rules, seats) => openTable(await createRoom({ game: "palace", rules, seats }), null)}
        onOpenHouse={openHouse}
      />
    );
  }
  return (
    <Setup
      onPickGame={pickGame}
      onStart={(name, preset) => setScreen({ kind: "local", name, preset, seed: Math.floor(Math.random() * 2 ** 31) })}
      onFamilyTable={async (preset) => openTable(await createRoom(preset), null)}
      onOpenHouse={openHouse}
      onMakeHouse={async (houseName, you, preset) => {
        const house = await houses.create(houseName, you, preset);
        rememberHouse(house);
        openHouse(house.slug);
      }}
    />
  );
}
