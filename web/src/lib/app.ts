// The game inside its own app on phones (mobile/): the same pages, in the phone's web view, with the app's bridge
// (Capacitor) on the page before the game starts. Through it the game reaches what a page alone can't: the phone's
// notifications (push.ts), its share sheet, its touch (answers and rewards felt), the back button on Android, and links to the
// game opened in the app. All of that is in phone.ts, loaded only in the app; in a browser nothing here does anything.

import { tally } from "./api.ts";
import { setSystemText, vibrateOn } from "./prefs.ts";

const bridge = (globalThis as { Capacitor?: { isNativePlatform(): boolean; getPlatform(): string } }).Capacitor;

/** Whether the game is in its app. */
export const inApp = !!bridge?.isNativePlatform();

/** The app's platform: "ios", "android", or "web" in a browser. */
export const platform = inApp && bridge ? bridge.getPlatform() : "web";

let loading: Promise<typeof import("./phone.ts")> | null = null;

/** What the app does (phone.ts), loaded once, the first time it's needed. */
export const phone = () => {
  loading ??= import("./phone.ts");
  return loading;
};

/** Starts what the app adds to the game (notifications and links that open a page, the back button). A notification
 * tapped is counted by its kind. */
export function startApp(nav: import("./phone.ts").Nav): void {
  if (platform === "ios") followPhoneText();
  if (inApp)
    phone().then(
      (p) => p.start(nav, (kind) => tally(`push:open:${kind}`)),
      () => {},
    );
}

/** The size the phone gives body text at its usual setting (iOS's Large). */
const iosBody = 17;

/** An iPhone's web view keeps a page's text at its own size whatever the phone's text size (Settings → Display &
 * Brightness → Text Size, and Accessibility's larger sizes). The page asks WebKit for the size the phone gives body
 * text now (-apple-system-body) and sizes itself by it (prefs.ts, at most twice the usual, with the player's own step
 * on top), again each time the app comes to the front: the size is changed in the phone's settings, away from the
 * app. Android's web view follows the phone's size by itself. */
function followPhoneText(): void {
  const probe = document.createElement("span");
  probe.style.font = "-apple-system-body";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  const measure = () => {
    document.body.append(probe);
    const px = Number.parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    if (px > 0) setSystemText(phoneScale(px));
  };
  measure();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") measure();
  });
}

/** The phone's body text size as a share of its usual, from a little smaller (its smallest sizes) to twice. */
export function phoneScale(px: number): number {
  return Math.min(2, Math.max(0.8, px / iosBody));
}

/** Shares through the app's share sheet: "shared", or "closed" when the player closed it without sharing; null where
 * there's no app. */
export async function appShare(text: string, url?: string): Promise<"shared" | "closed" | null> {
  if (!inApp) return null;
  return (await (await phone()).share(text, url)) ? "shared" : "closed";
}

/** What the player feels (phone.ts says how each is felt): in the app only (a page can't on an iPhone, and a phone's
 * browser buzzes rather than knocks), and while „Вибрация“ is on. */
export function haptic(kind: Haptic): void {
  if (inApp && vibrateOn.peek())
    phone().then(
      (p) => p.haptic(kind),
      () => {},
    );
}

export type Haptic = Parameters<typeof import("./phone.ts").haptic>[0];
