// An app's own browser (Messenger, Facebook, Instagram, Viber, TikTok …): where a shared link opens on a phone. A
// guest's game lives in the browser it began in, and that one keeps it from the phone's browser: tomorrow, opened
// from anywhere else, it would start from nothing. Here the game asks at once to keep it, and offers the way out: on
// Android a link that opens the phone's browser, on an iPhone (where no link can) a link to copy into Safari. Either
// carries the game (account.Handoff). Pure, so that it's tested on its own; the game's own app is never one.

export interface Embedded {
  /** The app's name, where its browser says it ("": an app that doesn't). */
  app: string;
  platform: "android" | "ios" | "other";
}

/** The apps whose browsers say who they are, by a word in the user agent. */
const known: [RegExp, string][] = [
  [/FBAN\/Messenger|FB_IAB\/Orca|MessengerForiOS|MessengerLite/i, "Messenger"],
  [/FBAN|FBAV|FB_IAB|FBIOS/, "Facebook"],
  [/Instagram/, "Instagram"],
  [/Viber/i, "Viber"],
  [/musical_ly|BytedanceWebview|TikTok/i, "TikTok"],
  [/Snapchat/, "Snapchat"],
  [/LinkedInApp/, "LinkedIn"],
  [/Telegram/i, "Telegram"],
  [/MicroMessenger/, "WeChat"],
  [/\bLine\//, "LINE"],
  [/Pinterest/, ""],
  [/Twitter/, ""],
];

/** Whether `ua` is an app's own browser, and which. `standalone`: the page is on the home screen (an iPhone's web app
 * says no "Safari" in its user agent either). */
export function embeddedBrowser(ua: string, standalone = false): Embedded | null {
  const platform = /Android/.test(ua) ? "android" : /iPhone|iPad|iPod/.test(ua) ? "ios" : "other";
  for (const [word, app] of known) if (word.test(ua)) return { app, platform };
  // Unnamed: Android's web view says "wv"; an iPhone's says no "Safari" (every browser there does, Chrome too).
  if (platform === "android" && /; wv\)/.test(ua)) return { app: "", platform };
  if (platform === "ios" && !standalone && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)) return { app: "", platform };
  return null;
}

/** The link that opens `url` in the phone's browser from an app's own, on Android: an intent for whatever browser
 * the phone opens web pages with. No fallback: opened here, it would only take its own game back. */
export function outsideLink(url: string): string {
  const u = new URL(url);
  const scheme = u.protocol.replace(":", "");
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end`;
}

const standalone =
  typeof navigator !== "undefined" &&
  ((navigator as { standalone?: boolean }).standalone === true ||
    (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches));

/** This page's app browser, if it's in one. */
export const embedded: Embedded | null =
  typeof navigator === "undefined" ? null : embeddedBrowser(navigator.userAgent, standalone);
