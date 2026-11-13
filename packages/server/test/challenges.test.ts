import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";
import type { Notice, Subscription } from "../src/push.js";

const BASE = "http://test";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((a) => a.close());
  open = [];
});

const sub = (n: number): Subscription => ({ endpoint: `https://push.example/phone-${n}`, keys: { p256dh: "BPkey", auth: "authkey" } });

function setup(opts: { withPush?: boolean } = { withPush: true }) {
  const sent: { to: string; notice: Notice }[] = [];
  const gone = new Set<string>();
  const app = createCardRoom({
    log: memoryLog({ keep: "latest" }),
    botDelay: 50,
    talk: false,
    push: opts.withPush
      ? {
          send: async (s, payload) => {
            if (gone.has(s.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 });
            sent.push({ to: s.endpoint, notice: JSON.parse(payload) });
          },
        }
      : {},
  });
  open.push(app);
  const phone = () => {
    let cookie = "";
    return async (path: string, body?: unknown) => {
      const r = (await app.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined })))!;
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return { status: r.status, body: await r.json() };
    };
  };
  return { app, phone, sent, gone };
}

describe("push notifications", () => {
  it("keep each phone's subscription where only the server can see it, and forget phones that are gone", async () => {
    const { phone, app, sent, gone } = setup();
    const grammi = phone();
    expect((await grammi("/push/subscribe", { subscription: sub(1) })).status).toBe(403); // no player yet
    await grammi("/challenges/mine", { name: "brokennil" });
    expect((await grammi("/push/subscribe", { subscription: { endpoint: "http://not-https" } })).status).toBe(400);
    expect((await grammi("/push/subscribe", { subscription: sub(1) })).status).toBe(200);
    expect((await grammi("/push/subscribe", { subscription: sub(2) })).status).toBe(200);
    expect((await grammi("/push/test", {})).body).toEqual({ delivered: 2 });
    expect(sent.map((s) => s.to)).toEqual([sub(1).endpoint, sub(2).endpoint]);

    // Nobody can pull subscriptions through the sync log.
    const pulled = (await phone()("/_zb/sync/pull?since=0")).body.changes.map((c: { collection: string }) => c.collection);
    expect(pulled).not.toContain("pushsubs");

    gone.add(sub(1).endpoint);
    sent.length = 0;
    await grammi("/push/test", {});
    await grammi("/push/test", {});
    expect(sent.filter((s) => s.to === sub(1).endpoint)).toHaveLength(0);
    expect(sent).toHaveLength(2);
    expect(app.push.enabled).toBe(true);
  });

  it("are off, and say so, without keys", async () => {
    const { phone } = setup({ withPush: false });
    const p = phone();
    expect((await p("/push/key")).body).toEqual({ enabled: false, publicKey: null });
    await p("/challenges/mine", { name: "x" });
    expect((await p("/push/subscribe", { subscription: sub(1) })).status).toBe(503);
  });
});

describe("challenges", () => {
  it("anyone with the link challenges her; she gets a buzz that opens a table already set", async () => {
    const { phone, sent } = setup();
    const grammi = phone();
    const rick = phone();
    const link = (await grammi("/challenges/mine", { name: "brokennil" })).body;
    expect(link).toMatchObject({ name: "brokennil", enabled: true, rules: "Family Table" });
    await grammi("/push/subscribe", { subscription: sub(1) });

    expect((await rick(`/challenges/${link.code}`)).body).toMatchObject({ name: "brokennil", enabled: true });
    const sentChallenge = await rick(`/challenges/${link.code}`, { name: "Rick", message: "Bring it on, Grammi 😤" });
    expect(sentChallenge.status).toBe(201);
    expect(sentChallenge.body.notified).toBe(true);
    const id = sentChallenge.body.id;

    expect(sent).toHaveLength(1);
    expect(sent[0]!.notice).toMatchObject({ title: "Rick challenged you to Spades! ♠️", url: `/?table=${id}` });
    expect(sent[0]!.notice.body).toContain("Bring it on, Grammi 😤");

    // The table: her in the south seat, Rick across as an opponent, a partner bot each.
    const table = (await grammi(`/rooms/${id}`)).body;
    expect(table.seat).toBe(0);
    expect(table.seats.map((s: { name: string; bot: boolean }) => [s.name, s.bot]).slice(0, 2)).toEqual([
      ["brokennil", false],
      ["Rick", false],
    ]);
    expect(table.seats[2].bot && table.seats[3].bot).toBe(true);
    expect((await rick(`/rooms/${id}`)).body.seat).toBe(1);
    const chat = (await rick("/_zb/sync/pull?since=0")).body.changes.filter((c: { collection: string }) => c.collection === "chat");
    expect(chat[0].value).toMatchObject({ seat: 1, text: "Bring it on, Grammi 😤" });
    // She opens it and deals.
    expect((await grammi(`/rooms/${id}/start`, {})).status).toBe(200);
  });

  it("can't be sent to yourself, too fast, or to a link that's off or replaced", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const link = (await grammi("/challenges/mine", { name: "brokennil" })).body;
    expect((await grammi(`/challenges/${link.code}`, { name: "me" })).status).toBe(400);
    expect((await rick(`/challenges/${link.code}`, { name: "" })).status).toBe(400);
    expect((await rick(`/challenges/${link.code}`, { name: "Rick" })).status).toBe(201);
    expect((await rick(`/challenges/${link.code}`, { name: "Rick" })).status).toBe(429);

    await grammi("/challenges/mine", { enabled: false });
    expect((await phone()(`/challenges/${link.code}`, { name: "Jimmy" })).status).toBe(409);

    const fresh = (await grammi("/challenges/mine", { newLink: true, enabled: true })).body;
    expect(fresh.code).not.toBe(link.code);
    expect((await phone()(`/challenges/${link.code}`)).status).toBe(404);
    expect((await phone()(`/challenges/${fresh.code}`, { name: "Jimmy" })).status).toBe(201);
  });

  it("a busy link stops taking challenges for the hour", async () => {
    const { phone } = setup();
    const grammi = phone();
    const { code } = (await grammi("/challenges/mine", { name: "brokennil" })).body;
    const results = [];
    for (let i = 0; i < 8; i++) results.push((await phone()(`/challenges/${code}`, { name: `Fan ${i}` })).status);
    expect(results.filter((s) => s === 201)).toHaveLength(6);
    expect(results.at(-1)).toBe(429);
  });
});

describe("house tables", () => {
  it("buzz the rest of the house when someone opens one", async () => {
    const { phone, sent } = setup();
    const grammi = phone();
    const rick = phone();
    const made = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    await rick("/houses/grammis-house/join", { code: made.code, name: "Rick" });
    await grammi("/push/subscribe", { subscription: sub(1) });
    await rick("/push/subscribe", { subscription: sub(2) });
    const { id } = (await rick("/houses/grammis-house/tables", {})).body;
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.map((s) => s.to)).toEqual([sub(1).endpoint]); // not the one who opened it
    expect(sent[0]!.notice).toMatchObject({ title: "Rick opened a Spades table at Grammi's House ♠️", url: `/?table=${id}&house=grammis-house` });
  });
});
