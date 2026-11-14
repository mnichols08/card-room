// What every framework's page shows. The pages differ only in how they hand these to the
// components and hear back from them; the tests (tests/conformance.spec.ts) are the same for all.
export const VARIANTS = ["neutral", "success", "danger"] as const;

export const SEGMENTS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

export const TABS = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
];

export const COLUMNS = [
  { key: "name", label: "Name", sortable: true },
  { key: "wins", label: "Wins", format: "number" },
];

export interface Row {
  id: string;
  name: string;
  wins: number;
}
export const ROWS: Row[] = [
  { id: "r1", name: "Dot", wins: 3 },
  { id: "r2", name: "Hank", wins: 5 },
  { id: "r3", name: "Lou", wins: 1 },
];
export const EXTRA_ROW: Row = { id: "r4", name: "Bea", wins: 8 };

export const CARDS = [
  { kind: "pip", suit: "spades", rank: 14 },
  { kind: "pip", suit: "hearts", rank: 12 },
] as const;

export const ITEMS = ["one", "two"];
