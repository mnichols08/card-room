import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";
import { plain, SHOT_LIMIT, type BugOptions } from "../src/bugs.js";

const BASE = "https://cards.test";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((a) => a.close());
  open = [];
});

/** A tiny real JPEG header and some bytes: enough to be taken for a picture. */
const jpeg = (size = 64) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)]).toString("base64")}`;

function setup(bugs: BugOptions = {}) {
  /** What GitHub was asked, newest last. */
  const asked: { url: string; headers: Record<string, string>; body: { title: string; body: string; labels: string[] } }[] = [];
  let github: () => Response = () => new Response(JSON.stringify({ number: 40 + asked.length, html_url: `https://github.com/o/r/issues/${40 + asked.length}` }), { status: 201 });
  const fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return github();
  }) as unknown as typeof globalThis.fetch;
  const app = createCardRoom({ log: memoryLog({ keep: "latest" }), botDelay: 5, talk: false, admin: { key: "let-me-in-please" }, bugs: { token: "ghp_secret", repo: "o/r", version: "abc1234", fetch, ...bugs } });
  open.push(app);
  const phone = () => {
    const cookies = new Map<string, string>();
    return async (path: string, body?: unknown) => {
      const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      const r = (await app.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined })))!;
      const set = r.headers.get("set-cookie")?.split(";")[0];
      if (set) cookies.set(set.split("=")[0]!, set.split("=")[1]!);
      return { status: r.status, type: r.headers.get("content-type"), body: r.headers.get("content-type") === "application/json" ? await r.json() : Buffer.from(await r.arrayBuffer()) };
    };
  };
  return { app, phone, asked, failGitHub: (status = 500) => (github = () => new Response("no", { status })) };
}

describe("reporting a problem", () => {
  it("is off, and says so, until the server has a token", async () => {
    const { phone, asked } = setup({ token: "" });
    const me = phone();
    expect((await me("/bugs/config")).body).toEqual({ enabled: false });
    expect((await me("/bugs", { description: "Hello" })).status).toBe(503);
    expect(asked).toEqual([]);
  });

  it("opens an issue from a player's words, and tells them its number", async () => {
    const { phone, asked } = setup();
    const me = phone();
    expect((await me("/bugs/config")).body).toEqual({ enabled: true });
    const sent = await me("/bugs", { description: "The cards overlap on my phone.\nI couldn't tap the ace.", screen: "table", game: "spades", built: "2026-11-14T09:00Z" });
    expect(sent).toMatchObject({ status: 201, body: { ok: true, number: 41, url: "https://github.com/o/r/issues/41" } });

    const [issue] = asked;
    expect(issue!.url).toBe("https://api.github.com/repos/o/r/issues");
    expect(issue!.headers.authorization).toBe("Bearer ghp_secret");
    expect(issue!.body.title).toBe("The cards overlap on my phone.");
    expect(issue!.body.labels).toEqual(["bug", "player report"]);
    expect(issue!.body.body).toContain("> The cards overlap on my phone.\n> I couldn't tap the ace.");
    expect(issue!.body.body).toContain("| Where | table (spades) |");
    expect(issue!.body.body).toContain("`abc1234`");
    expect(issue!.body.body).toContain("No screenshot.");
    expect(issue!.body.body).toContain("chose not to share browser details");
    // The token is the server's alone.
    expect(JSON.stringify(sent.body)).not.toContain("ghp_secret");
  });

  it("needs no description at all", async () => {
    const { phone, asked } = setup();
    expect((await phone()("/bugs", { screen: "lobby" })).status).toBe(201);
    expect(asked[0]!.body.title).toBe("Problem reported on lobby");
    expect(asked[0]!.body.body).toContain("didn't add a description");
  });

  it("can't be used to mention people, link issues or break out of the report", async () => {
    const { phone, asked } = setup();
    await phone()("/bugs", {
      description: "@octocat look at #1 <img src=x> [click](http://evil.test) ```",
      errors: ["TypeError: x is undefined\n```\n@octocat ![](http://evil.test/a.png)"],
      browser: { userAgent: "Mozilla ``` @octocat", viewport: "390×844", sneaky: "ignored" },
    });
    const { title, body } = asked[0]!.body;
    expect(title).not.toMatch(/@octocat/);
    const quoted = body.split("\n").find((l) => l.startsWith("> "))!;
    expect(quoted).toBe("> @​octocat look at \\#1 \\<img src=x\\> \\[click\\](http://evil.test) \\`\\`\\`");
    // What the page logged sits in code blocks that its own backticks can't close.
    expect(body).toContain("````\nTypeError: x is undefined\n```\n@octocat ![](http://evil.test/a.png)\n````");
    expect(body).toContain("````\nBrowser: Mozilla ``` @octocat\nWindow: 390×844\n````");
    expect(body).not.toContain("ignored");
    expect(plain("a_b*c")).toBe("a\\_b\\*c");
  });

  it("keeps an agreed screenshot and links the issue to it", async () => {
    const { phone, asked } = setup();
    const me = phone();
    const picture = jpeg();
    expect((await me("/bugs", { description: "Look", screenshot: picture })).status).toBe(201);
    const link = asked[0]!.body.body.match(/!\[What the player saw\]\((https:\/\/cards\.test\/bugs\/shots\/[a-z0-9]{20}\.jpg)\)/)?.[1];
    expect(link).toBeTruthy();
    const shown = await me(link!.replace(BASE, ""));
    expect(shown).toMatchObject({ status: 200, type: "image/jpeg" });
    expect((shown.body as Buffer).toString("base64")).toBe(picture.split(",")[1]);
    expect((await me("/bugs/shots/aaaaaaaaaaaaaaaaaaaa.jpg")).status).toBe(404);

    // Only a JPEG that fits is taken; anything else is refused before GitHub hears of it.
    expect((await me("/bugs", { screenshot: "data:image/svg+xml;base64,PHN2Zz4=" })).status).toBe(400);
    expect((await me("/bugs", { screenshot: `data:image/jpeg;base64,${Buffer.from("<html>").toString("base64")}` })).status).toBe(400);
    expect((await me("/bugs", { screenshot: jpeg(SHOT_LIMIT) })).status).toBe(400);
    expect(asked).toHaveLength(1);
    // Nobody can pull the pictures (or which table a report came from) through the sync log.
    const pulled = (await me("/_zb/sync/pull?since=0")).body.changes.map((c: { collection: string }) => c.collection);
    expect(pulled).not.toContain("bugs");
  });

  it("describes the table without saying who is at it, or how to get in", async () => {
    const { app, phone, asked } = setup();
    const me = phone();
    const { id } = (await me("/rooms", { options: { game: "gin" } })).body;
    await me("/rooms/" + id + "/sit", { seat: 0, name: "Grammi" });
    await phone()("/rooms/" + id + "/sit", { seat: 1, name: "Pappy" });
    await me("/rooms/" + id + "/start", {});
    const sent = await me("/bugs", { description: "Stuck", screen: "table", table: id });
    const { body } = asked[0]!.body;
    expect(body).toContain("Game: Gin Rummy");
    expect(body).toContain("Seats: 2 (2 people, 0 computer, 0 empty)");
    expect(body).toMatch(/Dealt: yes, \d+ moves? in/);
    expect(body).toContain("Kind of table: family table");
    expect(body).not.toMatch(/Grammi|Pappy/);
    expect(body).not.toContain(id);
    // Whoever runs the server can still find the table.
    const kept = (await app.rooms.sync.documents()).get("bugs", "reports");
    expect(kept).toMatchObject({ [`n${sent.body.number}`]: { table: id } });
  });

  it("says so when GitHub can't be reached, and keeps nothing", async () => {
    const { app, phone, failGitHub } = setup();
    failGitHub(401);
    const sent = await phone()("/bugs", { description: "Oh no", screenshot: jpeg() });
    expect(sent).toMatchObject({ status: 502, body: { error: expect.stringContaining("couldn't be sent") } });
    const shots = (await app.rooms.sync.documents()).get("bugs", "shots") ?? {};
    expect(Object.values(shots).filter(Boolean)).toEqual([]);
  });

  it("takes only a few from one browser, and a day's worth from everyone", async () => {
    let at = 1_000_000;
    const { phone, asked } = setup({ each: 2, daily: 3, now: () => at });
    const me = phone();
    const { id } = (await me("/rooms", { options: { game: "gin" } })).body; // gives this phone its player cookie
    expect(id).toBeTruthy();
    expect((await me("/bugs", { description: "one" })).status).toBe(201);
    expect((await me("/bugs", { description: "two" })).status).toBe(201);
    expect(await me("/bugs", { description: "three" })).toMatchObject({ status: 429, body: { error: expect.stringContaining("ten minutes") } });
    at += 11 * 60_000;
    expect((await me("/bugs", { description: "three" })).status).toBe(201);
    at += 11 * 60_000;
    expect(await me("/bugs", { description: "four" })).toMatchObject({ status: 429, body: { error: expect.stringContaining("tomorrow") } });
    expect(asked).toHaveLength(3);
  });

  it("isn't for a blocked player", async () => {
    const { phone, asked } = setup();
    const admin = phone();
    const pest = phone();
    await admin("/admin/signin", { key: "let-me-in-please" });
    const { id } = (await admin("/rooms", { options: { game: "gin" } })).body;
    await admin("/rooms/" + id + "/sit", { seat: 0, name: "Admin" });
    await pest("/rooms/" + id + "/sit", { seat: 1, name: "Pest" });
    await admin("/admin/block", { table: id, seat: 1 });
    expect((await pest("/bugs", { description: "spam" })).status).toBe(403);
    expect(asked).toEqual([]);
  });
});
