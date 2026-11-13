import { createRoom } from "@spades/rooms/client";
import type { RulePreset } from "@spades/rules";
import { useEffect, useState } from "react";
import { LocalTable } from "./LocalTable";
import { RoomTable } from "./RoomTable";
import { Setup } from "./Setup";

type Screen =
  | { kind: "setup" }
  | { kind: "local"; name: string; preset: RulePreset; seed: number }
  | { kind: "room"; id: string };

const tableInUrl = () => new URLSearchParams(location.search).get("table");

function go(id: string | null) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("table", id);
  else url.searchParams.delete("table");
  history.pushState(null, "", url);
}

export function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    const id = tableInUrl();
    return id ? { kind: "room", id } : { kind: "setup" };
  });

  useEffect(() => {
    const onPop = () => {
      const id = tableInUrl();
      setScreen(id ? { kind: "room", id } : { kind: "setup" });
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const home = () => {
    go(null);
    setScreen({ kind: "setup" });
  };

  if (screen.kind === "local") return <LocalTable key={screen.seed} {...screen} onLeave={home} />;
  if (screen.kind === "room") return <RoomTable key={screen.id} id={screen.id} onLeave={home} />;
  return (
    <Setup
      onStart={(name, preset) => setScreen({ kind: "local", name, preset, seed: Math.floor(Math.random() * 2 ** 31) })}
      onFamilyTable={async (preset) => {
        const id = await createRoom(preset);
        go(id);
        setScreen({ kind: "room", id });
      }}
    />
  );
}
