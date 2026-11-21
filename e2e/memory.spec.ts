import { expect, test } from "@playwright/test";
import { answer, moveOn, startDay } from "./play.ts";

// A question gone is gone from memory too: nothing keeps it once the next one shows (an animation left on the
// document's timeline kept each question's whole page to the run's end). Chromium only: its own protocol lists what's
// cut off from the page but kept.
test("a question that's over isn't kept in memory", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the browser's own protocol, Chromium's");
  await page.goto("/");
  await startDay(page);
  for (let n = 0; n < 3; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await answer(page);
    await moveOn(page);
  }
  await expect(page.locator(".question-head")).toContainText("4 от 10", { timeout: 10_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("DOM.enable");
  await cdp.send("DOM.getDocument", { depth: -1 });
  const { detachedNodes } = await cdp.send("DOM.getDetachedDomNodes");
  const kept = detachedNodes
    .map((d) => d.treeNode)
    .filter((n) => n.nodeName === "ARTICLE")
    .map((n) => n.attributes?.join(" "));
  expect(kept).toEqual([]);
  await cdp.detach();
});
