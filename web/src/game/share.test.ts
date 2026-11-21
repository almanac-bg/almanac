// Sharing the day: the share sheet where there is one (with the card where it takes a picture), else the text copied,
// else the text to copy by hand; the link asked for once; the text the issue, the score, the streak and the tiles.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type SharedDay, shareCard, shareDay, shareWords, squares } from "./share.ts";

(globalThis as { location?: unknown }).location = { pathname: "/" };

const day: SharedDay = {
  issue: 9,
  rights: 7,
  of: 10,
  streak: 23,
  marks: [
    { right: true },
    { right: true },
    { right: false, close: true },
    { right: true },
    { right: false },
    { right: true },
    { right: true },
    { right: false },
    { right: true },
    { right: true },
  ],
};
const text = "Брой 9 · 7/10 · серия 23 дни\n■■◧■□■■□■■\nhttps://almanac.bg/d/9-k4f2m7qa";

/** The server, giving the link; what was asked of it. */
function serve(): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (path: string, init: RequestInit) => {
    asked.push(`${init.method} ${path}`);
    return new Response(JSON.stringify({ text: "the server's", url: "https://almanac.bg/d/9-k4f2m7qa" }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return asked;
}

/** A browser that can share (`share`: what its sheet does; `files`: whether it takes a picture) and copy (`copy`). */
function browser(share?: (data: ShareData) => Promise<void>, copy?: (t: string) => Promise<void>, files = false): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      share,
      canShare: (d: ShareData) => files || !d.files,
      clipboard: { writeText: copy ?? (() => Promise.reject(new Error("no"))) },
    },
  });
}

test("the text: the issue, the score, the streak from three days, the tiles, the link whole (its scheme too: every messenger links it)", () => {
  assert.equal(shareWords(day, "https://almanac.bg/d/9-k4f2m7qa"), text);
  assert.equal(shareWords({ ...day, streak: 2 }, "https://almanac.bg/d/9-x").split("\n")[0], "Брой 9 · 7/10");
  assert.equal(squares([{ right: true }, { right: false, void: true }, { right: false }]), "■□");
});

test("shared with the sheet where there is one, the link asked for once", async () => {
  const asked = serve();
  const sent: ShareData[] = [];
  browser(async (d) => void sent.push(d));
  assert.equal(await shareDay(1, day), "shared");
  assert.equal(await shareDay(1, day), "shared");
  assert.deepEqual(sent, [{ text }, { text }]);
  assert.deepEqual(asked, ["POST /api/runs/1/share"]);
});

test("the text never goes with the card (an app given both may drop the link); the card goes alone, where it can", async () => {
  serve();
  const card = new File(["png"], "almanah.png", { type: "image/png" });
  const sent: ShareData[] = [];
  browser(async (d) => void sent.push(d), undefined, true);
  await shareDay(4, day);
  assert.equal(await shareCard(card), "shared");
  browser(async (d) => void sent.push(d), undefined, false);
  assert.equal(await shareCard(card), "cancelled");
  assert.deepEqual(sent, [{ text }, { files: [card] }]);
});

test("the sheet closed without a choice is nothing; refused, the text is copied", async () => {
  serve();
  const abort = Object.assign(new Error("closed"), { name: "AbortError" });
  const copied: string[] = [];
  browser(
    () => Promise.reject(abort),
    async (t) => void copied.push(t),
  );
  assert.equal(await shareDay(2, day), "cancelled");
  assert.equal(copied.length, 0);
  const refused = Object.assign(new Error("no"), { name: "NotAllowedError" });
  browser(
    () => Promise.reject(refused),
    async (t) => void copied.push(t),
  );
  assert.equal(await shareDay(2, day), "copied");
  assert.deepEqual(copied, [text]);
});

test("without a sheet the text is copied, and where it can't be, given to copy by hand", async () => {
  serve();
  const copied: string[] = [];
  browser(undefined, async (t) => void copied.push(t));
  assert.equal(await shareDay(3, day), "copied");
  assert.deepEqual(copied, [text]);
  browser();
  assert.deepEqual(await shareDay(3, day), { text });
});
