// Sharing the day's result (server/share.go, play/share.go): its issue, the score and its tiles, never an answer, and
// the link that brings whoever opens it to the same ten: „Брой 42 · 8/10 · 23 дни“, the tiles as squares (■ right,
// ◧ близо, □ not), the link. The link is made as the day is first shared (the server's), and kept for the page's life,
// so a second tap shares at once; where there's no sheet, the text is copied. The card (game/card.ts), drawn here as
// it's shared, goes on its own, where the device's share sheet takes a picture: never with the text, which an app
// given both may drop, link and all. What it looks like is the screen's: this is
// only what it does, for any screen to use.

import { api } from "../lib/api.ts";
import type { Mark } from "./types.ts";

/** How sharing went: sent on (or at least the share sheet closed with a choice), copied, given up (the sheet closed
 * without one), or neither possible: the text, for the player to copy by hand. */
export type Shared = "shared" | "copied" | "cancelled" | { text: string };

/** A finished day as it's shared: its issue, how many were right of how many count, the streak with it, and how each
 * question went. */
export interface SharedDay {
  issue: number;
  rights: number;
  of: number;
  streak: number;
  marks: Mark[];
}

/** The day's tiles as text: ■ right, ◧ близо, □ not; a question that counts for nobody has no place. */
export function squares(marks: Mark[]): string {
  return marks
    .filter((m) => !m.void)
    .map((m) => (m.right ? "■" : m.close ? "◧" : "□"))
    .join("");
}

/** The text a day is shared with: „Брой 42 · 8/10 · 23 дни“ (the streak from three days), its squares, and the link
 * (`url`, said without its scheme). Unsigned: nothing in it says whose it is. */
export function shareWords(d: SharedDay, url: string): string {
  const streak = d.streak >= 3 ? ` · ${d.streak} дни` : "";
  return `Брой ${d.issue} · ${d.rights}/${d.of}${streak}\n${squares(d.marks)}\n${url.replace(/^https?:\/\//, "")}`;
}

const links = new Map<number, Promise<string>>();

/** The link of a finished day of the player's (`run`), made the first time it's asked for. */
export function shareLink(run: number): Promise<string> {
  let link = links.get(run);
  if (!link) {
    link = api<{ url: string }>("POST", `/api/runs/${run}/share`).then((r) => r.url);
    links.set(run, link);
    link.catch(() => links.delete(run)); // asked again next time
  }
  return link;
}

/** The text a finished day is shared with, its link made the first time. */
export async function shareText(run: number, d: SharedDay): Promise<string> {
  return shareWords(d, await shareLink(run));
}

/** Shares a finished day (`run`): its text with the link, with the device's share sheet where there is one, else by
 * copying it. Never with the card: an app given both may keep only the picture and lose the link (WhatsApp on an
 * iPhone); the card goes on its own (shareCard). The link is asked for first, so the sheet opens a moment after the
 * tap, which every browser allows (its five seconds). */
export async function shareDay(run: number, d: SharedDay): Promise<Shared> {
  const text = await shareText(run, d);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return "cancelled";
      // Refused (the tap too long ago, a browser that won't): copied instead.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return { text };
  }
}

/** Shares the day's card on its own (game/card.ts: almanac.bg on it), where the device's share sheet takes a picture:
 * "cancelled" where it was closed without a choice, or it couldn't. */
export async function shareCard(card: File): Promise<"shared" | "cancelled"> {
  if (typeof navigator.share !== "function" || !navigator.canShare?.({ files: [card] })) return "cancelled";
  try {
    await navigator.share({ files: [card] });
    return "shared";
  } catch {
    return "cancelled";
  }
}
