<!--
  The Card Room's front door: every game as a tile, a "who's playing?" filter, and your houses.
  A Vue island inside the React app. The cards and the select are Zubra components: in a .vue file a
  .zb import is a Vue component (Zubra's Vue adapter), with props, events and v-model.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import PlayingCard from "@spades/ui/playing-card.zb";
import SelectField from "@spades/ui/zubra-ui/select-field.zb";

export interface ChooserGame {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  seats: [number, number];
  teams: boolean;
  /** Three cards to fan out on the tile. */
  fan: Record<string, unknown>[];
}

const props = defineProps<{
  games: ChooserGame[];
  houses: { slug: string; name: string }[];
  /** The game played last on this device, if any. */
  last: string | null;
  name: string;
}>();
const emit = defineEmits<{ pick: [id: string]; house: [slug: string] }>();

// Who's playing: any number, or exactly this many people at the table.
const players = ref("any");
const sizes = [
  { value: "any", label: "Any number" },
  { value: "2", label: "Just two of us" },
  { value: "3", label: "Three" },
  { value: "4", label: "Four" },
  { value: "5", label: "Five or more" },
];
const fits = (g: ChooserGame) => {
  if (players.value === "any") return true;
  const n = Number(players.value);
  return n >= 5 ? g.seats[1] >= 5 : g.seats[0] <= n && n <= g.seats[1];
};
const shown = computed(() => props.games.filter(fits));
const seatsLabel = (g: ChooserGame) => (g.teams ? "4 players · partners" : g.seats[0] === g.seats[1] ? `${g.seats[0]} players` : `${g.seats[0]}–${g.seats[1]} players`);
const hello = computed(() => (props.name ? `Welcome back, ${props.name}.` : "Spades, Palace, Hearts and more, with the family."));
</script>

<template>
  <div class="chooser">
    <header class="hero">
      <div class="suits" aria-hidden="true">♠&#xFE0E; ♥&#xFE0E; ♣&#xFE0E; ♦&#xFE0E;</div>
      <h1>Card Room</h1>
      <p>{{ hello }}</p>
    </header>

    <section v-if="houses.length" class="houses" aria-label="Your houses">
      <h2>Your houses</h2>
      <ul>
        <li v-for="h in houses" :key="h.slug">
          <button type="button" class="house" @click="emit('house', h.slug)">
            <span aria-hidden="true">🏠</span> {{ h.name }}
          </button>
        </li>
      </ul>
    </section>

    <section class="games" aria-label="Games">
      <div class="games-head">
        <h2>Pick a game</h2>
        <div class="filter">
          <SelectField v-model="players" label="Who's playing?" :options="sizes" />
        </div>
      </div>
      <ul class="grid">
        <li v-for="g in shown" :key="g.id">
          <button type="button" class="tile" :class="{ last: g.id === last }" :aria-label="`${g.name}: ${g.blurb}, ${seatsLabel(g)}`" @click="emit('pick', g.id)">
            <span class="fan" aria-hidden="true">
              <PlayingCard v-for="(c, i) in g.fan" :key="i" class="fan-card" :style="{ '--i': i }" :card="c" size="table" />
            </span>
            <span class="emoji" aria-hidden="true">{{ g.emoji }}</span>
            <strong>{{ g.name }}</strong>
            <span class="blurb">{{ g.blurb }}</span>
            <span class="chips">
              <span class="chip">{{ seatsLabel(g) }}</span>
              <span v-if="g.id === last" class="chip gold">Last played</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-if="!shown.length" class="none">No games for that many players yet.</p>
    </section>

    <p class="fine">Pick a game to practice against the computer, start a family table, or take on a challenger.</p>
  </div>
</template>

<style scoped>
.chooser {
  --tile-card: clamp(46px, 7vw, 66px);
  max-width: 1120px;
  margin: 0 auto;
  padding: max(28px, env(safe-area-inset-top)) clamp(16px, 4vw, 48px) 48px;
  display: flex;
  flex-direction: column;
  gap: clamp(20px, 3vw, 36px);
  color: var(--cream);
}
.hero { text-align: center; padding-top: clamp(8px, 4vh, 48px); }
.hero h1 { margin: 6px 0 0; font-size: clamp(2.8rem, 7vw, 5.2rem); letter-spacing: -0.02em; text-shadow: 0 4px 24px rgba(0, 0, 0, 0.35); }
.hero p { margin: 8px 0 0; font-size: clamp(1.05rem, 1.6vw, 1.3rem); font-style: italic; color: #d6e6dc; }
.suits { letter-spacing: 0.5em; color: var(--gold); font-size: clamp(1rem, 1.6vw, 1.3rem); }
h2 { margin: 0; font-size: clamp(1.3rem, 2vw, 1.7rem); color: var(--gold); }

.houses ul { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; }
.house {
  border: 2px solid rgba(232, 196, 106, 0.6); border-radius: 999px; background: rgba(0, 0, 0, 0.25);
  color: var(--cream); font: inherit; font-weight: 600; padding: 10px 18px; cursor: pointer;
}
.house:hover, .house:focus-visible { border-color: var(--gold); background: rgba(232, 196, 106, 0.14); }

.games-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.filter { min-width: 220px; --background: var(--cream); --foreground: var(--ink); --border: rgba(255, 255, 255, 0.18); --muted-foreground: #cfe2d6; --ring: var(--gold); }
.grid { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: clamp(12px, 1.6vw, 20px); grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); }
@media (max-width: 560px) { .grid { grid-template-columns: 1fr 1fr; } }

.tile {
  position: relative; width: 100%; height: 100%; min-height: clamp(150px, 18vw, 200px);
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left;
  padding: clamp(14px, 1.8vw, 22px); padding-right: calc(var(--tile-card) * 1.9);
  border: 2px solid rgba(255, 255, 255, 0.12); border-radius: 18px; cursor: pointer;
  background: radial-gradient(ellipse at 85% 20%, rgba(255, 255, 255, 0.08), transparent 60%), rgba(0, 0, 0, 0.24);
  color: var(--cream); font: inherit; overflow: hidden;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  transition: transform 160ms var(--ease-out, ease-out), box-shadow 160ms, border-color 160ms;
}
.tile.last { border-color: rgba(232, 196, 106, 0.55); }
.tile:hover, .tile:focus-visible { transform: translateY(-4px); box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35); border-color: var(--gold); outline: none; }
.emoji { font-size: clamp(1.6rem, 2.6vw, 2.2rem); line-height: 1; }
.tile strong { font-family: Georgia, "Times New Roman", serif; font-size: clamp(1.25rem, 1.9vw, 1.6rem); margin-top: 6px; }
.blurb { color: #d6e6dc; font-size: clamp(0.85rem, 1.1vw, 1rem); line-height: 1.3; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 10px; }
.chip { font-size: 0.78rem; padding: 2px 10px; border-radius: 999px; background: rgba(0, 0, 0, 0.3); color: #e3efe7; white-space: nowrap; }
.chip.gold { background: rgba(232, 196, 106, 0.2); color: #ffe7a6; }

/* A little fan of cards in the corner; it opens up when you point at the tile. */
.fan { position: absolute; right: calc(var(--tile-card) * 0.35); top: 50%; translate: 0 -50%; width: calc(var(--tile-card) * 1.3); height: calc(var(--tile-card) * 1.5); --trick-w: var(--tile-card); --trick-h: calc(var(--tile-card) * 1.4); }
.fan-card { position: absolute; left: 0; top: 0; transform-origin: 50% 120%; rotate: calc((var(--i) - 1) * 9deg); translate: calc(var(--i) * var(--tile-card) * 0.16) 0; transition: rotate 220ms var(--ease-back, ease-out), translate 220ms var(--ease-back, ease-out); }
.tile:hover .fan-card, .tile:focus-visible .fan-card { rotate: calc((var(--i) - 1) * 16deg); translate: calc(var(--i) * var(--tile-card) * 0.22) -4px; }
@media (max-width: 560px) {
  .tile { padding-right: clamp(14px, 1.8vw, 22px); padding-top: calc(var(--tile-card) * 1.2); }
  .fan { top: 14px; right: 14px; translate: none; --tile-card: 34px; }
  .emoji { display: none; }
}
@media (prefers-reduced-motion: reduce) { .tile, .fan-card { transition: none; } }
.none, .fine { text-align: center; color: #b9d0c2; margin: 0; }
</style>
