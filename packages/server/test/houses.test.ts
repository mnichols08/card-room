import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";
import { slugify } from "../src/houses.js";

const BASE = "http://test";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
});

function setup() {
  const app = createCardRoom({ log: memoryLog({ keep: "latest" }), botDelay: 5 });
  open.push(app);
  const phone = () => {
    let cookie = "";
    const send = async (path: string, body?: unknown) => {
      const response = (await app.fetch(
        new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined }),
      ))!;
      const set = response.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return { status: response.status, body: await response.json(), raw: response };
    };
    return { send, cookie: () => cookie };
  };
  return { app, phone };
}

describe("houses", () => {
  it("slugs come from the name", () => {
    expect(slugify("Grammi's House")).toBe("grammis-house");
    expect(slugify("  !!! ")).toBe("house");
  });

  it("an owner makes a house; family join with the link; strangers can't see it", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const stranger = phone();

    const made = await grammi.send("/houses", { name: "Grammi's House", you: "brokennil" });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ slug: "grammis-house", name: "Grammi's House", me: { name: "brokennil", role: "owner" } });
    const code = made.body.code as string;

    expect((await stranger.send("/houses/grammis-house")).status).toBe(403);
    expect((await stranger.send(`/houses/grammis-house?code=${code}`)).body).toEqual({ slug: "grammis-house", name: "Grammi's House", member: false });
    expect((await stranger.send("/houses/grammis-house/join", { code: "wrong", name: "Nope" })).status).toBe(403);

    const joined = await rick.send("/houses/grammis-house/join", { code, name: "Rick" });
    expect(joined.status).toBe(200);
    expect(joined.body.me).toMatchObject({ name: "Rick", role: "member" });
    expect(joined.body.members.map((m: { name: string }) => m.name)).toEqual(["brokennil", "Rick"]);
    // Coming back later needs no code: the cookie is the membership.
    expect((await rick.send("/houses/grammis-house")).body.me.name).toBe("Rick");
  });

  it("never sends anyone a player's secret", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const { body } = await grammi.send("/houses", { name: "Grammi's House", you: "brokennil" });
    await rick.send("/houses/grammis-house/join", { code: body.code, name: "Rick" });
    const seen = JSON.stringify((await rick.send("/houses/grammis-house")).body);
    for (const secret of [grammi.cookie(), rick.cookie()].map((c) => c.split("=")[1]!)) expect(seen).not.toContain(secret);
    // Nor through the sync log: house documents are the server's alone.
    const pulled = await rick.send("/_zb/sync/pull?since=0");
    expect(pulled.body.changes.filter((c: { collection: string }) => c.collection === "houses")).toEqual([]);
  });

  it("members open tables with the house rules; only owners and admins change the rules", async () => {
    const { phone, app } = setup();
    const grammi = phone();
    const rick = phone();
    const made = (await grammi.send("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    const joined = (await rick.send("/houses/grammis-house/join", { code: made.code, name: "Rick" })).body;

    const quick = { ...made.presets[0], id: "quick", name: "Quick to 250", playTo: 250 };
    expect((await rick.send("/houses/grammis-house/presets", { preset: quick })).status).toBe(403);
    expect((await grammi.send("/houses/grammis-house/presets", { preset: { ...quick, playTo: -5 } })).status).toBe(400);
    const withQuick = await grammi.send("/houses/grammis-house/presets", { preset: quick, makeDefault: true });
    expect(withQuick.body.defaultPreset).toBe("quick");

    const table = await rick.send("/houses/grammis-house/tables", {});
    expect(table.status).toBe(201);
    const house = (await rick.send("/houses/grammis-house")).body;
    expect(house.tables[0]).toMatchObject({ id: table.body.id, rules: "Quick to 250", started: false });
    // The table really has the house rules: start it and look at the summary.
    await rick.send(`/rooms/${table.body.id}/sit`, { seat: 0, name: "Rick" });
    for (const seat of [1, 2, 3]) await rick.send(`/rooms/${table.body.id}/bot`, { seat });
    await rick.send(`/rooms/${table.body.id}/start`, {});
    expect((await rick.send(`/rooms/${table.body.id}`)).body.summary).toMatchObject({ rules: "Quick to 250", playTo: 250 });

    // Promote Rick to admin; now he may edit the rules.
    await grammi.send("/houses/grammis-house/role", { member: joined.me.id, role: "admin" });
    expect((await rick.send("/houses/grammis-house/default", { id: made.presets[0].id })).status).toBe(200);
    // But not roles: that's the owner's alone.
    expect((await rick.send("/houses/grammis-house/role", { member: made.me.id, role: "member" })).status).toBe(403);
  });

  it("a new invite link retires the old one", async () => {
    const { phone } = setup();
    const grammi = phone();
    const late = phone();
    const made = (await grammi.send("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    const fresh = (await grammi.send("/houses/grammis-house/new-link", {})).body;
    expect(fresh.code).not.toBe(made.code);
    expect((await late.send("/houses/grammis-house/join", { code: made.code, name: "Late" })).status).toBe(403);
    expect((await late.send("/houses/grammis-house/join", { code: fresh.code, name: "Late" })).status).toBe(200);
  });

  it("two houses with one name get different links", async () => {
    const { phone } = setup();
    const a = (await phone().send("/houses", { name: "Grammi's House", you: "A" })).body;
    const b = (await phone().send("/houses", { name: "Grammi's House", you: "B" })).body;
    expect(a.slug).toBe("grammis-house");
    expect(b.slug).toMatch(/^grammis-house-[a-z0-9]{3}$/);
  });
});
