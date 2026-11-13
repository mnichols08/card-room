import type { RulePreset } from "@spades/rules";
import { useState } from "react";
import { Setup } from "./Setup";
import { Table } from "./Table";

type Screen = { kind: "setup" } | { kind: "table"; name: string; preset: RulePreset; seed: number };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "setup" });

  if (screen.kind === "setup") {
    return (
      <Setup
        onStart={(name, preset) =>
          setScreen({ kind: "table", name, preset, seed: Math.floor(Math.random() * 2 ** 31) })
        }
      />
    );
  }
  return <Table key={screen.seed} {...screen} onLeave={() => setScreen({ kind: "setup" })} />;
}
