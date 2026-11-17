// What the server puts in the page for it to start with (server/pages.go): read once, here. state.ts gives the app its
// parts; the version is the one the page was loaded with, told with its errors (errors.ts) and held against the
// server's (fresh.ts).

export interface Boot {
  user: import("../state.ts").User | null;
  categories: import("../state.ts").Category[];
  bulgaria?: boolean;
  version: string;
  push: string;
  phones: string[] | null;
  hostCss: string;
  outcomeCss: string;
}

export const boot: Partial<Boot> =
  typeof document === "undefined" ? {} : JSON.parse(document.getElementById("boot")?.textContent || "{}");

/** The game's version this page was loaded with. */
export const version = boot.version ?? "";
