// What the server puts in the page for it to start with (server/pages.go): read once, here. state.ts gives the app its
// parts; the version is the one the page was loaded with, told with its errors (errors.ts) and held against the
// server's (fresh.ts).

export interface Boot {
  user: import("../state.ts").User | null;
  /** The player's avatar ("shape-tone"), with the player. */
  avatar?: string;
  /** The seal the player wears (play.SealOf), with the player once they have a rank. */
  seal?: { chapter: string; level: number };
  categories: import("../state.ts").Category[];
  bulgaria?: boolean;
  version: string;
  push: string;
  outcomeCss: string;
  /** The server's clock as it drew the page (lib/api.ts holds the page's clock to it until an answer comes). */
  now: number;
  /** Начало's day, in its page only (GET /api/day's answer: screens/today.ts draws it at once, the first time); and in a
   * shared day's link's, which opens Начало. */
  day?: unknown;
  /** The day a shared day's link shares (server/share.go), in its page only. */
  shared?: unknown;
  /** The invite an invite link's page opens (server/invite.go), or `{ gone: true }` for a link that isn't one: in its
   * page only. */
  invite?: unknown;
}

export const boot: Partial<Boot> =
  typeof document === "undefined" ? {} : JSON.parse(document.getElementById("boot")?.textContent || "{}");

/** The game's version this page was loaded with. */
export const version = boot.version ?? "";
