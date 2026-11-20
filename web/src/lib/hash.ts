// Класации' board in the page's address, after the #: which board, among whom, and (for knowledge) which topic, so
// that back to the page, a reload or a link opens the same one. „#friends“ (the day's, among friends),
// „#knowledge/friends“, „#knowledge/history“; nothing for the day's board of everyone.

export type By = "day" | "knowledge";

export interface Board {
  by: By;
  friends: boolean;
  topic: string;
}

const boards: By[] = ["day", "knowledge"];

/** The board an address's hash names (`topics`: the topics there are); the day's of everyone for one it doesn't. */
export function readBoard(hash: string, topics: string[]): Board {
  const parts = hash.replace(/^#/, "").split("/").filter(Boolean);
  const by = boards.find((b) => parts.includes(b)) ?? "day";
  return {
    by,
    friends: parts.includes("friends"),
    topic: by === "knowledge" ? (parts.find((p) => topics.includes(p)) ?? "") : "",
  };
}

/** The hash for a board ("" for the day's of everyone). */
export function boardHash(b: Board): string {
  const parts = [b.by === "day" ? "" : b.by, b.friends ? "friends" : "", b.by === "knowledge" ? b.topic : ""];
  const s = parts.filter(Boolean).join("/");
  return s ? `#${s}` : "";
}
