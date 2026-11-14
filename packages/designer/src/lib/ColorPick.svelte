<!--
  One colour of a deck: zubra-ui's <color-swatches> for the ones that usually look good, and the
  browser's own colour picker for anything else. A colour that isn't one of the swatches (from a
  remixed deck, or the picker) is shown as an extra swatch, so the choice is always visible.
-->
<script lang="ts">
  interface Props {
    label: string;
    value: string;
    /** [colour, its name] pairs. */
    palette: [string, string][];
    onchange: (color: string) => void;
  }
  let { label, value, palette, onchange }: Props = $props();

  const known = $derived(palette.some(([color]) => color === value));
  const colors = $derived([...palette.map(([color]) => color), ...(known ? [] : [value])]);
  const names = $derived([...palette.map(([, name]) => name), ...(known ? [] : ["Your own colour"])]);
  const id = $props.id();
</script>

<div class="pick">
  <span class="label" id="{id}-label">{label}</span>
  <div class="row">
    <color-swatches {value} {colors} {names} {label} onvaluechange={(event: CustomEvent<string>) => onchange(event.detail)}></color-swatches>
    <label class="own">
      <span class="sr">{label}: your own colour</span>
      <input type="color" {value} oninput={(event) => onchange(event.currentTarget.value)} />
    </label>
  </div>
</div>

<style>
  .pick { display: grid; gap: 0.4rem; }
  .label { font-size: 0.9rem; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 0.6rem; }
  .own { flex: none; display: inline-flex; }
  .own input { width: 2.25rem; height: 1.9rem; padding: 0; border: 1px solid var(--border); border-radius: 0.4rem; background: var(--card); cursor: pointer; }
  .own input:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  /* The swatches are a little small for a thumb. */
  .pick :global(color-swatches button) { width: 2rem; height: 2rem; }
  /* A hairline, so ivory on a white page is still a swatch. */
  .pick :global(color-swatches button) { box-shadow: inset 0 0 0 2px var(--card), 0 0 0 1px var(--border); }
</style>
