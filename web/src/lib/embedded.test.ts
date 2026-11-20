import assert from "node:assert/strict";
import { test } from "node:test";
import { embeddedBrowser, handToken, outsideLink } from "./embedded.ts";

const android = "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko)";
const chrome =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const safari = `${iphone} Version/18.1 Mobile/15E148 Safari/604.1`;

test("an app's own browser is told by its user agent, by name where it says one", () => {
  assert.deepEqual(
    embeddedBrowser(`${android} Version/4.0 Chrome/130 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480]`),
    { app: "Messenger", platform: "android", forms: false },
  );
  assert.deepEqual(embeddedBrowser(`${iphone} Mobile/15E148 [FBAN/FBIOS;FBAV/490.0]`), {
    app: "Facebook",
    platform: "ios",
    forms: false,
  });
  assert.deepEqual(embeddedBrowser(`${iphone} Mobile/15E148 Instagram 350.0.0`), {
    app: "Instagram",
    platform: "ios",
    forms: false,
  });
  assert.deepEqual(embeddedBrowser(`${android} Chrome/130 Mobile Safari/537.36 Viber/24.1`), {
    app: "Viber",
    platform: "android",
    forms: true,
  });
  // Unnamed: Android's web view, an iPhone's without "Safari".
  assert.deepEqual(embeddedBrowser(`${android} Chrome/130 Mobile Safari/537.36`), {
    app: "",
    platform: "android",
    forms: true,
  });
  assert.deepEqual(embeddedBrowser(`${iphone} Mobile/15E148`), { app: "", platform: "ios", forms: true });
});

test("no email or code is asked for in Meta's apps' browsers nor TikTok's", () => {
  for (const ua of [
    `${android} Chrome/130 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480]`,
    `${iphone} Mobile/15E148 [FBAN/MessengerForiOS;FBAV/300]`,
    `${iphone} Mobile/15E148 Instagram 350.0.0`,
    `${iphone} Mobile/15E148 Barcelona 350.0.0`,
    `${android} Chrome/130 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview/d8a21c6`,
    `${iphone} Mobile/15E148 TikTok 35.0`,
  ])
    assert.equal(embeddedBrowser(ua)?.forms, false, ua);
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

test("on Android the way out is an intent for the phone's browser, the address whole with its fragment", () => {
  const token = "abc_DEF-1".padEnd(43, "x");
  assert.equal(
    outsideLink(`https://almanac.bg/#hand=${token}`),
    `intent://almanac.bg/#hand=${token}#Intent;scheme=https;action=android.intent.action.VIEW;end`,
  );
  assert.equal(
    outsideLink("https://almanac.bg/"),
    "intent://almanac.bg/#Intent;scheme=https;action=android.intent.action.VIEW;end",
  );
});

test("the Handoff's token is read from the fragment only, as the server makes it", () => {
  const token = `${"A".repeat(42)}_`;
  assert.equal(handToken(`#hand=${token}`), token);
  assert.equal(handToken(""), null);
  assert.equal(handToken(`#hand=${token}x`), null);
  assert.equal(handToken("#hand=../../evil"), null);
  assert.equal(handToken(`#players=${token}`), null);
});
