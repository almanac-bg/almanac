// Sharing the day: the share sheet where there is one, else the text copied, else the text to copy by hand; the link
// asked for once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { shareDay } from "./share.ts";

(globalThis as { location?: unknown }).location = { pathname: "/" };

const text = "Алманах, брой 9 · 20 ноември\n7 от 10 ■■■□■■■□■□\nalmanac.bg/d/9-k4f2m7qa";

/** The server, giving the text; what was asked of it. */
function serve(): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (path: string, init: RequestInit) => {
    asked.push(`${init.method} ${path}`);
    return new Response(JSON.stringify({ text, url: "https://almanac.bg/d/9-k4f2m7qa" }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return asked;
}

/** A browser that can share (`share`: what its sheet does) and copy (`copy`: what writing to the clipboard does). */
function browser(share?: (data: ShareData) => Promise<void>, copy?: (t: string) => Promise<void>): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { share, clipboard: { writeText: copy ?? (() => Promise.reject(new Error("no"))) } },
  });
}

test("shared with the sheet where there is one, the text asked for once", async () => {
  const asked = serve();
  const sent: ShareData[] = [];
  browser(async (d) => void sent.push(d));
  assert.equal(await shareDay(1), "shared");
  assert.equal(await shareDay(1), "shared");
  assert.deepEqual(sent, [{ text }, { text }]);
  assert.deepEqual(asked, ["POST /api/runs/1/share"]);
});

test("the sheet closed without a choice is nothing; refused, the text is copied", async () => {
  serve();
  const abort = Object.assign(new Error("closed"), { name: "AbortError" });
  const copied: string[] = [];
  browser(
    () => Promise.reject(abort),
    async (t) => void copied.push(t),
  );
  assert.equal(await shareDay(2), "cancelled");
  assert.equal(copied.length, 0);
  const refused = Object.assign(new Error("no"), { name: "NotAllowedError" });
  browser(
    () => Promise.reject(refused),
    async (t) => void copied.push(t),
  );
  assert.equal(await shareDay(2), "copied");
  assert.deepEqual(copied, [text]);
});

test("without a sheet the text is copied, and where it can't be, given to copy by hand", async () => {
  serve();
  const copied: string[] = [];
  browser(undefined, async (t) => void copied.push(t));
  assert.equal(await shareDay(3), "copied");
  assert.deepEqual(copied, [text]);
  browser();
  assert.deepEqual(await shareDay(3), { text });
});
