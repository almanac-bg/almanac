// An app's own browser (Messenger, Facebook, Instagram, Viber, TikTok …): where a shared link opens on a phone. A
// guest's game lives in the browser it began in, and that one keeps it from the phone's browser: tomorrow, opened
// from anywhere else, it would start from nothing. Here the game offers the way out with the game (account.Handoff,
// screens/keep.ts): on Android a link that opens the phone's browser, on an iPhone (where no link can) the app's own
// menu, named. Meta's and TikTok's browsers are told apart (forms): they can read what's typed into a page, so no
// email or code is ever asked for in them. Pure, so that it's tested on its own; the game's own app is never one.

export interface Embedded {
  /** The app's name, where its browser says it ("": an app that doesn't). */
  app: string;
  platform: "android" | "ios" | "other";
  /** Whether an email or a code may be asked for here: never in Meta's apps (Facebook, Instagram, Messenger,
   * Threads) nor TikTok's, whose browsers can read what's typed into a page. */
  forms: boolean;
}

/** The apps whose browsers say who they are, by a word in the user agent, and whether forms are shown in them. */
const known: [RegExp, string, boolean][] = [
  [/FBAN\/Messenger|FB_IAB\/Orca|MessengerForiOS|MessengerLite/i, "Messenger", false],
  [/Barcelona/, "Threads", false],
  [/FBAN|FBAV|FB_IAB|FBIOS/, "Facebook", false],
  [/Instagram/, "Instagram", false],
  [/Viber/i, "Viber", true],
  [/musical_ly|BytedanceWebview|TikTok|trill_/i, "TikTok", false],
  [/Snapchat/, "Snapchat", true],
  [/LinkedInApp/, "LinkedIn", true],
  [/Telegram/i, "Telegram", true],
  [/MicroMessenger/, "WeChat", true],
  [/\bLine\//, "LINE", true],
  [/Pinterest/, "", true],
  [/Twitter/, "", true],
];

/** Whether `ua` is an app's own browser, and which. `standalone`: the page is on the home screen (an iPhone's web app
 * says no "Safari" in its user agent either). */
export function embeddedBrowser(ua: string, standalone = false): Embedded | null {
  const platform = /Android/.test(ua) ? "android" : /iPhone|iPad|iPod/.test(ua) ? "ios" : "other";
  for (const [word, app, forms] of known) if (word.test(ua)) return { app, platform, forms };
  // Unnamed: Android's web view says "wv"; an iPhone's says no "Safari" (every browser there does, Chrome too).
  if (platform === "android" && /; wv\)/.test(ua)) return { app: "", platform, forms: true };
  if (platform === "ios" && !standalone && /AppleWebKit/.test(ua) && !/Safari\//.test(ua))
    return { app: "", platform, forms: true };
  return null;
}

/** The link that opens `url` in the phone's browser from an app's own, on Android: an intent for whatever browser
 * the phone opens web pages with, the address whole (its fragment, the Handoff's token, too: Android reads the intent
 * from the last „#“). No fallback: opened here, it would only take its own game back. */
export function outsideLink(url: string): string {
  const u = new URL(url);
  const scheme = u.protocol.replace(":", "");
  return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end`;
}

/** The fragment of Днес's address that carries a Handoff's token (account.Handoff): the app's „Open in browser“ takes
 * the address whole, and a fragment never reaches a server, nor a link's preview. */
export const handMark = "#hand=";

/** The Handoff's token in an address's fragment (`hash`), if it has one. */
export function handToken(hash: string): string | null {
  if (!hash.startsWith(handMark)) return null;
  const token = hash.slice(handMark.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

const standalone =
  typeof navigator !== "undefined" &&
  ((navigator as { standalone?: boolean }).standalone === true ||
    (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches));

/** This page's app browser, if it's in one. */
export const embedded: Embedded | null =
  typeof navigator === "undefined" ? null : embeddedBrowser(navigator.userAgent, standalone);
