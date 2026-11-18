import { expect, type Page, test } from "@playwright/test";
import { answer } from "./play.ts";

test("a host leads a room from a big screen and doesn't play", async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto("/room");
  await host.getByRole("radio", { name: "5", exact: true }).click();
  await host.getByRole("radio", { name: "Само водя (за голям екран)" }).click();
  await host.getByRole("button", { name: "Всички теми" }).click();
  await expect(host).toHaveURL(/\/r\/\d{6}$/);
  const code = host.url().slice(-6);
  // Leading, not playing: no name to ask for.

  // The lobby: the code, the link as a QR code drawn by the server, and nobody yet (the host isn't a player).
  await expect(host.getByText(`/r/${code} или насочете камерата към кода.`)).toBeVisible();
  const qr = host.getByRole("img", { name: /QR код/ });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(host.getByText("Още никой не е влязъл.")).toBeVisible();
  // The room is the whole screen: no header, no places' bar; Night or Day chosen over it.
  await expect(host.locator("#app > .top")).toBeHidden();
  await expect(host.locator(".tabs")).toBeHidden();
  await expect(host.getByRole("radiogroup", { name: "Изглед" })).toBeVisible();

  await guest.goto(`/r/${code}`);
  await guest.getByLabel("Име").fill("Бояна");
  await guest.getByRole("button", { name: "Влез" }).click();
  // The players wait for „водещия“, not for the host's drawn name.
  await expect(guest.getByText("Чакаме водещия да започне.")).toBeVisible();
  await expect(host.locator(".players li")).toHaveCount(1);
  // The host's hands on the players are folded: the room reads the big screen too.
  await expect(host.getByRole("button", { name: /Махни/ })).toHaveCount(0);
  await host.getByRole("button", { name: "Управлявай играчите" }).click();
  await expect(host.getByRole("button", { name: "Махни Бояна" })).toBeVisible();
  await expect(host.getByRole("button", { name: "Заключи стаята" })).toBeVisible();
  await host.getByRole("button", { name: "Готово" }).click();
  await expect(host.getByRole("button", { name: /Махни/ })).toHaveCount(0);
  await host.getByRole("button", { name: "Започни" }).click();

  // The question large, how many have answered; held from the start, the answer waits for „Напред“.
  await expect(guest.locator(".question-head")).toContainText("1 от 5");
  await expect(host.locator(".question-head")).toContainText("1 от 5");
  await expect(host.getByText("Отговориха 0 от 1.")).toBeVisible();
  // Its answers to look at, marked as the phones mark them: no keys, no line on how to answer, no grips, no „Готово“.
  const stage = host.locator(".host-stage");
  await expect(stage.locator(".key-hint, .grip, .btn")).toHaveCount(0);
  await expect(stage.locator(".hint:visible")).toHaveCount(0);
  const marks = stage.locator(".options:not(.sortable-list) > button.option .letter");
  if (await marks.count()) await expect(marks).toHaveText(["А", "Б", "В", "Г"]);
  await expect(host.getByRole("button", { name: "Задръж" })).toHaveAttribute("aria-pressed", "true");
  await answer(guest);
  await expect(guest.getByText("Водещият ще продължи.")).toBeVisible();
  await expect(host.getByText("Следващият въпрос — с „Напред“.")).toBeVisible();
  // Held, the phone shows the answer's fact too, as the big screen does.
  await expect(guest.locator(".fact")).toHaveCount(await host.locator(".fact").count());
  await expect(host.locator(".board .row")).toHaveCount(1);
  await host.getByRole("button", { name: "Напред" }).click();
  await expect(guest.locator(".question-head")).toContainText("2 от 5");

  // „Напред“ on a question shows its answer at once, from the keys too (a presentation clicker's →); H lets go of the
  // answers and holds them again.
  await expect(host.getByText("Отговориха 0 от 1.")).toBeVisible();
  await host.keyboard.press("ArrowRight");
  await expect(guest.locator(".verdict")).toBeVisible();
  const hold = host.getByRole("button", { name: "Задръж" });
  await host.keyboard.press("h");
  await expect(hold).toHaveAttribute("aria-pressed", "false");
  await host.keyboard.press("h");
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  // „Приключи“, asked twice, ends the game where it is; while it asks, a key is no answer to it (Esc takes it back).
  await host.getByRole("button", { name: "Приключи" }).click();
  await host.keyboard.press("PageDown");
  await host.waitForTimeout(500); // time enough for a „Напред“ to land, were it taken
  await expect(host.locator(".host-reveal .question-head")).toContainText("2 от 5");
  await host.keyboard.press("Escape");
  await expect(host.getByRole("button", { name: "Приключи" })).toBeVisible();
  await host.getByRole("button", { name: "Приключи" }).click();
  await host.getByRole("button", { name: "Да, приключи" }).click();
  await expect(host.getByRole("heading", { name: "Бояна печели" })).toBeVisible();
  await expect(host.locator(".podium li.p1")).toContainText("Бояна");
  // To Бояна herself, her win is hers: never her name in the third person.
  await expect(guest.getByRole("heading", { name: "Печелиш" })).toBeVisible();
  await guest.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(guest.locator(".reviewed")).toHaveCount(2);
});

test("a room led from a big screen plays with no phones: everyone answers aloud", async ({ browser }) => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await host.goto("/room");
  await host.getByRole("radio", { name: "5", exact: true }).click();
  await host.getByRole("radio", { name: "Само водя (за голям екран)" }).click();
  await host.getByRole("button", { name: "Всички теми" }).click();
  await expect(host.getByText("Може да играете и без телефони")).toBeVisible();
  await host.getByRole("button", { name: "Започни" }).click();
  await expect(host.locator(".question-head")).toContainText("1 от 5");
  await expect(host.getByText(/^Отговориха/)).toHaveCount(0);
  // „Напред“ shows the answer, which waits; again, the next question.
  await host.getByRole("button", { name: "Напред" }).click();
  await expect(host.getByText("Следващият въпрос — с „Напред“.")).toBeVisible();
  await expect(host.locator(".board")).toHaveCount(0);
  await host.getByRole("button", { name: "Напред" }).click();
  await expect(host.locator(".question-head")).toContainText("2 от 5");
  await host.getByRole("button", { name: "Приключи" }).click();
  await host.getByRole("button", { name: "Да, приключи" }).click();
  await expect(host.getByRole("heading", { name: "Край" })).toBeVisible();
  await expect(host.getByRole("button", { name: "Започни нова игра" })).toBeVisible();
});

/** Opens a room of five questions, led from a big screen; its code. */
async function leadRoom(host: Page): Promise<string> {
  await host.goto("/room");
  await host.getByRole("radio", { name: "5", exact: true }).click();
  await host.getByRole("radio", { name: "Само водя (за голям екран)" }).click();
  await host.getByRole("button", { name: "Всички теми" }).click();
  await expect(host).toHaveURL(/\/r\/\d{6}$/);
  return host.url().slice(-6);
}

async function join(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/r/${code}`);
  await page.getByLabel("Име").fill(name);
  await page.getByRole("button", { name: "Влез" }).click();
  await expect(page.getByText("Чакаме водещия да започне.")).toBeVisible();
}

test("the room sees how it answered: who's still answering, what each answer got, who knew it", async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const ana = await (await browser.newContext()).newPage();
  const bo = await (await browser.newContext()).newPage();
  const code = await leadRoom(host);
  await join(ana, code, "Ася");
  await join(bo, code, "Боян");
  await host.getByRole("button", { name: "Започни" }).click();
  await expect(host.getByText("Отговориха 0 от 2.")).toBeVisible();
  await answer(ana);
  // Few are left: by name, to each who isn't one of them.
  await expect(host.getByText("Отговориха 1 от 2. Чакаме Боян.")).toBeVisible();
  await expect(ana.getByText("Отговориха 1 от 2. Чакаме Боян.")).toBeVisible();
  await expect(bo.getByText("Отговориха 1 от 2.", { exact: true })).toBeVisible();
  await answer(bo);
  // The same answer from both: each answer's count in the room (where there are answers to count), and its word.
  await expect(host.locator(".host-reveal")).toBeVisible();
  for (const page of [host, ana, bo]) {
    await expect(page.locator(".room-knew")).toHaveText(/^(Всички познаха|Никой не позна)\.$/);
    const counts = page.locator(".crowd-share");
    if (await counts.count()) await expect(counts.first()).toHaveText("2");
  }
});

test("a big screen shows a question and its answer whole, the controls in sight, at any size", async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
  await leadRoom(host);
  await host.getByRole("button", { name: "Започни" }).click();
  const still = async () => {
    await expect(host.getByRole("button", { name: "Напред" })).toBeInViewport({ ratio: 1 });
    await expect(host.getByRole("button", { name: "Приключи" })).toBeInViewport({ ratio: 1 });
    expect(await host.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0);
  };
  const sizes = [
    [1024, 768],
    [1280, 800],
    [1366, 768],
    [1920, 1080],
  ] as const;
  for (const [n, [width, height]] of sizes.entries()) {
    await host.setViewportSize({ width, height });
    await expect(host.locator(".host-ask .question-head")).toContainText(`${n + 1} от 5`);
    await still();
    await host.keyboard.press("ArrowRight");
    await expect(host.locator(".host-reveal")).toBeVisible();
    await still();
    await host.keyboard.press(" ");
  }
  await expect(host.locator(".host-ask .question-head")).toContainText("5 от 5");
  await host.getByRole("button", { name: "Приключи" }).click();
  await host.getByRole("button", { name: "Да, приключи" }).click();
  await expect(host.getByRole("button", { name: "Започни нова игра" })).toBeInViewport();
});

test("a big screen shows the room alone: none of the host's own notices, and a match's right pairs whole", async ({
  browser,
}) => {
  const host = await (await browser.newContext({ viewport: { width: 1366, height: 650 } })).newPage();
  // A friend has challenged the host: the notice is on every page of theirs, but never on the room's big screen.
  await host.route("**/api/friends/invites", (route) =>
    route.fulfill({
      json: { requests: 0, challenges: [{ id: 999_999, from: "Петя Стоянова", expiresAt: Date.now() + 3_600_000 }] },
    }),
  );
  const code = await leadRoom(host);
  await host.goto("/");
  await expect(host.locator(".challenge-notice")).toContainText("Петя Стоянова те предизвика");
  await host.goto(`/r/${code}`);
  await expect(host.getByText("Още никой не е влязъл.")).toBeVisible();
  await expect(host.locator(".challenge-notice")).toBeHidden();

  // A pairs question's answer, as the room has it (its stream, played back): the host gave none, so each right pair
  // shows plain, as the right one, never as the host's miss; and its fact whole above the controls.
  const view = {
    code,
    phase: "reveal",
    host: "",
    isHost: true,
    canLead: true,
    lead: true,
    held: true,
    category: "science",
    length: 5,
    mix: "mixed",
    n: 5,
    total: 10,
    players: [
      { key: 1, name: "Капитанът", points: 800, rights: 1, online: true, answered: true, place: 1, gained: 800 },
      { key: 2, name: "Ралица Христозова", points: 0, rights: 0, online: true, answered: true, place: 2 },
    ],
    question: {
      category: "science",
      limitMs: 30_000,
      leftMs: 0,
      view: {
        type: "match",
        text: "Свържи химичния елемент с групата, към която спада:",
        left: ["Калций", "Неон", "Флуор", "Натрий"],
        right: ["Алкалоземен метал", "Благороден газ", "Халоген", "Алкален метал", "Преходен метал"],
      },
      reveal: {
        answer: {
          id: "x",
          pairs: [0, 1, 2, 3],
          decoy: 4,
          fact: "Алкалните метали реагират с вода толкова бурно, че натрият се пази под керосин.",
        },
        points: 0,
        right: false,
      },
    },
  };
  await host.route(`**/api/rooms/${code}/events`, (route) =>
    route.fulfill({ contentType: "text/event-stream", body: `retry: 600000\ndata: ${JSON.stringify(view)}\n\n` }),
  );
  await host.reload();
  const pairs = host.locator(".host-reveal .match-result .option");
  await expect(pairs).toHaveCount(4);
  await expect(host.locator(".host-reveal .match-result .option.right")).toHaveCount(4);
  await expect(host.locator(".host-reveal .match-gave")).toHaveCount(0);
  const fact = host.locator(".host-reveal .fact");
  await expect(fact).toBeInViewport({ ratio: 1 });
  const [factBottom, footTop] = await Promise.all([
    fact.evaluate((e) => e.getBoundingClientRect().bottom),
    host.locator(".host-foot").evaluate((e) => e.getBoundingClientRect().top),
  ]);
  expect(factBottom, "the fact ends above the controls").toBeLessThanOrEqual(footTop);
  expect(
    await host.locator(".host-stage").evaluate((e) => e.scrollHeight - e.clientHeight),
    "nothing hidden in the stage",
  ).toBeLessThanOrEqual(0);
  await expect(host.locator(".challenge-notice")).toBeHidden();
});
