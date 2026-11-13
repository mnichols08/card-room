import type { RulePreset } from "@spades/rules";
import { useEffect, useState } from "react";
import { Table } from "./Table";
import { useLocalGame } from "./useLocalGame";
import { useTable } from "./useTable";

/** A game in this browser against three bots. */
export function LocalTable({ name, preset, seed, onLeave }: { name: string; preset: RulePreset; seed: number; onLeave: () => void }) {
  const [paused, setPaused] = useState(false);
  const table = useTable(useLocalGame(preset, seed, paused));
  useEffect(() => setPaused(table.paused), [table.paused]);
  return <Table table={table} names={{ 0: name, 1: "Hank", 2: "Dot", 3: "Lou" }} onLeave={onLeave} />;
}
