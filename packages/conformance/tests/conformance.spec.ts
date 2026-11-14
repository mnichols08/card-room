// The same checks against the same fixture in every framework. A check that fails in one
// framework and passes in the rest is a difference in how Zubra's components behave there.
//
// KNOWN lists the differences already reported upstream, each as { [check's title]: issue link }.
// Those checks are expected to fail; when one starts passing (Zubra fixed it), the run says so,
// and the entry and the workaround in the card room's own apps can go.
import { expect, test, type Page } from "@playwright/test";

const FRAMEWORKS = ["element", "react", "vue", "svelte", "solid", "angular"] as const;
type Framework = (typeof FRAMEWORKS)[number];

const TEXT = "text the page fills in shows in a slot";
const OWN = "an element the page puts in a slot stays the page's own";
const TOGETHER = "elements for different slots that arrive together each go to their slot";
const GONE = "elements taken away again are gone from every slot";

// Nothing differs today (the last ones were fixed in Zubra 5.15.0).
const KNOWN: Partial<Record<Framework, Record<string, string>>> = {};

const t = (page: Page, name: string) => page.locator(`[data-t="${name}"]`);

for (const framework of FRAMEWORKS) {
  test.describe(framework, () => {
    let errors: string[];

    /** A check; one listed in KNOWN for this framework is expected to fail. */
    const check = (title: string, body: (page: Page) => Promise<void>) =>
      test(title, async ({ page }) => {
        const known = KNOWN[framework]?.[title];
        test.fail(!!known, known);
        await body(page);
        expect(errors, "errors on the page").toEqual([]);
      });

    test.beforeEach(async ({ page }) => {
      errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
      await page.goto(`/${framework}/`);
      await expect(t(page, "badge")).toBeVisible();
    });

    check("a prop set from the page reaches the component", async (page) => {
      const badge = t(page, "badge").locator("span").first();
      await expect(badge).toHaveClass(/badge-neutral/);
      await t(page, "cycle").click();
      await expect(badge).toHaveClass(/badge-success/);
      await t(page, "cycle").click();
      await expect(badge).toHaveClass(/badge-danger/);
    });

    check("static text shows in a slot", async (page) => {
      await expect(t(page, "badge")).toHaveText("Status");
      await expect(t(page, "empty").locator(".empty-text")).toHaveText("Body text");
    });

    check(TEXT, async (page) => {
      await expect(t(page, "count-badge").locator("span").first()).toHaveText("0");
      await t(page, "inc").click();
      await t(page, "inc").click();
      await expect(t(page, "count-badge").locator("span").first()).toHaveText("2");
    });

    check(OWN, async (page) => {
      // The page's <span> sits inside the badge's own <span>: it isn't taken for the badge's markup.
      const inner = t(page, "wrapped-inner");
      await expect(inner).toHaveCount(1);
      await expect(inner).not.toHaveClass(/badge-/);
      await expect(inner).toHaveText("0");
      await t(page, "inc").click();
      await expect(inner).toHaveText("1");
      await expect(t(page, "wrapped")).toHaveText("1");
    });

    check("an event from the component reaches the page", async (page) => {
      await t(page, "seg").getByRole("button", { name: "Beta" }).click();
      await expect(t(page, "seg-out")).toHaveText("b");
      await expect(t(page, "seg").locator('[data-value="b"]')).toHaveAttribute("aria-pressed", "true");
      await expect(t(page, "seg").locator('[data-value="a"]')).toHaveAttribute("aria-pressed", "false");
    });

    check("a list given as a prop is drawn, and a value set from the page is shown", async (page) => {
      await expect(t(page, "seg").getByRole("button")).toHaveText(["Alpha", "Beta", "Gamma"]);
      await t(page, "seg-set").click();
      await expect(t(page, "seg").locator('[data-value="c"]')).toHaveAttribute("aria-pressed", "true");
      await expect(t(page, "seg-out")).toHaveText("c");
    });

    check("a text field is bound both ways", async (page) => {
      const input = t(page, "name").locator("input");
      await input.fill("Pappy");
      await expect(t(page, "name-out")).toHaveText("Pappy");
      await t(page, "name-set").click();
      await expect(input).toHaveValue("Grammi");
      await expect(t(page, "name-out")).toHaveText("Grammi");
      // Typing after the page set it carries on from the page's value.
      await input.press("End");
      await input.type("!");
      await expect(t(page, "name-out")).toHaveText("Grammi!");
    });

    check("a switch is bound both ways", async (page) => {
      const button = t(page, "toggle").getByRole("switch");
      await expect(button).toHaveAttribute("aria-checked", "false");
      await button.click();
      await expect(button).toHaveAttribute("aria-checked", "true");
      await expect(t(page, "toggle-out")).toHaveText("on");
      await t(page, "toggle-off").click();
      await expect(button).toHaveAttribute("aria-checked", "false");
      await expect(t(page, "toggle-out")).toHaveText("off");
    });

    check("a named slot's element goes to its slot, and its clicks reach the page", async (page) => {
      const action = t(page, "empty").locator(".empty-actions").locator('[data-t="empty-action"]');
      await expect(action).toBeVisible();
      await action.getByRole("button").click();
      await action.getByRole("button").click();
      await expect(t(page, "empty-out")).toHaveText("2");
    });

    check(TOGETHER, async (page) => {
      const alert = t(page, "alert");
      await expect(alert.locator(".alert-text")).toHaveText("Nothing more");
      await expect(alert.locator(".alert-actions")).toHaveCount(0);
      await t(page, "alert-more").click();
      await expect(alert.locator(".alert-text")).toHaveText("Something more and extra");
      await expect(alert.locator(".alert-actions").locator('[data-t="alert-action"], [data-t="alert-action-2"]')).toHaveCount(2);
      await expect(alert.locator(".alert-text").locator('[data-t="alert-action"], [data-t="alert-action-2"]')).toHaveCount(0);
    });

    check(GONE, async (page) => {
      const alert = t(page, "alert");
      await t(page, "alert-more").click();
      await expect(alert.locator('[data-t="alert-action"]')).toHaveCount(1);
      await t(page, "alert-more").click();
      await expect(alert.locator(".alert-text")).toHaveText("Nothing more");
      await expect(alert.locator('[data-t="alert-action"], [data-t="alert-action-2"], [data-t="alert-extra"]')).toHaveCount(0);
    });

    check("a dialog opens from the page, shows live content and reports closing", async (page) => {
      const dialog = t(page, "dialog").locator("dialog");
      await expect(dialog).not.toBeVisible();
      await t(page, "name").locator("input").fill("Rick");
      await t(page, "open").click();
      await expect(dialog).toBeVisible();
      await expect(t(page, "dialog-out")).toHaveText("open");
      await expect(dialog.locator(".body")).toHaveText("Rick");
      // Both buttons sit in the footer.
      await expect(dialog.locator("footer").locator('[data-t="dialog-cancel"], [data-t="dialog-ok"]')).toHaveCount(2);
      await dialog.locator('[data-t="dialog-cancel"]').getByRole("button").click();
      await expect(dialog).not.toBeVisible();
      await expect(t(page, "dialog-out")).toHaveText("closed");

      await t(page, "open").click();
      await dialog.locator('[data-t="dialog-ok"]').getByRole("button").click();
      await expect(t(page, "confirm-out")).toHaveText("1");
      await expect(dialog).not.toBeVisible();

      // Escape closes it too, and the page hears.
      await t(page, "open").click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(t(page, "dialog-out")).toHaveText("closed");
    });

    check("a dialog's button that arrives later goes to its footer", async (page) => {
      await t(page, "name-set").click();
      await t(page, "open").click();
      const dialog = t(page, "dialog").locator("dialog");
      await expect(dialog.locator("footer").locator('[data-t="dialog-extra"]')).toBeVisible();
      await expect(dialog.locator("footer").locator('[data-t="dialog-cancel"], [data-t="dialog-ok"], [data-t="dialog-extra"]')).toHaveCount(3);
    });

    check("a list the page draws in a slot stays in step", async (page) => {
      const items = t(page, "list").locator(".stack").locator("[data-item]");
      await expect(items).toHaveText(["one", "two"]);
      await t(page, "add").click();
      await expect(items).toHaveText(["one", "two", "item 3"]);
      await t(page, "remove-first").click();
      await expect(items).toHaveText(["two", "item 3"]);
      await t(page, "add").click();
      await expect(items).toHaveText(["two", "item 3", "item 3"]);
    });

    check("a table takes rows, reports a selection and shows one set from the page", async (page) => {
      const table = t(page, "table");
      await expect(table.locator("tbody tr")).toHaveCount(3);
      await table.getByLabel("Select Hank").check();
      await expect(t(page, "table-out")).toHaveText("r2");
      await t(page, "table-select").click();
      await expect(table.getByLabel("Select Dot")).toBeChecked();
      await expect(table.getByLabel("Select Lou")).toBeChecked();
      await expect(table.getByLabel("Select Hank")).not.toBeChecked();
      await t(page, "table-add").click();
      await expect(table.locator("tbody tr")).toHaveCount(4);
      await expect(table.locator("tbody tr").last()).toContainText("Bea");
    });

    check("tabs switch panels, are bound both ways and keep their panels live", async (page) => {
      const tabs = t(page, "tabs");
      const one = tabs.locator('section[data-tab="one"]');
      const two = tabs.locator('section[data-tab="two"]');
      await expect(one).toBeVisible();
      await expect(two).not.toBeVisible();
      await tabs.getByRole("tab", { name: "Two" }).click();
      await expect(t(page, "tab-out")).toHaveText("two");
      await expect(two).toBeVisible();
      await expect(one).not.toBeVisible();
      await t(page, "tab-set").click();
      await expect(tabs.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "true");
      await expect(one).toBeVisible();
      await t(page, "inc").click();
      await expect(t(page, "tab-count")).toHaveText("1");
    });

    check("the card room's own components take objects and fire their events", async (page) => {
      const card = t(page, "card").getByRole("button");
      const first = await card.getAttribute("aria-label");
      expect(first).toMatch(/A of spades/i);
      await card.click();
      await expect(t(page, "card-out")).toHaveText("1");
      await t(page, "card-next").click();
      await expect(card).toHaveAttribute("aria-label", /Q of hearts/i);

      await t(page, "name-set").click();
      await t(page, "inc").click();
      await expect(t(page, "seat")).toContainText("Grammi");
      await expect(t(page, "seat")).toContainText("Took 1");

      await t(page, "bid").getByRole("button", { name: "3", exact: true }).click();
      await expect(t(page, "bid-out")).toHaveText("3");
      await t(page, "bid").getByRole("button", { name: "Nil" }).click();
      await expect(t(page, "bid-out")).toHaveText("nil");
    });

    check("a component taken away and brought back still works", async (page) => {
      await t(page, "temp").getByRole("switch").click();
      await expect(t(page, "temp-out")).toHaveText("on");
      await t(page, "remount").click();
      await expect(t(page, "temp")).toHaveCount(0);
      await t(page, "remount").click();
      await expect(t(page, "temp").getByRole("switch")).toHaveAttribute("aria-checked", "false");
      await t(page, "temp").getByRole("switch").click();
      await expect(t(page, "temp-out")).toHaveText("on");
    });
  });
}
