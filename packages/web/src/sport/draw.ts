// Drawing a table sport on a canvas. Everything here is told what to draw (a view's table, where
// each ball is this instant, the aim) and draws it; it knows nothing about turns, rules or time.
// The world is drawn in its own units through one transform, so a hole, a pool table and a
// bowling lane all fit themselves to the screen the same way.
import type { SportBody, SportDecor, SportSurface, SportTone, SportView } from "@cardroom/games";
import type { Point, Shape, World } from "@cardroom/physics";

/** How world units land on the screen: screen = world × scale + offset, in CSS pixels. */
export interface Fit {
  scale: number;
  ox: number;
  oy: number;
}

/** The biggest the frame can be drawn in a box, centred, with bars at the sides or top and bottom. */
export function fitFrame(frame: { x: number; y: number; w: number; h: number }, width: number, height: number, pad = 6): Fit {
  const scale = Math.max(0.0001, Math.min((width - 2 * pad) / frame.w, (height - 2 * pad) / frame.h));
  return { scale, ox: (width - frame.w * scale) / 2 - frame.x * scale, oy: (height - frame.h * scale) / 2 - frame.y * scale };
}

/** One disc to draw: a body of the world or a ghost, wherever it is this frame. */
export interface Disc {
  id: string;
  x: number;
  y: number;
  r: number;
  look: SportBody | undefined;
  ghost?: boolean;
  /** 0 to 1: how far it has sunk into a pocket (it shrinks into the hole). */
  sunk?: number;
  /** The one you may strike now. */
  mine?: boolean;
}

export interface Aim {
  /** The ball being aimed. */
  x: number;
  y: number;
  r: number;
  /** Radians, for drawing only; what is sent is the whole-number angle. */
  angle: number;
  /** 0 to 1 of full power. */
  power: number;
  /** A finger is down and pulling: the band is drawn, and the line is bold. */
  pulling: boolean;
  /** The pull is inside the cancel zone: letting go does nothing. */
  cancel: boolean;
}

export interface Scene {
  table: SportView["table"];
  discs: Disc[];
  aim: Aim | null;
  /** A path just travelled, for when the roll itself isn't shown (reduced motion). */
  trace: Point[] | null;
  /** Rings spreading where a ball went in the water: position and 0 to 1 of the way through. */
  splashes: { x: number; y: number; t: number }[];
}

const TONES: Record<SportTone, [fill: string, shade: string, ink: string]> = {
  white: ["#fdfdf8", "#c9c6ba", "#1d1a16"],
  red: ["#e0453a", "#8f1f18", "#fff"],
  blue: ["#3d7fe6", "#1c4696", "#fff"],
  gold: ["#f2c230", "#a57a07", "#1d1a16"],
  green: ["#3fb56c", "#1c6b3a", "#fff"],
  purple: ["#9a5fd6", "#57298e", "#fff"],
  orange: ["#f6933a", "#a95208", "#1d1a16"],
  pink: ["#f284b6", "#a93a70", "#1d1a16"],
  maroon: ["#8e2a38", "#4d0f1a", "#fff"],
  black: ["#2a2622", "#000", "#fff"],
};
export const toneColour = (tone: SportTone | undefined) => TONES[tone ?? "white"][0];

const GROUND: Record<SportSurface, string> = { green: "#3f9c58", rough: "#2f7a45", sand: "#ead79f", water: "#3f97d8", slope: "#3f9c58", felt: "#2f8a5b", wood: "#c89a5a", lane: "#e0b877" };

function path(ctx: CanvasRenderingContext2D, shape: Shape | { points: Point[] }, closed = true) {
  ctx.beginPath();
  if ("points" in shape) {
    shape.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (closed) ctx.closePath();
  } else ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
}

function boxOf(shape: Shape): { x: number; y: number; w: number; h: number } {
  if (!("points" in shape)) return { x: shape.x - shape.r, y: shape.y - shape.r, w: 2 * shape.r, h: 2 * shape.r };
  const xs = shape.points.map((p) => p[0]);
  const ys = shape.points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** The same scatter of numbers every time for the same place, so sand doesn't shimmer between frames. */
function scatter(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function drawRegion(ctx: CanvasRenderingContext2D, world: World, id: string, surface: SportSurface, px: number) {
  const region = world.regions.find((r) => r.id === id);
  if (!region) return;
  const box = boxOf(region.shape);
  ctx.save();
  path(ctx, region.shape);
  ctx.clip();
  if (surface === "sand") {
    ctx.fillStyle = GROUND.sand;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    const rand = scatter(box.x * 31 + box.y);
    ctx.fillStyle = "rgba(150, 118, 60, 0.45)";
    for (let i = 0; i < Math.min(220, (box.w * box.h) / 90000); i++) ctx.fillRect(box.x + rand() * box.w, box.y + rand() * box.h, 1.4 * px, 1.4 * px);
    path(ctx, region.shape);
    ctx.lineWidth = 5 * px;
    ctx.strokeStyle = "rgba(120, 92, 40, 0.5)";
    ctx.stroke();
  } else if (surface === "water") {
    const g = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.h);
    g.addColorStop(0, "#58aee6");
    g.addColorStop(1, "#2a78bd");
    ctx.fillStyle = g;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    // A few short ripples.
    const rand = scatter(box.x * 17 + box.y * 3);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1.5 * px;
    ctx.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      const x = box.x + (0.15 + rand() * 0.7) * box.w;
      const y = box.y + (0.15 + rand() * 0.7) * box.h;
      const w = (0.06 + rand() * 0.08) * box.w;
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.quadraticCurveTo(x, y - 5 * px, x + w, y);
      ctx.stroke();
    }
    path(ctx, region.shape);
    ctx.lineWidth = 6 * px;
    ctx.strokeStyle = "rgba(18, 60, 100, 0.55)";
    ctx.stroke();
  } else if (surface === "slope") {
    // A slope is the same grass, lit from one side, with chevrons pointing the way a ball rolls.
    const [ax, ay] = region.slope ?? [0, 0];
    const len = Math.hypot(ax, ay) || 1;
    const ux = ax / len;
    const uy = ay / len;
    const g = ctx.createLinearGradient(box.x + box.w / 2 - (ux * box.w) / 2, box.y + box.h / 2 - (uy * box.h) / 2, box.x + box.w / 2 + (ux * box.w) / 2, box.y + box.h / 2 + (uy * box.h) / 2);
    g.addColorStop(0, "rgba(255, 255, 255, 0.2)");
    g.addColorStop(1, "rgba(0, 0, 0, 0.16)");
    ctx.fillStyle = g;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    const gap = Math.max(700, 30 * px);
    const size = Math.min(gap * 0.22, 9 * px);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 2 * px;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // As many as fit, spread evenly, so none is cut off at an edge.
    const across = Math.max(1, Math.floor(box.w / gap));
    const down = Math.max(1, Math.floor(box.h / gap));
    for (let j = 0; j < down; j++) {
      for (let i = 0; i < across; i++) {
        const x = box.x + ((i + 0.5) * box.w) / across;
        const y = box.y + ((j + 0.5) * box.h) / down;
        ctx.beginPath();
        ctx.moveTo(x - ux * size - uy * size, y - uy * size + ux * size);
        ctx.lineTo(x + ux * size, y + uy * size);
        ctx.lineTo(x - ux * size + uy * size, y - uy * size - ux * size);
        ctx.stroke();
      }
    }
  } else {
    ctx.fillStyle = GROUND[surface];
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  ctx.restore();
}

function drawDecor(ctx: CanvasRenderingContext2D, d: SportDecor, px: number) {
  const r = d.r ?? 350;
  const rand = scatter(d.x * 13 + d.y * 7);
  if (d.kind === "tee") {
    ctx.fillStyle = "rgba(20, 60, 36, 0.5)";
    ctx.beginPath();
    ctx.roundRect(d.x - 620, d.y - 330, 1240, 660, 160);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    for (const dx of [-470, 470]) {
      ctx.beginPath();
      ctx.arc(d.x + dx, d.y, Math.max(60, 2 * px), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (d.kind === "bush" || d.kind === "tree") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.beginPath();
    ctx.arc(d.x + r * 0.12, d.y + r * 0.16, r, 0, Math.PI * 2);
    ctx.fill();
    const blobs = d.kind === "tree" ? 9 : 5;
    for (let i = 0; i < blobs; i++) {
      const a = (i / blobs) * Math.PI * 2;
      const k = i === 0 ? 0 : 0.45;
      ctx.fillStyle = i % 2 ? "#2c7a41" : "#236636";
      ctx.beginPath();
      ctx.arc(d.x + Math.cos(a) * r * k, d.y + Math.sin(a) * r * k, r * (0.55 + rand() * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
    ctx.beginPath();
    ctx.arc(d.x - r * 0.25, d.y - r * 0.3, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (d.kind === "flowers") {
    const colours = ["#f6d24a", "#f28bb3", "#fbf6ec", "#f0703c"];
    for (let i = 0; i < 6; i++) {
      const x = d.x + (rand() - 0.5) * 700;
      const y = d.y + (rand() - 0.5) * 700;
      const size = Math.max(85, 2.6 * px);
      ctx.fillStyle = colours[i % colours.length]!;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8a5a14";
      ctx.beginPath();
      ctx.arc(x, y, size * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (d.kind === "rock") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.beginPath();
    ctx.ellipse(d.x + r * 0.1, d.y + r * 0.15, r, r * 0.75, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9a9a94";
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, r, r * 0.72, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c2c2bb";
    ctx.beginPath();
    ctx.ellipse(d.x - r * 0.22, d.y - r * 0.2, r * 0.45, r * 0.28, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDisc(ctx: CanvasRenderingContext2D, d: Disc, px: number) {
  const [fill, shade, ink] = TONES[d.look?.tone ?? "white"];
  const k = 1 - 0.75 * (d.sunk ?? 0);
  // Never smaller than a few pixels, however far out the screen is zoomed.
  const r = Math.max(d.r, 4.5 * px) * k;
  ctx.save();
  ctx.globalAlpha = (d.ghost ? 0.6 : 1) * (1 - 0.6 * (d.sunk ?? 0));
  if (!d.sunk) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.beginPath();
    ctx.ellipse(d.x + r * 0.22, d.y + r * 0.3, r, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(d.x - r * 0.35, d.y - r * 0.4, r * 0.1, d.x, d.y, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.25, fill);
  g.addColorStop(1, shade);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1 * px;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.stroke();
  if (d.look?.striped) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#fdfdf8";
    ctx.fillRect(d.x - r, d.y - r, 2 * r, r * 0.55);
    ctx.fillRect(d.x - r, d.y + r * 0.45, 2 * r, r * 0.55);
    ctx.restore();
  }
  if (d.look?.mark && r > 7 * px) {
    ctx.fillStyle = ink;
    ctx.font = `700 ${r * 1.05}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(d.look.mark, d.x, d.y + r * 0.06);
  }
  if (d.mine) {
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = "#ffe08a";
    ctx.beginPath();
    ctx.arc(d.x, d.y, r + 3.5 * px, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Green to amber to red as the power climbs. */
export function powerColour(power: number): string {
  const hue = 130 - 130 * Math.min(1, Math.max(0, power));
  return `hsl(${hue} 85% 55%)`;
}

function drawAim(ctx: CanvasRenderingContext2D, a: Aim, px: number) {
  const ux = Math.cos(a.angle);
  const uy = Math.sin(a.angle);
  const r = Math.max(a.r, 4.5 * px);
  const reach = (26 + 120 * a.power) * px;
  const colour = a.cancel ? "rgba(255, 255, 255, 0.45)" : powerColour(a.power);
  ctx.save();
  ctx.lineCap = "round";
  // Where it will go: a dotted line that grows with the power, ending in an arrowhead.
  const x0 = a.x + ux * (r + 4 * px);
  const y0 = a.y + uy * (r + 4 * px);
  const x1 = a.x + ux * (r + reach);
  const y1 = a.y + uy * (r + reach);
  for (const [width, style] of [[5 * px, "rgba(0, 0, 0, 0.35)"], [3 * px, a.pulling ? "#ffffff" : "rgba(255, 255, 255, 0.8)"]] as const) {
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.setLineDash([1 * px, 8 * px]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const head = 8 * px;
  ctx.fillStyle = a.pulling ? "#ffffff" : "rgba(255, 255, 255, 0.85)";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
  ctx.lineWidth = 1 * px;
  ctx.beginPath();
  ctx.moveTo(x1 + ux * head, y1 + uy * head);
  ctx.lineTo(x1 - ux * head * 0.4 - uy * head * 0.7, y1 - uy * head * 0.4 + ux * head * 0.7);
  ctx.lineTo(x1 - ux * head * 0.4 + uy * head * 0.7, y1 - uy * head * 0.4 - ux * head * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (a.pulling) {
    // The pull itself: a band from the ball back towards the thumb, thicker and redder the further it goes.
    const back = (10 + 70 * a.power) * px;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 7 * px;
    ctx.beginPath();
    ctx.moveTo(a.x - ux * r, a.y - uy * r);
    ctx.lineTo(a.x - ux * (r + back), a.y - uy * (r + back));
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 4.5 * px;
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(a.x - ux * (r + back), a.y - uy * (r + back), 5.5 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.lineWidth = 1 * px;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draws the whole scene. `width` and `height` are the canvas's size in CSS pixels and `dpr` how
 * many device pixels each is, so lines stay crisp on a dense screen.
 */
export function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, fit: Fit, scene: Scene) {
  const { world, look } = scene.table;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  ctx.setTransform(dpr * fit.scale, 0, 0, dpr * fit.scale, dpr * fit.ox, dpr * fit.oy);
  /** One CSS pixel, in world units: line widths are given in these so they don't thin out on a small screen. */
  const px = 1 / fit.scale;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const blocks = new Set(look.blocks);

  // Scenery under everything, then a soft shadow the table sits on.
  for (const d of look.decor) if (d.kind !== "tee") drawDecor(ctx, d, px);
  for (const g of look.ground) {
    ctx.save();
    ctx.translate(3 * px, 5 * px);
    path(ctx, g);
    ctx.lineWidth = 12 * px;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
    ctx.stroke();
    ctx.restore();
  }

  // The rails. A wall has no thickness and a ball's edge stops on it, so the rail is drawn
  // centred on the wall and then the ground is painted over its inner half: what's left is a
  // border lying outside the line the ball touches.
  for (const wall of world.walls) {
    if (blocks.has(wall.id)) continue;
    path(ctx, wall, wall.closed === true);
    ctx.lineWidth = 14 * px;
    ctx.strokeStyle = "#5b3d22";
    ctx.stroke();
    ctx.lineWidth = 10 * px;
    ctx.strokeStyle = "#e9dcc3";
    ctx.stroke();
  }

  for (const g of look.ground) {
    ctx.save();
    path(ctx, g);
    ctx.fillStyle = GROUND[g.surface];
    ctx.fill();
    ctx.clip();
    if (g.surface === "green") {
      // Mowing stripes.
      const box = boxOf(g);
      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      for (let y = Math.floor(box.y / 2000) * 2000; y < box.y + box.h; y += 2000) ctx.fillRect(box.x, y, box.w, 1000);
    }
    for (const r of look.regions) drawRegion(ctx, world, r.id, r.surface, px);
    for (const d of look.decor) if (d.kind === "tee") drawDecor(ctx, d, px);
    // A thin dark line where the green meets the rail.
    path(ctx, g);
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.stroke();
    ctx.restore();
  }

  // Things standing on the table.
  for (const wall of world.walls) {
    if (!blocks.has(wall.id)) continue;
    ctx.save();
    ctx.translate(2 * px, 3 * px);
    path(ctx, wall);
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fill();
    ctx.restore();
    path(ctx, wall);
    ctx.fillStyle = "#b9824c";
    ctx.fill();
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = "#5b3d22";
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = 5 * px;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.stroke();
    ctx.restore();
  }

  for (const p of world.pockets) {
    const g = ctx.createRadialGradient(p.x, p.y - p.r * 0.25, p.r * 0.1, p.x, p.y, p.r);
    g.addColorStop(0, "#0b0a09");
    g.addColorStop(1, "#2b2622");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = look.pockets === "cup" ? "rgba(255, 255, 255, 0.75)" : "rgba(0, 0, 0, 0.6)";
    ctx.stroke();
  }

  if (scene.trace && scene.trace.length > 1) {
    ctx.save();
    ctx.setLineDash([2 * px, 6 * px]);
    ctx.lineWidth = 2.5 * px;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    path(ctx, { points: scene.trace }, false);
    ctx.stroke();
    ctx.restore();
  }

  for (const s of scene.splashes) {
    ctx.save();
    ctx.globalAlpha = 1 - s.t;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 * px;
    for (const k of [1, 0.55]) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, (6 + 22 * s.t) * px * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Ghosts under the real thing, and whatever is yours on top.
  const layer = (d: Disc) => (d.ghost ? 0 : d.mine ? 2 : 1);
  for (const d of [...scene.discs].sort((a, b) => layer(a) - layer(b))) drawDisc(ctx, d, px);

  // The flag stands in the cup, over the balls, so the hole can be found from across the green.
  if (look.pockets === "cup") {
    for (const p of world.pockets) {
      const tall = Math.max(1500, 44 * px);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
      ctx.lineWidth = 3.5 * px;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - tall);
      ctx.stroke();
      ctx.strokeStyle = "#fbf6ec";
      ctx.lineWidth = 2 * px;
      ctx.stroke();
      ctx.fillStyle = "#e0453a";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - tall);
      ctx.lineTo(p.x + tall * 0.42, p.y - tall * 0.84);
      ctx.lineTo(p.x, p.y - tall * 0.68);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  if (scene.aim) drawAim(ctx, scene.aim, px);
}
