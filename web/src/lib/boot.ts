// What the server puts in the page for it to start with (server/pages.go): read once, here. state.ts gives the app its
// parts; the version is the one the page was loaded with, told with its errors (errors.ts) and held against the
// server's (fresh.ts).

export interface Boot {
  user: import("../state.ts").User | null;
  categories: import("../state.ts").Category[];
  bulgaria?: boolean;
  version: string;
  push: string;
  outcomeCss: string;
  /** The server's clock as it drew the page (lib/api.ts holds the page's clock to it until an answer comes). */
  now: number;
  /** Начало's day, in its page only (GET /api/day's answer: screens/today.ts draws it at once, the first time). */
  day?: unknown;
  /** Which of the game's systems the player has met (play/unfold.go): none before a first game. */
  open?: import("../ui.ts").Open;
}

export const boot: Partial<Boot> =
  typeof document === "undefined" ? {} : JSON.parse(document.getElementById("boot")?.textContent || "{}");

/** The game's version this page was loaded with. */
export const version = boot.version ?? "";
