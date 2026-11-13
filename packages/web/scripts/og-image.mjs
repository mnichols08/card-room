// Draws the link-preview image (public/og.jpg, 1200×630) from the app's own cards: a fan of them on
// the felt, with the name and some of the games. Run it against a running card room when the games
// change:
//
//   npm run dev -w @spades/server            # or any running card room
//   npm install --no-save puppeteer-core     # once; it isn't a dependency of the app
//   node packages/web/scripts/og-image.mjs [http://localhost:8787] [path/to/og.jpg]
//
// It needs a Chrome or Chromium (CHROME=/path/to/chrome if it isn't /usr/bin/google-chrome).
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = process.argv[2] ?? "http://localhost:8787";
const out = process.argv[3] ?? new URL("../public/og.jpg", import.meta.url).pathname;
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--font-render-hinting=none"] });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await p.goto(`${server}/?game=spades`, { waitUntil: "networkidle0" });
await p.evaluate(async () => {
  for (let i = 0; i < 50 && !customElements.get("playing-card"); i++) await new Promise((r) => setTimeout(r, 100));
  document.documentElement.removeAttribute("data-suits");
  document.head.insertAdjacentHTML("beforeend", `<style>
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body::before { display: none !important; }
    #og { position: relative; width: 1200px; height: 630px; overflow: hidden; box-sizing: border-box;
      background: radial-gradient(ellipse 80% 90% at 68% 55%, #2f8a5f 0%, #1e6545 45%, #0f3a28 100%); }
    #og::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 0 14px #3a2417, inset 0 0 0 16px rgba(232,196,106,.35), inset 0 0 120px rgba(0,0,0,.45); pointer-events: none; }
    #og .words { position: absolute; left: 76px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; gap: 14px; color: #f6efdf; }
    #og .suits { font: 600 30px/1 "Apple Symbols", "Noto Sans Symbols 2", "Segoe UI Symbol", serif; letter-spacing: .5em; color: #e8c46a; }
    #og h1 { margin: 0; font: 700 112px/1 Georgia, "Times New Roman", serif; letter-spacing: -.01em; text-shadow: 0 4px 18px rgba(0,0,0,.35); }
    #og .tag { margin: 0; font: italic 400 36px/1.25 Georgia, serif; color: #f1e6cc; }
    #og .games { margin: 10px 0 0; font: 600 25px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8c46a; }
    #og .fan { position: absolute; left: 915px; top: 700px; width: 0; height: 0; --card-w: 150px; --card-h: 210px; }
    #og .fan .slot { position: absolute; left: -75px; top: -505px; transform-origin: 75px 505px; filter: drop-shadow(0 14px 22px rgba(0,0,0,.45)); }
  </style>`);
  document.body.innerHTML = `<div id="og"><div class="words"><div class="suits">♠ ♥ ♣ ♦</div><h1>Card Room</h1><p class="tag">Family card games online</p><p class="games">Spades · Palace · Hearts · Euchre · Canasta<br>Gin · Go Fish · Golf · President · and more</p></div><div class="fan"></div></div>`;
  const fan = document.querySelector("#og .fan");
  const cards = [[10, "spades"], [11, "hearts"], [12, "diamonds"], [13, "clubs"], [14, "spades"]];
  cards.forEach(([rank, suit], i) => {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.style.transform = `rotate(${(i - 2) * 11}deg)`;
    const el = document.createElement("playing-card");
    el.card = { kind: "pip", rank, suit };
    el.size = "hand";
    slot.append(el);
    fan.append(slot);
  });
});
await sleep(800);
await p.screenshot({ path: out, type: "jpeg", quality: 88, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await b.close();
console.log("wrote", out);
