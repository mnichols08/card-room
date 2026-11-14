<!--
  A deck at a glance, on a strip of felt: its back and two faces (the queen of diamonds shows a
  four-colour deck's blue). The cards are the card room's own <playing-card>, wearing the design
  through the CSS variables set on the strip.
-->
<script lang="ts">
  import { deckStyle, type CardDesign } from "@cardroom/decks";
  import type { SampleCard } from "./cards";

  let { design }: { design: CardDesign } = $props();
  const faces: SampleCard[] = [
    { kind: "pip", suit: "spades", rank: 14 },
    { kind: "pip", suit: "diamonds", rank: 12 },
  ];
</script>

<div class="strip" style={deckStyle(design)} role="img" aria-label="The deck “{design.name}”: its back, the ace of spades and the queen of diamonds">
  <playing-card back={true} size="table"></playing-card>
  {#each faces as card, i (i)}
    <playing-card {card} size="table"></playing-card>
  {/each}
</div>

<style>
  .strip { display: flex; justify-content: center; gap: 0.6rem; padding: 1.25rem 1rem; background: linear-gradient(160deg, var(--felt-light), var(--felt-dark)); }
</style>
