// Large text and a finger's room: the text at twice its size (a phone's own setting, or the game's „Размер на
// текста“ with it) on the narrowest phone scrolls nowhere sideways, and every control on its own has 44px to tap.
import { expect, type Page, test } from "@playwright/test";
import { startDay } from "./play.ts";

/** The text at `percent` of its size from the page's start, as a phone set to large text gives it (a style the page's
 * own rules can't undo; CSP lets the test add it). */
async function textAt(page: Page, percent: number): Promise<void> {
  await page.addInitScript((p) => {
    const style = document.createElement("style");
    style.textContent = `html { font-size: ${p}% !important; }`;
    const put = () => {
      if (document.head && !style.isConnected) document.head.append(style);
    };
    new MutationObserver(put).observe(document, { childList: true, subtree: true });
    put();
  }, percent);
}

/** What makes the page wider than the screen, if anything: the deepest element that does, found by hiding each in
 * turn (a name a failing test can be read by). */
async function sideways(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const wide = () => root.scrollWidth > root.clientWidth;
    if (!wide()) return "";
    const path: string[] = [];
    let at: Element = document.body;
    for (;;) {
      const culprit = [...at.children].find((c) => {
        const el = c as HTMLElement;
        const was = el.style.display;
        el.style.display = "none";
        const fits = !wide();
        el.style.display = was;
        return fits;
      });
      if (!culprit) break;
      path.push(`${culprit.tagName.toLowerCase()}.${[...culprit.classList].join(".")}`);
      at = culprit;
    }
    return `${root.scrollWidth}px wide: ${path.join(" > ")}`;
  });
}

async function fits(page: Page, where: string): Promise<void> {
  await page.waitForTimeout(300); // what comes in beats (an answer's parts) has come
  expect(await sideways(page), where).toBe("");
}

/** Answers whatever question shows, without the pointer's checks: at this size „Готово“ and „Отговори“ stay at the
 * screen's foot over what scrolls under them, which a player scrolls past and a test's click won't. */
async function answerAnyhow(page: Page): Promise<void> {
  const q = page.locator("article.question");
  await expect(q.locator(".split, .options, .keypad, .tf-options, .match").first()).toBeVisible();
  const tap = (l: ReturnType<Page["locator"]>) => l.dispatchEvent("click");
  if (await q.locator(".keypad").count()) {
    for (const k of "1900") await tap(q.locator(".keypad").getByRole("button", { name: k, exact: true }));
    await tap(q.getByRole("button", { name: "Отговори" }));
  } else if (await q.locator(".sortable-list").count()) {
    await tap(q.getByRole("button", { name: "Готово" }));
  } else if (await q.locator(".match").count()) {
    const [left, right] = [q.locator(".match-col").first(), q.locator(".match-col").last()];
    for (let i = 0; i < 4; i++) {
      await tap(left.locator(".match-item").nth(i));
      await tap(right.locator(".match-item").nth(i));
    }
    await tap(q.getByRole("button", { name: "Готово" }));
  } else if (await q.locator(".split").count()) {
    for (let i = 0; i < 6; i++) await tap(q.locator(".split-side").first());
  } else if (await q.locator(".tf-options").count()) {
    await tap(q.getByRole("button", { name: "Вярно", exact: true }));
  } else {
    await tap(q.locator(".options .option").first());
  }
}

test.describe("twice the text on a 320px phone", () => {
  test.use({ viewport: { width: 320, height: 640 }, bypassCSP: true });

  test("the day, its ten questions and answers, and the places: nothing scrolls sideways", async ({ page }) => {
    test.setTimeout(180_000);
    await textAt(page, 200);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Десет въпроса за днес" })).toBeVisible();
    await fits(page, "Начало");
    // The bar of places shows its pictures alone, the places still named for whoever can't see them.
    await expect(page.locator(".tabs .tab-label").first()).toHaveCSS("position", "absolute");
    await expect(page.getByRole("link", { name: "Класации" })).toBeVisible();
    await startDay(page);
    for (let n = 0; n < 10; n++) {
      await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
      await fits(page, `question ${n + 1}`);
      await answerAnyhow(page);
      await expect(page.locator(".after .verdict")).toBeVisible({ timeout: 40_000 });
      await expect(page.locator(".after .up-next-go")).toBeVisible();
      await fits(page, `answer ${n + 1}`);
      await page
        .locator(".after .up-next-go")
        .dispatchEvent("click")
        .catch(() => {}); // moved on by itself
    }
    await expect(page.locator(".summary")).toBeVisible({ timeout: 10_000 });
    await fits(page, "the day's result");
    for (const path of ["/", "/ranks", "/me", "/rewards", "/wardrobe", "/friends", "/settings", "/room", "/duel"]) {
      await page.goto(path);
      await expect(page.locator("#main h1, #main h2").first()).toBeVisible();
      await fits(page, path);
    }
  });
});

test("„Размер на текста“: three sizes, kept on this device; the one switch before it becomes the first step", async ({
  page,
}) => {
  // „По-едър текст“ on, as a player had it: the first of the larger sizes now.
  await page.addInitScript(() => {
    if (!localStorage.getItem("almanac.text")) localStorage.setItem("almanac.big", "on");
  });
  await page.goto("/settings");
  const sizes = page.getByRole("radiogroup", { name: "Размер на текста" });
  await expect(sizes.getByRole("radio", { name: "Едър", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
  await sizes.getByRole("radio", { name: "Много едър" }).click();
  await expect(page.locator("html")).toHaveCSS("font-size", "24px");
  await page.reload();
  await expect(sizes.getByRole("radio", { name: "Много едър" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveCSS("font-size", "24px");
  await sizes.getByRole("radio", { name: "Обичаен" }).click();
  await expect(page.locator("html")).toHaveCSS("font-size", "16px");
});

test("a switch in Настройки is its whole row to tap, words and all", async ({ page }) => {
  await page.goto("/settings");
  const calm = page.getByRole("switch", { name: "По-малко движение" });
  const was = await calm.getAttribute("aria-checked");
  await page.getByText("Без анимации; часовникът пак тече.").click();
  await expect(calm).not.toHaveAttribute("aria-checked", was ?? "");
  // What it does is read with it.
  await expect(calm).toHaveAccessibleDescription("Без анимации; часовникът пак тече.");
});

/** Controls on their own (not a link inside a sentence) whose tap reaches them less than 44px high: tried by
 * elementFromPoint 21px above and below each one's middle, so a target drawn smaller with room around it to tap
 * (a pill's padding, a row's height) counts as what a finger has. */
async function smallTargets(page: Page): Promise<string[]> {
  const found: string[] = [];
  const controls = page.locator("a[href], button, [role=switch], [role=radio], [role=tab], summary");
  for (const c of await controls.all()) {
    if (!(await c.isVisible())) continue;
    const small = await c.evaluate((el) => {
      const parent = el.parentElement;
      // A link or a word that explains, in a sentence: read where it is, the line's height (WCAG's inline exception).
      if (
        parent &&
        [...parent.childNodes].some((n) => n !== el && n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      )
        return "";
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const reaches = (dy: number) => {
        const hit = document.elementFromPoint(x, y + dy);
        return !!hit && (hit === el || el.contains(hit) || !!hit.closest("label")?.contains(el));
      };
      return reaches(-21) && reaches(21)
        ? ""
        : `${el.tagName.toLowerCase()} „${(el.textContent ?? "").trim()}“ ${Math.round(r.height)}px`;
    });
    if (small) found.push(small);
  }
  return found;
}

test.describe("a finger's room", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("every control on its own has 44px to tap", async ({ page }) => {
    test.setTimeout(90_000);
    for (const path of ["/", "/settings", "/me", "/ranks", "/room", "/wardrobe", "/friends"]) {
      await page.goto(path);
      await expect(page.locator("#main h1, #main h2").first()).toBeVisible();
      expect(await smallTargets(page), path).toEqual([]);
    }
  });
});
