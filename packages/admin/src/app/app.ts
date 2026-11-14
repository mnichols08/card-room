// The card room's admin app: its host sees every table and everyone at them, and can close a table,
// take someone out of a seat, remove a chat message, block a player and hide a shared card design.
//
// The page is Angular; everything on it is a Zubra component (see zubra.ts): zubra-ui's tabs, data
// tables, dialogs, stat cards, badges, buttons, fields and toasts, and the card room's own
// <playing-card> for previewing designs.
import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, computed, effect, signal, type OnDestroy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { deckStyle, type CardDesign } from "@cardroom/decks";
import { ZubraModel } from "@zubra/runtime/angular";
import { Api, ApiError, type Catalogue, type CatalogueGame, type ChatLine, type House, type HouseMember, type LogEntry, type Overview, type Player, type SharedDesign, type Table, type TableStatus } from "./api";
import "./zubra";

type Section = "overview" | "tables" | "players" | "houses" | "games" | "designs" | "activity";

/** A question before something that can't be taken back, with room for a reason. */
interface Confirm {
  title: string;
  body: string;
  /** The text field's label (a reason, or a new name); without one, nothing is asked for. */
  reasonLabel?: string;
  /** What the field starts with. */
  initial?: string;
  /** What the reason field explains: who'll read it. */
  reasonHelp?: string;
  action: string;
  run(reason: string): Promise<string>;
}

const TOKEN_KEY = "cardroom.admin.token";
const STATUS_LABEL: Record<TableStatus, string> = { open: "Waiting for players", playing: "Playing", finished: "Finished", closed: "Closed" };
const REFRESH_MS = 20_000;

@Component({
  selector: "app-root",
  imports: [FormsModule, ZubraModel],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./app.html",
  styleUrl: "./app.css",
})
export class App implements OnDestroy {
  // Signing in: the token lives in this tab only (sessionStorage), never in a cookie.
  protected readonly token = signal(this.remembered());
  protected readonly signedIn = signal(false);
  protected readonly checking = signal(false);
  protected readonly signInError = signal("");
  /** The field's text (ngModel through zubraModel). */
  protected tokenInput = "";

  protected readonly section = signal<Section>("overview");
  protected readonly sections = [
    { value: "overview", label: "Overview" },
    { value: "tables", label: "Tables" },
    { value: "players", label: "Players" },
    { value: "houses", label: "Houses" },
    { value: "games", label: "Games" },
    { value: "designs", label: "Card designs" },
    { value: "activity", label: "Activity" },
  ];

  protected readonly overview = signal<Overview | null>(null);
  protected readonly tables = signal<Table[]>([]);
  protected readonly players = signal<Player[]>([]);
  protected readonly designs = signal<SharedDesign[]>([]);
  protected readonly log = signal<LogEntry[]>([]);
  protected readonly houses = signal<House[]>([]);
  protected readonly catalogue = signal<Catalogue | null>(null);
  /** While a change to the games is on its way to the server. */
  protected readonly savingGames = signal(false);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal("");

  // Tables
  protected readonly tableFilter = signal<"all" | TableStatus>("all");
  protected readonly tableFilters = [
    { value: "all", label: "All" },
    { value: "playing", label: "Playing" },
    { value: "open", label: "Waiting" },
    { value: "finished", label: "Finished" },
    { value: "closed", label: "Closed" },
  ];
  protected readonly tableColumns = [
    { key: "code", label: "Table", sortable: true },
    { key: "game", label: "Game", sortable: true },
    { key: "status", label: "Status", sortable: true },
    { key: "people", label: "At the table" },
    { key: "house", label: "House", sortable: true },
    { key: "messages", label: "Chat", sortable: true, format: "number" },
  ];
  protected readonly tableRows = computed(() =>
    this.tables()
      .filter((t) => this.tableFilter() === "all" || t.status === this.tableFilter())
      .map((t) => ({
        id: t.id,
        code: t.label ? `${t.id} · ${t.label}` : t.id,
        game: t.rules ? `${t.gameName} (${t.rules})` : t.gameName,
        status: STATUS_LABEL[t.status],
        people: this.people(t),
        house: t.house?.name ?? "",
        messages: t.messages,
      })),
  );
  protected readonly pickedTables = signal<string[]>([]);
  protected readonly closable = computed(() => this.tables().filter((t) => this.pickedTables().includes(t.id) && t.status !== "closed"));

  /** The table open in the dialog, with its chat. */
  protected readonly detail = signal<{ table: Table; chat: ChatLine[] } | null>(null);
  protected readonly detailOpen = signal(false);

  // Players
  protected readonly playerColumns = [
    { key: "name", label: "Name", sortable: true },
    { key: "status", label: "Status", sortable: true },
    { key: "seated", label: "At tables", sortable: true, format: "number" },
    { key: "houses", label: "Houses" },
    { key: "designs", label: "Designs", sortable: true, format: "number" },
    { key: "aka", label: "Also seen as" },
  ];
  protected readonly playerRows = computed(() =>
    this.players().map((p) => ({
      id: p.ref,
      name: p.name,
      status: p.ban ? (p.ban.reason ? `Blocked: ${p.ban.reason}` : "Blocked") : p.seated ? "At a table" : "",
      seated: p.seated,
      houses: p.houses.map((h) => (h.role === "member" ? h.name : `${h.name} (${h.role})`)).join(", "),
      designs: p.designs,
      aka: p.names.filter((n) => n !== p.name).join(", "),
    })),
  );
  protected readonly pickedPlayers = signal<string[]>([]);
  protected readonly toBlock = computed(() => this.players().filter((p) => this.pickedPlayers().includes(p.ref) && !p.ban));
  protected readonly toUnblock = computed(() => this.players().filter((p) => this.pickedPlayers().includes(p.ref) && p.ban));

  // Activity
  protected readonly logColumns = [
    { key: "when", label: "When" },
    { key: "action", label: "What", sortable: true },
    { key: "target", label: "To", sortable: true },
    { key: "note", label: "Note" },
  ];
  protected readonly logRows = computed(() => this.log().map((e) => ({ id: e.id, when: this.when(e.at), action: e.action, target: e.target, note: e.note })));

  // The question dialog
  protected readonly confirm = signal<Confirm | null>(null);
  protected readonly confirmOpen = signal(false);
  protected readonly busy = signal(false);
  protected reason = "";

  /** Two cards that show a design at a glance: its back is drawn beside them. */
  protected readonly sample = [
    { kind: "pip", suit: "spades", rank: 14 },
    { kind: "pip", suit: "diamonds", rank: 12 },
  ];

  private readonly api = new Api(() => this.token());
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (this.token()) void this.signIn(this.token());
    // While signed in, keep the lists fresh; a hidden tab waits until it's looked at again.
    effect((onCleanup) => {
      if (!this.signedIn()) return;
      const tick = () => document.visibilityState === "visible" && !this.confirmOpen() && void this.refresh(true);
      this.timer = setInterval(tick, REFRESH_MS);
      document.addEventListener("visibilitychange", tick);
      onCleanup(() => {
        if (this.timer) clearInterval(this.timer);
        document.removeEventListener("visibilitychange", tick);
      });
    });
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- Signing in ----------

  private remembered(): string {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  }

  protected async signIn(token = this.tokenInput.trim(), event?: Event): Promise<void> {
    event?.preventDefault();
    if (!token) return void this.signInError.set("Enter the admin token.");
    this.checking.set(true);
    this.signInError.set("");
    this.token.set(token);
    try {
      this.overview.set(await this.api.overview());
      try {
        sessionStorage.setItem(TOKEN_KEY, token);
      } catch {
        // Private browsing: signed in until the tab reloads.
      }
      this.signedIn.set(true);
      this.tokenInput = "";
      await this.refresh();
    } catch (error) {
      this.forget();
      this.signInError.set(this.message(error));
    } finally {
      this.checking.set(false);
    }
  }

  private forget(): void {
    this.token.set("");
    this.signedIn.set(false);
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing was kept.
    }
  }

  protected signOut(): void {
    this.forget();
    this.loaded.set(false);
    this.tables.set([]);
    this.players.set([]);
    this.designs.set([]);
    this.houses.set([]);
    this.catalogue.set(null);
    this.log.set([]);
    this.overview.set(null);
  }

  // ---------- Loading ----------

  protected async refresh(quiet = false): Promise<void> {
    try {
      const [overview, tables, players, designs, log, houses, catalogue] = await Promise.all([this.api.overview(), this.api.tables(), this.api.players(), this.api.designs(), this.api.log(), this.api.houses(), this.api.games()]);
      this.houses.set(houses);
      if (!this.savingGames()) this.catalogue.set(catalogue);
      this.overview.set(overview);
      this.tables.set(tables);
      this.players.set(players);
      this.designs.set(designs);
      this.log.set(log);
      // A selection only makes sense for rows that are still there.
      this.pickedTables.update((ids) => ids.filter((id) => tables.some((t) => t.id === id)));
      this.pickedPlayers.update((refs) => refs.filter((ref) => players.some((p) => p.ref === ref)));
      this.loaded.set(true);
      this.loadError.set("");
      if (!quiet) return;
      const open = this.detail();
      if (open && this.detailOpen()) void this.openTable(open.table.id, true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.signOut();
        this.signInError.set("The admin token changed. Sign in again.");
        return;
      }
      this.loadError.set(this.message(error));
    }
  }

  // ---------- Tables ----------

  protected people(table: Table): string {
    const names = table.seats.filter((s) => s.name && !s.bot).map((s) => s.name);
    const bots = table.seats.filter((s) => s.bot).length;
    const empty = table.seats.filter((s) => !s.name).length;
    return [names.join(", "), bots ? `${bots} ${bots === 1 ? "bot" : "bots"}` : "", empty && table.status === "open" ? `${empty} empty` : ""].filter(Boolean).join(" · ") || "Nobody yet";
  }

  protected async openTable(id: string, quiet = false): Promise<void> {
    try {
      this.detail.set(await this.api.table(id));
      this.detailOpen.set(true);
    } catch (error) {
      if (!quiet) this.toast(this.message(error), "danger");
    }
  }

  protected askClose(tables: Table[]): void {
    if (!tables.length) return;
    const one = tables.length === 1 ? tables[0]! : null;
    this.ask({
      title: one ? `Close ${one.gameName} table ${one.id}?` : `Close ${tables.length} tables?`,
      body: one
        ? `${this.people(one)}. Nobody will be able to sit, play or talk there again. This can't be undone.`
        : "Nobody will be able to sit, play or talk at them again. This can't be undone.",
      reasonLabel: "Reason",
      reasonHelp: "Everyone at the table sees this.",
      action: one ? "Close table" : `Close ${tables.length} tables`,
      run: async (reason) => {
        for (const t of tables) await this.api.closeTable(t.id, reason);
        this.detailOpen.set(false);
        this.pickedTables.set([]);
        return one ? `Closed table ${one.id}.` : `Closed ${tables.length} tables.`;
      },
    });
  }

  protected askUnseat(table: Table, seat: number): void {
    const name = table.seats[seat]?.name ?? `Seat ${seat + 1}`;
    this.ask({
      title: `Remove ${name} from this table?`,
      body: table.started ? "A computer player takes over their seat, so the others can finish the game." : "The seat opens up again for someone else. They could sit back down unless you block them.",
      action: "Remove from table",
      run: async () => {
        await this.api.unseat(table.id, seat);
        void this.openTable(table.id, true);
        return `Removed ${name} from table ${table.id}.`;
      },
    });
  }

  protected async redact(table: Table, line: ChatLine): Promise<void> {
    try {
      await this.api.redact(table.id, line.key);
      await this.openTable(table.id, true);
      this.toast("Removed the message.", "success");
      void this.refresh(true);
    } catch (error) {
      this.toast(this.message(error), "danger");
    }
  }

  // ---------- Players ----------

  protected askBlock(players: Player[]): void {
    if (!players.length) return;
    const one = players.length === 1 ? players[0]! : null;
    this.ask({
      title: one ? `Block ${one.name}?` : `Block ${players.length} players?`,
      body: `${one ? "They" : "Each of them"} won't be able to sit at a table, play, chat, open a house or share card designs here. Tables they're at carry on without them. You can unblock ${one ? "them" : "anyone"} later.`,
      reasonLabel: "Reason",
      reasonHelp: "Only you see this: it's a note for the list.",
      action: one ? "Block player" : `Block ${players.length} players`,
      run: async (reason) => {
        for (const p of players) await this.api.block(p.ref, reason);
        this.pickedPlayers.set([]);
        return one ? `Blocked ${one.name}.` : `Blocked ${players.length} players.`;
      },
    });
  }

  /** Blocking from a seat in the table dialog. */
  protected askBlockSeat(ref: string | null): void {
    const player = this.players().find((p) => p.ref === ref);
    if (player) this.askBlock([player]);
  }

  protected async unblock(players: Player[]): Promise<void> {
    try {
      for (const p of players) await this.api.unblock(p.ref);
      this.pickedPlayers.set([]);
      this.toast(players.length === 1 ? `Unblocked ${players[0]!.name}.` : `Unblocked ${players.length} players.`, "success");
    } catch (error) {
      this.toast(this.message(error), "danger");
    }
    await this.refresh(true);
  }

  // ---------- Houses ----------

  protected askRename(house: House): void {
    this.ask({
      title: `Rename ${house.name}?`,
      body: "Everyone in the house sees the new name. Its invite link stays the same.",
      reasonLabel: "House name",
      initial: house.name,
      action: "Rename house",
      run: async (name) => {
        await this.api.renameHouse(house.slug, name);
        return `Renamed the house to ${name}.`;
      },
    });
  }

  protected askOwner(house: House, member: HouseMember): void {
    const owner = house.members.find((m) => m.role === "owner");
    this.ask({
      title: `Make ${member.name} the owner of ${house.name}?`,
      body: `The owner sets the house's rules and roles. ${owner ? `${owner.name} stays in the house as an admin.` : ""}`,
      action: "Make owner",
      run: async () => {
        await this.api.makeOwner(house.slug, member.id);
        return `${member.name} now owns ${house.name}.`;
      },
    });
  }

  protected askRemoveMember(house: House, member: HouseMember): void {
    this.ask({
      title: `Remove ${member.name} from ${house.name}?`,
      body: "They lose the house's tables, rules and tournaments. They could join again with its invite link unless you block them.",
      action: "Remove from house",
      run: async () => {
        await this.api.removeMember(house.slug, member.id);
        return `Removed ${member.name} from ${house.name}.`;
      },
    });
  }

  protected askDeleteHouse(house: House): void {
    this.ask({
      title: `Delete ${house.name}?`,
      body: `The house, its saved rules, its leaderboard and its tournaments are gone for all ${house.members.length} of its members. Tables already open carry on. This can't be undone.`,
      action: "Delete house",
      run: async () => {
        await this.api.deleteHouse(house.slug);
        return `Deleted ${house.name}.`;
      },
    });
  }

  // ---------- Games ----------

  protected seats(game: CatalogueGame): string {
    const [min, max] = game.seats;
    return `${min === max ? min : `${min} to ${max}`} ${max === 1 ? "player" : "players"}${game.teams ? ", partners" : ""}`;
  }

  /** Show the change at once, send it, and take the server's word for how it ended up. */
  private async saveGames(next: Catalogue, change: { order?: string[]; off?: string[]; watching?: boolean }): Promise<void> {
    const before = this.catalogue();
    this.catalogue.set(next);
    this.savingGames.set(true);
    try {
      this.catalogue.set(await this.api.setGames(change));
    } catch (error) {
      this.catalogue.set(before);
      this.toast(this.message(error), "danger");
    } finally {
      this.savingGames.set(false);
    }
  }

  protected setGameOn(game: CatalogueGame, on: boolean): void {
    const now = this.catalogue();
    if (!now) return;
    const games = now.games.map((g) => (g.id === game.id ? { ...g, on } : g));
    void this.saveGames({ ...now, games }, { off: games.filter((g) => !g.on).map((g) => g.id) });
  }

  /** Move a game to a place in the list (0 is first). */
  protected moveGame(game: CatalogueGame, to: number): void {
    const now = this.catalogue();
    if (!now) return;
    const games = now.games.filter((g) => g.id !== game.id);
    games.splice(Math.max(0, Math.min(to, games.length)), 0, game);
    void this.saveGames({ ...now, games }, { order: games.map((g) => g.id) });
  }

  protected setWatching(watching: boolean): void {
    const now = this.catalogue();
    if (now) void this.saveGames({ ...now, watching }, { watching });
  }

  // ---------- Card designs ----------

  protected deck(design: CardDesign): string {
    return deckStyle(design);
  }

  protected askHide(design: SharedDesign): void {
    this.ask({
      title: `Hide “${design.design.name}”?`,
      body: `It comes out of the gallery, so nobody else can see or use it. ${design.author} keeps it and sees your reason. You can put it back later.`,
      reasonLabel: "Reason",
      reasonHelp: `${design.author} sees this.`,
      action: "Hide design",
      run: async (reason) => {
        await this.api.hideDesign(design.id, reason);
        return `Hid “${design.design.name}”.`;
      },
    });
  }

  protected async restore(design: SharedDesign): Promise<void> {
    try {
      await this.api.restoreDesign(design.id);
      this.toast(`“${design.design.name}” is back in the gallery.`, "success");
    } catch (error) {
      this.toast(this.message(error), "danger");
    }
    await this.refresh(true);
  }

  // ---------- The question dialog ----------

  private ask(question: Confirm): void {
    this.reason = question.initial ?? "";
    this.confirm.set(question);
    this.confirmOpen.set(true);
  }

  protected async answer(): Promise<void> {
    const question = this.confirm();
    if (!question || this.busy()) return;
    this.busy.set(true);
    try {
      const done = await question.run(this.reason.trim());
      this.confirmOpen.set(false);
      this.toast(done, "success");
    } catch (error) {
      this.toast(this.message(error), "danger");
    } finally {
      this.busy.set(false);
    }
    await this.refresh(true);
  }

  // ---------- Small things ----------

  /** A Zubra component's event carries its news in `detail`. */
  protected detailOf<T>(event: Event): T {
    return (event as CustomEvent<T>).detail;
  }

  protected setSection(event: Event): void {
    this.section.set(this.detailOf<Section>(event));
  }

  protected when(at: number): string {
    return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  protected statusLabel(status: TableStatus): string {
    return STATUS_LABEL[status];
  }

  protected statusVariant(status: TableStatus): string {
    return status === "playing" ? "success" : status === "open" ? "primary" : status === "closed" ? "danger" : "neutral";
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : "Something went wrong. Try again.";
  }

  /** zubra-ui's <toast-region> listens on the document: any code shows a toast with an event. */
  private toast(message: string, variant: "success" | "danger" | "info" = "info"): void {
    document.dispatchEvent(new CustomEvent("toast", { detail: { message, variant } }));
  }
}
