import { afterEach, describe, expect, it, vi } from "vitest";
import { openRoom } from "../src/client.js";

// The live stream needs a browser; the clock doesn't, so the stream stays shut here.
vi.mock("@zubra/sync/connect", () => ({ connect: () => ({ stop() {}, pull: async () => {} }) }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the room's clock in the browser", () => {
  it("measures how far the server's clock is from this one, so a countdown is honest", async () => {
    // This browser's clock is a minute and a half slow, and the server takes 200 ms to answer.
    const BROWSER = Date.UTC(2026, 0, 1);
    const AHEAD = 90_000;
    let delay = 200;
    vi.useFakeTimers({ now: BROWSER });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (!String(input).endsWith("/rooms/abc123")) return new Response("{}", { status: 404 });
      await new Promise((r) => setTimeout(r, delay / 2)); // there
      const now = Date.now() + AHEAD;
      await new Promise((r) => setTimeout(r, delay / 2)); // and back
      return new Response(JSON.stringify({ id: "abc123", seat: null, now }), { headers: { "content-type": "application/json" } });
    });
    const room = openRoom("abc123");
    try {
      expect(room.clockOffset()).toBe(0); // until it has asked
      const asked = room.info();
      await vi.advanceTimersByTimeAsync(200);
      await asked;
      expect(room.clockOffset()).toBe(AHEAD);
      expect(room.serverNow()).toBe(Date.now() + AHEAD);

      // A deadline 30 seconds off by the server's clock has 30 seconds left, whatever this clock says.
      const deadline = { at: room.serverNow() + 30_000, seat: 0 };
      expect(room.timeLeft(deadline)).toBe(30_000);
      await vi.advanceTimersByTimeAsync(12_000);
      expect(room.timeLeft(deadline)).toBe(18_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(room.timeLeft(deadline)).toBe(0);
      expect(room.timeLeft(null)).toBeNull();

      // A slower answer is a worse measurement: the quickest round trip is the one kept.
      delay = 3_000;
      const again = room.syncClock();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await again).toBe(AHEAD);
    } finally {
      room.close();
    }
  });
});
