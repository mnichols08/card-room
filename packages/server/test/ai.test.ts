import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createAi, promptFor } from "../src/ai.js";
import { createCardRoom } from "../src/app.js";

const BASE = "http://test";
const KEY = "sk-ant-test-0123456789abcdefWXYZ";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
});

/** A stand-in for the AI services: remembers what it was sent and answers with `say`. */
function service(say: (body: any, url: string) => { status?: number; line?: string } = () => ({ line: "Well hello there, sugar 🥰" })) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
    const { status = 200, line = "" } = say(body, String(url));
    const answer = String(url).includes("anthropic") ? { content: [{ type: "text", text: line }] } : { choices: [{ message: { content: line } }] };
    return new Response(JSON.stringify(status === 200 ? answer : { error: { message: "no" } }), { status });
  }) as typeof fetch;
  return { fake, calls };
}

function setup(fake: typeof fetch, shared?: { key: string; daily?: number }) {
  const log = memoryLog({ keep: "latest" });
  const app = createCardRoom({ log, botDelay: 5, ai: { fetch: fake, secret: "a server secret", shared } });
  open.push(app);
  const phone = () => {
    let cookie = "";
    const send = async (path: string, body?: unknown) => {
      const response = (await app.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined })))!;
      const set = response.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return { status: response.status, body: await response.json() };
    };
    return { send };
  };
  return { app, phone, log };
}

const chatOf = async (send: (path: string) => Promise<{ body: any }>) =>
  ((await send(`/_zb/sync/pull?since=0`)).body.changes as { collection: string; value: { seat: number; text: string; bot: boolean } }[]).filter((c) => c.collection === "chat").map((c) => c.value);

describe("a house's AI connection", () => {
  it("an owner connects a key; it's tried first, sealed, and never sent back", async () => {
    const { fake, calls } = service();
    const { phone, app } = setup(fake);
    const grammi = phone();
    const rick = phone();
    const made = await grammi.send("/houses", { name: "Grammi's House", you: "brokennil" });
    expect(made.body.ai).toBeNull();
    await rick.send("/houses/grammis-house/join", { code: made.body.code, name: "Rick" });

    // Members can't connect anything.
    expect((await rick.send("/houses/grammis-house/ai", { provider: "anthropic", key: KEY })).status).toBe(403);
    expect((await grammi.send("/houses/grammis-house/ai", { provider: "anthropic", key: "short" })).status).toBe(400);
    expect((await grammi.send("/houses/grammis-house/ai", { provider: "nope", key: KEY })).status).toBe(400);

    const saved = await grammi.send("/houses/grammis-house/ai", { provider: "anthropic", key: KEY, context: "Grammi is brokennil and always bids blind nil." });
    expect(saved.status).toBe(200);
    expect(saved.body.ai).toEqual({ provider: "anthropic", model: "claude-haiku-5-5", context: "Grammi is brokennil and always bids blind nil.", on: true, keyEnding: "WXYZ" });
    expect(JSON.stringify(saved.body)).not.toContain(KEY);
    // The key was tried against the service before it was saved.
    expect(calls[0]).toMatchObject({ url: "https://api.anthropic.com/v1/messages", body: { model: "claude-haiku-5-5" } });
    expect(calls[0]!.headers["x-api-key"]).toBe(KEY);

    // A member only learns that the bots talk through a model.
    expect((await rick.send("/houses/grammis-house")).body.ai).toEqual({ on: true });
    // The log holds the key sealed, and nobody can pull the house document.
    const stored = (await app.rooms.sync.documents()).get("houses", "grammis-house")!.ai as { key: string };
    expect(stored.key.startsWith("gcm:")).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(KEY);
    expect(JSON.stringify((await grammi.send("/_zb/sync/pull?since=0")).body)).not.toContain("gcm:");

    // Changing the notes keeps the key and doesn't call the service again.
    const before = calls.length;
    const noted = await grammi.send("/houses/grammis-house/ai", { context: "Pappy hates nil.", on: false });
    expect(noted.body.ai).toMatchObject({ context: "Pappy hates nil.", on: false, keyEnding: "WXYZ" });
    expect(calls.length).toBe(before);
    expect((await grammi.send("/houses/grammis-house/ai-test", {})).body.line).toBe("Well hello there, sugar 🥰");

    expect((await grammi.send("/houses/grammis-house/ai", { disconnect: true })).body.ai).toBeNull();
    expect((await app.rooms.sync.documents()).get("houses", "grammis-house")!.ai ?? null).toBeNull();
  });

  it("a key the service refuses isn't saved", async () => {
    const { fake } = service(() => ({ status: 401 }));
    const { phone } = setup(fake);
    const grammi = phone();
    await grammi.send("/houses", { name: "Grammi's House", you: "brokennil" });
    const refused = await grammi.send("/houses/grammis-house/ai", { provider: "openai", key: KEY });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/refused/);
    expect((await grammi.send("/houses/grammis-house")).body.ai).toBeNull();
  });

  it("the bots at a house table talk in the model's words, and the model never sees a hand", async () => {
    const { fake, calls } = service((body) => ({ line: /just said/.test(body.messages.at(-1).content) ? "Pie's in the oven, dear 🥧" : "Model says hello!" }));
    const { phone, app } = setup(fake);
    const grammi = phone();
    await grammi.send("/houses", { name: "Grammi's House", you: "brokennil" });
    await grammi.send("/houses/grammis-house/ai", { provider: "openai", key: KEY, context: "Grammi bakes the pies." });
    const { id } = (await grammi.send("/houses/grammis-house/tables", {})).body;
    await grammi.send(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    for (const [seat, name] of [[1, "Hank"], [2, "Pearl"], [3, "Lou"]] as const) await grammi.send(`/rooms/${id}/bot`, { seat, name });
    const tried = calls.length;
    await grammi.send(`/rooms/${id}/start`, {});
    // No scripted reply covers a question: with a model connected, the bot she named answers.
    await grammi.send(`/rooms/${id}/say`, { text: "Pearl, what's for dessert?" });
    await new Promise((r) => setTimeout(r, 3500));

    const chat = await chatOf(grammi.send);
    const bots = chat.filter((m) => m.bot);
    expect(bots.length).toBeGreaterThan(0);
    expect(bots.every((m) => m.text === "Model says hello!" || m.text === "Pie's in the oven, dear 🥧")).toBe(true);
    expect(chat.find((m) => m.seat === 2 && m.text === "Pie's in the oven, dear 🥧")).toBeTruthy();

    const asked = calls.slice(tried);
    expect(asked[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    const prompt = JSON.stringify(asked.map((c) => c.body.messages));
    expect(prompt).toContain("Grammi bakes the pies.");
    expect(prompt).toContain("Pearl, what's for dessert?");
    // What the model was told is only what the whole table sees: no cards from anyone's hand.
    const hand = ((await app.rooms.sync.documents()).get("views", `${id}/0`)!.view as { hand: unknown[] }).hand;
    expect(hand.length).toBeGreaterThan(0);
    expect(prompt).not.toMatch(/"suit"|"rank"|"hand":/);
  }, 10_000);

  it("the bots say their own lines when the model fails, and at tables outside the house", async () => {
    let fail = false;
    const { fake, calls } = service(() => (fail ? { status: 500 } : { line: "Model says hello!" }));
    const { phone } = setup(fake);
    const grammi = phone();
    await grammi.send("/houses", { name: "Grammi's House", you: "brokennil" });
    await grammi.send("/houses/grammis-house/ai", { provider: "anthropic", key: KEY });
    fail = true;
    const { id } = (await grammi.send("/houses/grammis-house/tables", {})).body;
    await grammi.send(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    for (const [seat, name] of [[1, "Hank"], [2, "Dot"], [3, "Lou"]] as const) await grammi.send(`/rooms/${id}/bot`, { seat, name });
    await grammi.send(`/rooms/${id}/start`, {});
    await grammi.send(`/rooms/${id}/say`, { text: "good luck Dot 🍀" });
    await new Promise((r) => setTimeout(r, 3000));
    const dot = (await chatOf(grammi.send)).filter((m) => m.seat === 2 && m.bot);
    expect(dot.length).toBeGreaterThan(0);
    expect(dot.some((m) => m.text === "Model says hello!")).toBe(false);

    // A table that isn't the house's never calls the service.
    fail = false;
    const n = calls.length;
    const open = (await grammi.send("/rooms", { options: {} })).body.id;
    await grammi.send(`/rooms/${open}/sit`, { seat: 0, name: "brokennil" });
    for (const [seat, name] of [[1, "Hank"], [2, "Dot"], [3, "Lou"]] as const) await grammi.send(`/rooms/${open}/bot`, { seat, name });
    await grammi.send(`/rooms/${open}/start`, {});
    await grammi.send(`/rooms/${open}/say`, { text: "Dot, what's for dessert?" });
    await new Promise((r) => setTimeout(r, 2500));
    expect(calls.length).toBe(n);
  }, 12_000);
});

describe("the card room's own key", () => {
  const SERVER_KEY = "sk-ant-the-card-rooms-own-key-0000";
  const table = async (send: (path: string, body?: unknown) => Promise<{ body: any }>, made: string, say: string) => {
    await send(`/rooms/${made}/sit`, { seat: 0, name: "brokennil" });
    for (const [seat, name] of [[1, "Hank"], [2, "Pearl"], [3, "Lou"]] as const) await send(`/rooms/${made}/bot`, { seat, name });
    await send(`/rooms/${made}/start`, {});
    await send(`/rooms/${made}/say`, { text: say });
    await new Promise((r) => setTimeout(r, 2800));
  };

  it("every table's bots talk through it, a house adds its notes with no key, and can switch it off", async () => {
    const { fake, calls } = service(() => ({ line: "Model says hello!" }));
    const { phone } = setup(fake, { key: SERVER_KEY });
    const grammi = phone();
    const rick = phone();

    // A table that isn't in any house.
    const loose = (await grammi.send("/rooms", { options: {} })).body.id;
    await table(grammi.send, loose, "Pearl, what's for dessert?");
    expect((await chatOf(grammi.send)).some((m) => m.bot && m.text === "Model says hello!")).toBe(true);
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]!.headers["x-api-key"]).toBe(SERVER_KEY);

    // A new house rides on it straight away; its managers never see the key.
    const made = await grammi.send("/houses", { name: "Grammi's House", you: "brokennil" });
    expect(made.body.aiServer).toBe(true);
    expect(made.body.ai).toEqual({ provider: "server", model: "claude-haiku-5-5", context: "", on: true, keyEnding: "" });
    await rick.send("/houses/grammis-house/join", { code: made.body.code, name: "Rick" });
    expect((await rick.send("/houses/grammis-house")).body.ai).toEqual({ on: true });

    const noted = await grammi.send("/houses/grammis-house/ai", { provider: "server", context: "Grammi bakes the pies." });
    expect(noted.body.ai).toMatchObject({ provider: "server", context: "Grammi bakes the pies.", on: true });
    expect(JSON.stringify(noted.body)).not.toContain(SERVER_KEY);
    const before = calls.length;
    await table(grammi.send, (await grammi.send("/houses/grammis-house/tables", {})).body.id, "Pearl, what's for dessert?");
    expect(JSON.stringify(calls.slice(before).map((c) => c.body))).toContain("Grammi bakes the pies.");

    // Switched off, the house's bots go back to their own lines; the notes are kept.
    expect((await grammi.send("/houses/grammis-house/ai", { on: false })).body.ai).toMatchObject({ provider: "server", context: "Grammi bakes the pies.", on: false });
    const quiet = calls.length;
    await table(grammi.send, (await grammi.send("/houses/grammis-house/tables", {})).body.id, "Pearl, what's for dessert?");
    expect(calls.length).toBe(quiet);

    // A house can still connect its own account instead.
    const own = await grammi.send("/houses/grammis-house/ai", { provider: "openai", key: KEY });
    expect(own.body.ai).toMatchObject({ provider: "openai", keyEnding: "WXYZ", context: "Grammi bakes the pies." });
    expect(calls.at(-1)!.headers.authorization).toBe(`Bearer ${KEY}`);
  }, 15_000);

  it("stops at its daily ceiling, and isn't offered when there's none", async () => {
    const { fake, calls } = service(() => ({ line: "Model says hello!" }));
    const { phone } = setup(fake, { key: SERVER_KEY, daily: 1 });
    const grammi = phone();
    await table(grammi.send, (await grammi.send("/rooms", { options: {} })).body.id, "Pearl, what's for dessert?");
    expect(calls.length).toBe(1);

    const none = setup(fake);
    const rick = none.phone();
    const made = await rick.send("/houses", { name: "Pappy's Place", you: "Rick" });
    expect(made.body).toMatchObject({ ai: null, aiServer: false });
    expect((await rick.send("/houses/pappys-place/ai", { provider: "server" })).status).toBe(400);
  }, 10_000);
});

describe("keys and prompts", () => {
  it("a sealed key opens only under the same secret", () => {
    const mine = createAi({ secret: "one" });
    const sealed = { provider: "anthropic" as const, key: mine.seal(KEY), model: "m", context: "", on: true };
    expect(sealed.key).not.toContain(KEY);
    expect(mine.view(sealed)!.keyEnding).toBe("WXYZ");
    expect(createAi({ secret: "two" }).readable(sealed)).toBe(false);
    expect(createAi().readable(sealed)).toBe(false);
  });

  it("the prompt names the bot, the house and the moment", () => {
    const { system, user } = promptFor(
      { context: "Pappy hates nil." },
      { house: "Grammi's House", game: "Spades", bot: "Hank", character: "Grumbles", players: [{ name: "brokennil", bot: false }, { name: "Hank", bot: true }], summary: { hand: 2 }, chat: [{ name: "brokennil", text: "hi all" }], gist: "Nice hand." },
    );
    expect(system).toContain("You are Hank");
    expect(system).toContain("Pappy hates nil.");
    expect(user).toContain("brokennil, Hank (computer)");
    expect(user).toContain("Nice hand.");
  });
});
