import { describe, expect, it } from "vitest";
import { bluff, durak, kitGame, liarsPoker, president, slapjack, thirtyOne } from "../src/index.js";

const games = [president, bluff, liarsPoker, durak, thirtyOne, slapjack];

describe("Drinking mode", () => {
  it("is a house-rule switch, off by default, on the party games", () => {
    for (const g of games) {
      expect(g.fields.some((f) => f.key === "drinking")).toBe(true);
      const r = g.normalize(undefined);
      expect(r.drinking).toBe(false);
      expect(g.describe(r).join(" ")).not.toContain("🍺");
      expect(g.describe(g.normalize({ ...r, drinking: true })).join(" ")).toContain("🍺 Drinking mode");
    }
  });

  it("kids' games don't have it", () => {
    for (const id of ["memory", "gofish", "oldmaid", "war"] as const) expect(kitGame(id).fields.some((f) => f.key === "drinking")).toBe(false);
  });

  it("hands out drinks when it's on", () => {
    for (const g of games) {
      const rules = g.normalize({ ...g.normalize(undefined), drinking: true });
      let s = g.newGame(rules, g.seats.default, 7) as unknown;
      let drank = false;
      for (let n = 0; n < 4000 && !g.summary(s as never).over && !drank; n++) {
        const seat = [...Array(g.seats.default).keys()].find((i) => g.bot(s as never, i, { skill: 1 }) !== null);
        if (seat === undefined) break;
        s = g.apply(s as never, seat, g.bot(s as never, seat, { skill: 1 }) as never);
        drank = ((s as { narration: string | null }).narration ?? "").includes("🍺");
      }
      expect(drank, g.id).toBe(true);
    }
  });
});
