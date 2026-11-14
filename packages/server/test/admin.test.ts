import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";

const BASE = "http://test";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((a) => a.close());
  open = [];
});

function setup(key: string | undefined = "let-me-in-please") {
  const app = createCardRoom({ log: memoryLog({ keep: "latest" }), botDelay: 5, talk: false, admin: { key } });
  open.push(app);
  const phone = () => {
    const cookies = new Map<string, string>();
    return async (path: string, body?: unknown) => {
      const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      const r = (await app.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined })))!;
      const set = r.headers.get("set-cookie")?.split(";")[0];
      if (set) cookies.set(set.split("=")[0]!, set.split("=")[1]!);
      return { status: r.status, body: await r.json() };
    };
  };
  return { app, phone };
}

describe("the card room's admin", () => {
  it("signs in with the server's key, and only then", async () => {
    const { phone } = setup();
    const me = phone();
    expect((await me("/admin/me")).body).toEqual({ enabled: true, admin: false });
    expect((await me("/admin/blocked")).status).toBe(403);
    expect((await me("/admin/signin", { key: "guess" })).status).toBe(403);
    expect((await me("/admin/signin", { key: "let-me-in-please" })).body).toEqual({ enabled: true, admin: true });
    expect((await me("/admin/me")).body.admin).toBe(true);
    expect((await me("/admin/blocked")).body).toEqual({ blocked: [] });
    await me("/admin/signout", {});
    expect((await me("/admin/me")).body.admin).toBe(false);

    // Guessing is slowed down for everyone.
    const guesser = phone();
    for (let n = 0; n < 4; n++) await guesser("/admin/signin", { key: `guess ${n}` });
    expect((await guesser("/admin/signin", { key: "let-me-in-please" })).status).toBe(429);
  });

  it("is nobody when the server has no key", async () => {
    const { phone } = setup("");
    expect((await phone()("/admin/me")).body).toEqual({ enabled: false, admin: false });
    expect((await phone()("/admin/signin", { key: "" })).status).toBe(503);
  });

  it("blocks a player from the whole card room, and can let them back", async () => {
    const { phone } = setup();
    const admin = phone();
    const pest = phone();
    const friend = phone();
    await admin("/admin/signin", { key: "let-me-in-please" });

    // A family table, mid-game: the admin isn't even seated.
    const { id } = (await friend("/rooms", { options: { game: "gin" } })).body;
    await friend("/rooms/" + id + "/sit", { seat: 0, name: "Friend" });
    await pest("/rooms/" + id + "/sit", { seat: 1, name: "Pest" });
    await friend("/rooms/" + id + "/start", {});
    expect((await friend("/admin/block", { table: id, seat: 1 })).status).toBe(403); // not an admin
    const done = (await admin("/admin/block", { table: id, seat: 1 })).body;
    expect(done).toMatchObject({ ok: true, name: "Pest" });
    expect((await friend("/rooms/" + id)).body.seats[1]).toMatchObject({ bot: true });

    // Blocked: they can look, and that's all.
    const no = { status: 403, body: { error: "You've been blocked from this card room." } };
    expect((await pest("/rooms/" + id)).status).toBe(200);
    expect(await pest("/rooms", { options: { game: "gin" } })).toEqual(no);
    expect(await pest("/lobby/join", { game: "gin", name: "Pest" })).toEqual(no);
    expect(await pest("/challenges/mine", { name: "Pest" })).toEqual(no);
    expect(await pest("/houses", { name: "Pest House", you: "Pest" })).toEqual(no);

    // The list shows a name and an id that isn't the player's cookie.
    const { blocked } = (await admin("/admin/blocked")).body;
    expect(blocked).toEqual([{ id: done.id, name: "Pest", at: expect.any(Number) }]);
    expect(JSON.stringify(blocked)).not.toMatch(/[a-z0-9]{24}/);
    expect((await admin("/admin/unblock", { id: done.id })).body).toEqual({ ok: true });
    expect((await pest("/lobby/join", { game: "gin", name: "Pest" })).status).toBe(201);
    // Nobody can pull the blocked list through the sync log.
    const pulled = (await pest("/_zb/sync/pull?since=0")).body.changes.map((c: { collection: string }) => c.collection);
    expect(pulled).not.toContain("admin");
  });

  it("acts as host at an open table it isn't seated at", async () => {
    const { phone } = setup();
    const admin = phone();
    const host = phone();
    const guest = phone();
    await admin("/admin/signin", { key: "let-me-in-please" });
    const { id } = (await host("/lobby/join", { game: "hearts", name: "Host", seats: 4 })).body;
    await guest("/lobby/" + id + "/sit", { name: "Guest" });
    expect((await admin("/lobby/" + id + "/mute", { seat: 1 })).body).toEqual({ muted: true });
    expect((await admin("/lobby/" + id + "/remove", { seat: 0 })).body).toEqual({ ok: true });
    // The host is gone, so the table is the guest's now.
    expect((await guest("/rooms/" + id)).body).toMatchObject({ host: 1, muted: [1] });
  });
});
