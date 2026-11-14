<!--
  The card designer: draw a deck (its back, paper, inks and lettering), then keep it for yourself
  or share it with everyone in the card room. "Play with it" makes it the deck this browser sees at
  every table.

  The page is Svelte; everything on it is a Zubra component (see zubra.ts): zubra-ui's tabs, fields,
  swatches, switches, sliders, cards, dialogs and toasts, and the card room's own <playing-card>.
  They're custom elements, so Svelte sets their properties and listens to their events directly.
-->
<script lang="ts">
  import { BACK_PATTERNS, CLASSIC, CORNERS, EMBLEMS, FACE_FONTS, STARTERS, deckStyle, normalizeDesign, saveDeck, savedDeck, validateDesign, type CardDesign } from "@cardroom/decks";
  import { onMount } from "svelte";
  import ColorPick from "./lib/ColorPick.svelte";
  import DeckPreview from "./lib/DeckPreview.svelte";
  import { StoreError, gallery, hasServer, mine, rememberedAuthor, remove, save, share, type SavedDesign } from "./lib/store";

  type Tab = "design" | "mine" | "gallery";
  const tabs = [
    { value: "design", label: "Design" },
    { value: "mine", label: "My decks" },
    { value: "gallery", label: "Gallery" },
  ];

  const fresh = (): CardDesign => ({ ...structuredClone(CLASSIC), name: "My deck" });
  const same = (a: CardDesign | null, b: CardDesign) => !!a && JSON.stringify(normalizeDesign(a)) === JSON.stringify(normalizeDesign(b));

  let tab = $state<Tab>("design");
  let design = $state<CardDesign>(fresh());
  /** The saved deck being changed, or null for a new one. */
  let editing = $state<SavedDesign | null>(null);
  let author = $state(rememberedAuthor());
  let shareIt = $state(false);
  let saving = $state(false);

  /** Null until we know whether a card room server is behind the page. */
  let online = $state<boolean | null>(null);
  let myDecks = $state<SavedDesign[]>([]);
  let shared = $state<SavedDesign[]>([]);
  let loadError = $state("");

  /** The deck this browser plays with, or null for the card room's own. */
  let playing = $state<CardDesign | null>(savedDeck());
  let previewSize = $state(150);
  let flipped = $state(false);

  let deleting = $state<SavedDesign | null>(null);
  let deleteOpen = $state(false);

  const problems = $derived(validateDesign(normalizeDesign(design)));
  const style = $derived(deckStyle(design));

  // The cards under the big one: a court card of each colour, a ten, a seven and a joker.
  const hand = [
    { kind: "pip", suit: "hearts", rank: 13 },
    { kind: "pip", suit: "diamonds", rank: 12 },
    { kind: "pip", suit: "clubs", rank: 11 },
    { kind: "pip", suit: "spades", rank: 10 },
    { kind: "pip", suit: "diamonds", rank: 7 },
    { kind: "joker", size: "big" },
  ];
  const ace = { kind: "pip", suit: "spades", rank: 14 };

  const title = (word: string) => word[0]!.toUpperCase() + word.slice(1);
  const starters = STARTERS.map((s) => ({ value: s.name, label: s.name }));
  const patterns = BACK_PATTERNS.map((p) => ({ value: p, label: title(p) }));
  const emblems = EMBLEMS.map((e) => ({ value: e, label: e === "none" ? "None" : `${e}︎` }));
  const fonts = FACE_FONTS.map((f) => ({ value: f, label: { classic: "Classic", serif: "Book", rounded: "Rounded", slab: "Typewriter", mono: "Scoreboard" }[f] }));
  const corners = CORNERS.map((c) => ({ value: c, label: { sharp: "Sharp", soft: "Soft", round: "Round" }[c] }));

  const BACKS: [string, string][] = [["#7a1f2b", "Burgundy"], ["#1f4d3a", "Felt green"], ["#16233f", "Navy"], ["#1f3f8f", "Royal blue"], ["#0f5c63", "Teal"], ["#1e5a34", "Holly"], ["#4a2545", "Plum"], ["#9a3f1d", "Rust"], ["#2b2b2b", "Charcoal"]];
  const ACCENTS: [string, string][] = [["#e8c46a", "Gold"], ["#f0d58c", "Pale gold"], ["#fffdf8", "Ivory"], ["#c9d3e6", "Silver"], ["#f2b5b5", "Rose"], ["#b8e0c8", "Mint"], ["#a9c7ff", "Sky"], ["#d9905a", "Copper"]];
  const BORDERS: [string, string][] = [["#fffdf8", "Ivory"], ["#f4f6fb", "Cool white"], ["#fff8e7", "Warm white"], ["#f2efe6", "Newsprint"], ["#e8c46a", "Gold"], ["#1d1a16", "Black"]];
  const PAPERS: [string, string][] = [["#fbf7ee", "Cream"], ["#fffdf8", "Ivory"], ["#f6f8fc", "Cool white"], ["#fff8e7", "Warm white"], ["#f2efe6", "Newsprint"], ["#eef5ee", "Mint"], ["#fdf1f1", "Blush"]];
  const BLACKS: [string, string][] = [["#1d1a16", "Black"], ["#111111", "Jet"], ["#141a2b", "Ink blue"], ["#1c2a20", "Forest"], ["#3a2a1a", "Sepia"], ["#2b2140", "Aubergine"]];
  const REDS: [string, string][] = [["#b3261e", "Red"], ["#a8243a", "Crimson"], ["#b01224", "Cherry"], ["#9b1c1c", "Brick"], ["#c2410c", "Burnt orange"], ["#a21caf", "Magenta"]];
  const CLUBS: [string, string][] = [["#1b6e3c", "Green"], ["#0f5c63", "Teal"], ["#5b3a8c", "Purple"], ["#6b4b12", "Olive"]];
  const DIAMONDS: [string, string][] = [["#1d5fb8", "Blue"], ["#0e7490", "Sea blue"], ["#b45309", "Amber"], ["#7c3aed", "Violet"]];

  /** A Zubra component's event carries its news in `detail`. */
  type News<T> = CustomEvent<T>;

  /** zubra-ui's <toast-region> listens on the document: any code shows a toast with an event. */
  function toast(message: string, variant: "success" | "danger" | "info" = "info") {
    document.dispatchEvent(new CustomEvent("toast", { detail: { message, variant } }));
  }
  const say = (error: unknown) => toast(error instanceof StoreError ? error.message : "Something went wrong. Try again.", "danger");

  async function load() {
    try {
      online = await hasServer();
      [myDecks, shared] = await Promise.all([mine(), gallery()]);
      loadError = "";
    } catch (error) {
      loadError = error instanceof StoreError ? error.message : "Couldn't load the decks.";
    }
  }

  onMount(() => {
    void load();
    // Another tab (the card room itself, say) changed the deck this browser plays with.
    const follow = () => (playing = savedDeck());
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  });

  function startFrom(name: string) {
    const starter = STARTERS.find((s) => s.name === name);
    if (starter) design = { ...structuredClone(starter), name: editing ? design.name : starter.name === "Classic" ? "My deck" : `My ${starter.name.toLowerCase()}` };
  }

  function startOver() {
    design = fresh();
    editing = null;
    shareIt = false;
    flipped = false;
  }

  function edit(saved: SavedDesign) {
    design = structuredClone($state.snapshot(saved.design));
    editing = saved;
    shareIt = saved.shared;
    tab = "design";
    scrollTo({ top: 0 });
  }

  function remix(saved: SavedDesign) {
    design = { ...structuredClone($state.snapshot(saved.design)), name: `${saved.design.name} remix`.slice(0, 30) };
    editing = null;
    shareIt = false;
    tab = "design";
    scrollTo({ top: 0 });
    toast(`Started a new deck from “${saved.design.name}”.`);
  }

  async function saveIt(event?: Event) {
    event?.preventDefault();
    if (saving || problems.length) return;
    saving = true;
    try {
      const saved = await save($state.snapshot(design), author.trim(), shareIt && !!online, editing?.id);
      editing = saved;
      toast(saved.shared ? `“${saved.design.name}” is saved and in the gallery.` : `“${saved.design.name}” is saved in My decks.`, "success");
      await load();
    } catch (error) {
      say(error);
    } finally {
      saving = false;
    }
  }

  function playWith(deck: CardDesign) {
    const chosen = normalizeDesign($state.snapshot(deck));
    saveDeck(chosen);
    playing = chosen;
    toast(`You're playing with “${chosen.name}” on this device.`, "success");
  }

  function stopPlaying() {
    saveDeck(null);
    playing = null;
    toast("Back to the card room's own deck.");
  }

  async function setShared(saved: SavedDesign, on: boolean) {
    try {
      await share(saved.id, on);
      toast(on ? `“${saved.design.name}” is in the gallery.` : `“${saved.design.name}” is yours alone again.`, "success");
      if (editing?.id === saved.id) shareIt = on;
      await load();
    } catch (error) {
      say(error);
    }
  }

  function askDelete(saved: SavedDesign) {
    deleting = saved;
    deleteOpen = true;
  }

  async function deleteIt() {
    const gone = deleting;
    if (!gone) return;
    try {
      await remove(gone.id);
      deleteOpen = false;
      if (editing?.id === gone.id) editing = null;
      toast(`Deleted “${gone.design.name}”.`, "success");
      await load();
    } catch (error) {
      say(error);
    }
  }
</script>

<toast-region position="bottom-end" label="Notifications"></toast-region>

<div class="page">
  <header class="top">
    <div>
      <a class="home" href="../"><span aria-hidden="true">←</span> Card Room</a>
      <h1>Card designer</h1>
      <p class="quiet">Draw your own deck. Keep it for yourself, or share it with everyone here.</p>
    </div>
    <div class="now" aria-live="polite">
      {#if playing}
        <span>Playing with <strong>{playing.name}</strong></span>
        <action-button variant="link" size="sm" onclick={stopPlaying}>Use the card room's deck</action-button>
      {:else}
        <span>Playing with the card room's own deck</span>
      {/if}
    </div>
  </header>

  {#if online === false}
    <alert-banner variant="info" heading="Decks stay on this device here">
      <span>This copy of the card room has no server behind it, so there's no gallery to share to. You can still design decks and play with them.</span>
    </alert-banner>
  {/if}
  {#if loadError}
    <alert-banner variant="danger" heading="Couldn't load the decks"><span>{loadError}</span></alert-banner>
  {/if}

  <tab-list {tabs} value={tab} label="Card designer" onvaluechange={(event: News<Tab>) => (tab = event.detail)}>
    <!-- Design -->
    <section data-tab="design">
      <div class="bench">
        <div class="stage" {style} style:--card-w="{previewSize}px" style:--card-h="{previewSize * 1.4}px">
          <flip-card {flipped} hint="Tap the card to turn it over" onflippedchange={(event: News<boolean>) => (flipped = event.detail)}>
            <div slot="front" class="face"><playing-card card={ace} size="hand"></playing-card></div>
            <div slot="back" class="face"><playing-card back={true} size="hand"></playing-card></div>
          </flip-card>
          <div class="hand" role="img" aria-label="More cards from this deck">
            {#each hand as card, i (i)}
              <playing-card {card} size="table"></playing-card>
            {/each}
            <playing-card back={true} size="table"></playing-card>
          </div>
          <range-slider value={previewSize} min={100} max={220} step={10} label="Card size" unit="px" onvaluechange={(event: News<number>) => (previewSize = event.detail)}></range-slider>
        </div>

        <form class="controls" onsubmit={saveIt} novalidate>
          {#if editing}
            <alert-banner variant="info" heading="Changing “{editing.design.name}”">
              <span>Saving updates this deck{editing.shared ? " in the gallery too" : ""}.</span>
              <action-button slot="actions" variant="outline" size="sm" onclick={startOver}>Start a new deck instead</action-button>
            </alert-banner>
          {/if}

          <fieldset>
            <legend>The deck</legend>
            <text-field label="Name" value={design.name} maxlength={30} required={true} onvaluechange={(event: News<string>) => (design.name = event.detail)}></text-field>
            <select-field label="Start from" description="Picks every colour and choice below; change what you like after." placeholder="Choose a starting point" value="" options={starters} onvaluechange={(event: News<string>) => startFrom(event.detail)}></select-field>
          </fieldset>

          <fieldset>
            <legend>The back</legend>
            <select-field label="Pattern" value={design.back.pattern} options={patterns} onvaluechange={(event: News<CardDesign["back"]["pattern"]>) => (design.back.pattern = event.detail)}></select-field>
            <ColorPick label="Colour" value={design.back.color} palette={BACKS} onchange={(c) => (design.back.color = c)} />
            <ColorPick label="Pattern and medallion" value={design.back.accent} palette={ACCENTS} onchange={(c) => (design.back.accent = c)} />
            <ColorPick label="Frame" value={design.back.border} palette={BORDERS} onchange={(c) => (design.back.border = c)} />
            <div class="group">
              <span class="label">Emblem</span>
              <segmented-control class="emblems" label="Emblem" value={design.back.emblem} options={emblems} onvaluechange={(event: News<CardDesign["back"]["emblem"]>) => (design.back.emblem = event.detail)}></segmented-control>
            </div>
          </fieldset>

          <fieldset>
            <legend>The faces</legend>
            <ColorPick label="Paper" value={design.face.paper} palette={PAPERS} onchange={(c) => (design.face.paper = c)} />
            <ColorPick label={design.face.fourColor ? "Spades" : "Spades and clubs"} value={design.face.black} palette={BLACKS} onchange={(c) => (design.face.black = c)} />
            <ColorPick label={design.face.fourColor ? "Hearts" : "Hearts and diamonds"} value={design.face.red} palette={REDS} onchange={(c) => (design.face.red = c)} />
            <toggle-switch label="Four-colour deck" description="Clubs and diamonds get colours of their own, so suits are easier to tell apart." checked={design.face.fourColor} oncheckedchange={(event: News<boolean>) => (design.face.fourColor = event.detail)}></toggle-switch>
            {#if design.face.fourColor}
              <ColorPick label="Clubs" value={design.face.clubs} palette={CLUBS} onchange={(c) => (design.face.clubs = c)} />
              <ColorPick label="Diamonds" value={design.face.diamonds} palette={DIAMONDS} onchange={(c) => (design.face.diamonds = c)} />
            {/if}
            <select-field label="Lettering" value={design.face.font} options={fonts} onvaluechange={(event: News<CardDesign["face"]["font"]>) => (design.face.font = event.detail)}></select-field>
            <div class="group">
              <span class="label">Corners</span>
              <segmented-control label="Corners" value={design.corners} options={corners} onvaluechange={(event: News<CardDesign["corners"]>) => (design.corners = event.detail)}></segmented-control>
            </div>
          </fieldset>

          {#if problems.length}
            <alert-banner variant="warning" heading="This deck would be hard to play with">
              <ul class="problems">
                {#each problems as problem (problem)}
                  <li>{problem}</li>
                {/each}
              </ul>
            </alert-banner>
          {/if}

          <fieldset>
            <legend>Keep it</legend>
            <text-field label="Your name" description="Shown on the deck when it's shared." value={author} maxlength={30} autocomplete="nickname" onvaluechange={(event: News<string>) => (author = event.detail)}></text-field>
            {#if online}
              <toggle-switch label="Share it in the gallery" description="Everyone in this card room can see it, play with it and remix it. Leave it off to keep the deck to yourself." checked={shareIt} oncheckedchange={(event: News<boolean>) => (shareIt = event.detail)}></toggle-switch>
            {/if}
            <cluster-layout gap="0.6rem">
              <action-button type="submit" loading={saving} disabled={problems.length > 0}><span>{editing ? "Save changes" : "Save deck"}</span></action-button>
              <action-button variant="outline" disabled={problems.length > 0 || same(playing, design)} onclick={() => playWith(design)}><span>{same(playing, design) ? "You're playing with it" : "Play with it"}</span></action-button>
            </cluster-layout>
          </fieldset>
        </form>
      </div>
    </section>

    <!-- My decks -->
    <section data-tab="mine">
      {#if online === null}
        <div class="waiting"><loading-spinner label="Loading your decks" inline={true}></loading-spinner></div>
      {:else if myDecks.length}
        <auto-grid min="16rem" gap="1rem">
          {#each myDecks as saved (saved.id)}
            <content-card heading={saved.design.name}>
              <div slot="media"><DeckPreview design={saved.design} /></div>
              <cluster-layout gap="0.4rem">
                {#if saved.hidden}
                  <status-badge variant="danger" dot={true}>Taken out of the gallery</status-badge>
                {:else if saved.shared}
                  <status-badge variant="success" dot={true}>In the gallery</status-badge>
                {:else}
                  <status-badge variant="neutral">Just yours</status-badge>
                {/if}
                {#if same(playing, saved.design)}
                  <status-badge variant="primary">Playing with it</status-badge>
                {/if}
              </cluster-layout>
              {#if saved.hidden}
                <p class="reason">The card room's host says: {saved.hidden}</p>
              {/if}
              <cluster-layout slot="footer" gap="0.4rem">
                <action-button size="sm" disabled={same(playing, saved.design)} onclick={() => playWith(saved.design)}>Play with it</action-button>
                <action-button variant="outline" size="sm" onclick={() => edit(saved)}>Change</action-button>
                {#if online && !saved.hidden}
                  <action-button variant="outline" size="sm" onclick={() => setShared(saved, !saved.shared)}><span>{saved.shared ? "Stop sharing" : "Share"}</span></action-button>
                {/if}
                <action-button variant="ghost" size="sm" label="Delete {saved.design.name}" onclick={() => askDelete(saved)}>Delete</action-button>
              </cluster-layout>
            </content-card>
          {/each}
        </auto-grid>
      {:else}
        <empty-state heading="No decks yet">
          <span>Decks you save show up here, whether you share them or keep them to yourself.</span>
          <action-button slot="actions" onclick={() => (tab = "design")}>Design a deck</action-button>
        </empty-state>
      {/if}
    </section>

    <!-- Gallery -->
    <section data-tab="gallery">
      <h2>Starters</h2>
      <p class="quiet">The card room's own decks. Play with one as it is, or remix it into yours.</p>
      <auto-grid min="16rem" gap="1rem">
        {#each STARTERS as starter (starter.name)}
          {@const card = { id: starter.name, author: "Card Room", design: starter, shared: true, created: 0, updated: 0, mine: false }}
          <content-card heading={starter.name}>
            <div slot="media"><DeckPreview design={starter} /></div>
            <cluster-layout slot="footer" gap="0.4rem">
              <action-button size="sm" disabled={same(playing, starter)} onclick={() => playWith(starter)}>Play with it</action-button>
              <action-button variant="outline" size="sm" onclick={() => remix(card)}>Remix</action-button>
            </cluster-layout>
          </content-card>
        {/each}
      </auto-grid>

      {#if online}
        <h2>Shared by players</h2>
        {#if shared.length}
          <auto-grid min="16rem" gap="1rem">
            {#each shared as saved (saved.id)}
              <content-card heading={saved.design.name}>
                <div slot="media"><DeckPreview design={saved.design} /></div>
                <span class="by">by {saved.author}{saved.mine ? " (you)" : ""}</span>
                <cluster-layout slot="footer" gap="0.4rem">
                  <action-button size="sm" disabled={same(playing, saved.design)} onclick={() => playWith(saved.design)}>Play with it</action-button>
                  <action-button variant="outline" size="sm" onclick={() => (saved.mine ? edit(saved) : remix(saved))}><span>{saved.mine ? "Change" : "Remix"}</span></action-button>
                </cluster-layout>
              </content-card>
            {/each}
          </auto-grid>
        {:else}
          <empty-state heading="Nobody's shared a deck yet">
            <span>Be the first: design one and turn on “Share it in the gallery”.</span>
            <action-button slot="actions" variant="outline" onclick={() => (tab = "design")}>Design a deck</action-button>
          </empty-state>
        {/if}
      {/if}
    </section>
  </tab-list>
</div>

<modal-dialog open={deleteOpen} label="Delete this deck?" onopenchange={(event: News<boolean>) => (deleteOpen = event.detail)}>
  <p>
    <span>“{deleting?.design.name ?? "This deck"}” will be gone for good{deleting?.shared ? ", from the gallery too" : ""}.</span>
    Anyone already playing with it keeps their copy.
  </p>
  <action-button slot="actions" variant="outline" data-close>Keep it</action-button>
  <action-button slot="actions" variant="destructive" onclick={deleteIt}>Delete deck</action-button>
</modal-dialog>

<style>
  .page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.25rem; width: min(72rem, 100%); margin: 0 auto; padding: 1.25rem clamp(1rem, 3vw, 2rem) 5rem; }
  .quiet { color: var(--muted-foreground); font-size: 0.925rem; }
  .top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 0.75rem 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
  .home { font-size: 0.9rem; color: var(--muted-foreground); text-decoration: none; }
  .home:hover { text-decoration: underline; }
  h1 { font-size: clamp(1.6rem, 4vw, 2rem); margin: 0.2rem 0; }
  h2 { font-size: 1.15rem; margin: 2rem 0 0.25rem; }
  h2:first-child { margin-top: 0; }
  h2 + .quiet { margin-bottom: 0.9rem; }
  h2 + :global(auto-grid), h2 + :global(empty-state) { margin-top: 0.9rem; }
  .now { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; font-size: 0.9rem; color: var(--muted-foreground); }
  .now strong { color: var(--foreground); }
  .waiting { display: grid; place-items: center; min-height: 30vh; }

  /* The workbench: the deck on its felt beside the controls; on a phone the felt comes first. */
  .bench { display: grid; gap: 1.5rem; grid-template-columns: minmax(0, 1fr); align-items: start; }
  @media (min-width: 56rem) {
    .bench { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 2rem; }
    .stage { position: sticky; top: 1rem; }
  }
  .stage {
    display: grid; gap: 1.1rem; justify-items: center; padding: 1.5rem 1rem 1.25rem;
    border-radius: calc(var(--radius) * 2);
    background: radial-gradient(120% 90% at 50% 0%, var(--felt-light), var(--felt-dark));
    color: #fbf6ec;
    /* The controls on the felt (the slider, the flip hint) read in its cream. */
    --foreground: #fbf6ec; --muted-foreground: #d9e4dc; --muted: rgb(255 255 255 / 0.18); --border: rgb(255 255 255 / 0.25);
    --card-front: transparent; --card-back: transparent; --card-foreground: #fbf6ec;
  }
  .stage :global(flip-card) { width: 100%; }
  .face { display: grid; place-items: center; }
  /* A card that isn't in play is a disabled button, which swallows clicks: let them through to the flip card. */
  .face :global(playing-card) { pointer-events: none; }
  .hand { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.4rem; --trick-w: clamp(40px, 11vw, 54px); --trick-h: calc(var(--trick-w) * 1.4); }
  .stage :global(range-slider) { width: min(18rem, 100%); }

  .controls { display: grid; gap: 1.25rem; }
  fieldset { display: grid; gap: 1rem; min-width: 0; margin: 0; padding: 1.1rem 1.2rem 1.25rem; border: 1px solid var(--border); border-radius: calc(var(--radius) * 1.4); background: var(--card); }
  legend { padding: 0 0.4rem; font-family: Georgia, "Times New Roman", serif; font-size: 1.05rem; font-weight: 600; }
  .group { display: grid; gap: 0.4rem; justify-items: start; }
  .label { font-size: 0.9rem; font-weight: 600; }
  .controls :global(.emblems button) { min-width: 2.4rem; font-size: 1.05rem; font-variant-emoji: text; }
  .problems { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.25rem; }

  .by { font-size: 0.875rem; }
  .reason { margin-top: 0.6rem; font-size: 0.875rem; font-style: italic; }
</style>
