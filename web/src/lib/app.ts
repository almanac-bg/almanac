// The game inside its own app on phones (mobile/): the same pages, in the phone's web view, with the app's bridge
// (Capacitor) on the page before the game starts. Through it the game reaches what a page alone can't: the phone's
// notifications (push.ts), its share sheet, its touch (an answer felt), the back button on Android, and links to the
// game opened in the app. All of that is in phone.ts, loaded only in the app; in a browser nothing here does anything.

import { tally } from "./api.ts";

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
export function startApp(go: (path: string) => void): void {
  if (inApp)
    phone().then(
      (p) => p.start(go, (kind) => tally(`push:open:${kind}`)),
      () => {},
    );
}

/** Shares through the app's share sheet: false where there's no app. */
export async function appShare(text: string, url?: string): Promise<boolean> {
  if (!inApp) return false;
  await (await phone()).share(text, url);
  return true;
}

/** An answer, felt (in the app only: a page can't on an iPhone, and a phone's browser buzzes rather than knocks). */
export function feel(kind: "exact" | "right" | "partial" | "wrong" | "time"): void {
  if (inApp)
    phone().then(
      (p) => p.feel(kind),
      () => {},
    );
}
