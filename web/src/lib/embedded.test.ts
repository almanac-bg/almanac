import assert from "node:assert/strict";
import { test } from "node:test";
import { embeddedBrowser, outsideLink } from "./embedded.ts";

const android = "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko)";
const chrome =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const safari = `${iphone} Version/18.1 Mobile/15E148 Safari/604.1`;

test("an app's own browser is told by its user agent, by name where it says one", () => {
  assert.deepEqual(
    embeddedBrowser(`${android} Version/4.0 Chrome/130 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480]`),
    {
      app: "Messenger",
      platform: "android",
    },
  );
  assert.deepEqual(embeddedBrowser(`${iphone} Mobile/15E148 [FBAN/FBIOS;FBAV/490.0]`), {
    app: "Facebook",
    platform: "ios",
  });
  assert.deepEqual(embeddedBrowser(`${iphone} Mobile/15E148 Instagram 350.0.0`), { app: "Instagram", platform: "ios" });
  assert.deepEqual(embeddedBrowser(`${android} Chrome/130 Mobile Safari/537.36 Viber/24.1`), {
    app: "Viber",
    platform: "android",
  });
  // Unnamed: Android's web view, an iPhone's without "Safari".
  assert.deepEqual(embeddedBrowser(`${android} Chrome/130 Mobile Safari/537.36`), { app: "", platform: "android" });
  assert.deepEqual(embeddedBrowser(`${iphone} Mobile/15E148`), { app: "", platform: "ios" });
});

test("a browser of its own, the home screen and the game's app are not", () => {
  assert.equal(embeddedBrowser(chrome), null);
  assert.equal(embeddedBrowser(safari), null);
  assert.equal(embeddedBrowser(`${iphone} CriOS/130 Mobile/15E148 Safari/604.1`), null);
  assert.equal(embeddedBrowser(`${iphone} Mobile/15E148`, true), null); // added to the home screen
  assert.equal(
    embeddedBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) AppleWebKit/605.1.15 Safari/605.1.15"),
    null,
  );
});

test("on Android the way out is an intent for the phone's browser", () => {
  assert.equal(
    outsideLink("https://almanac.bg/hand/abc_DEF-1"),
    "intent://almanac.bg/hand/abc_DEF-1#Intent;scheme=https;action=android.intent.action.VIEW;end",
  );
});
