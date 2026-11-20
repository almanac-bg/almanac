// Sharing the day's result (server/share.go, play/share.go): the text the server writes for a finished day — its
// issue, the score and its shape in squares, never an answer, and the link that brings whoever opens it to the same
// ten — sent with the device's own share sheet where there is one (the Web Share API), else copied. The link is made
// as the day is first shared; its text is kept for the page's life, so a second tap shares at once. What it looks like
// is the screen's: this is only what it does, for any screen to use.

import { api } from "../lib/api.ts";

/** How sharing went: sent on (or at least the share sheet closed with a choice), copied, given up (the sheet closed
 * without one), or neither possible: the text, for the player to copy by hand. */
export type Shared = "shared" | "copied" | "cancelled" | { text: string };

const texts = new Map<number, Promise<string>>();

/** The text a finished day of the player's (`run`) is shared with, its link made the first time. */
export function shareText(run: number): Promise<string> {
  let text = texts.get(run);
  if (!text) {
    text = api<{ text: string }>("POST", `/api/runs/${run}/share`).then((r) => r.text);
    texts.set(run, text);
    text.catch(() => texts.delete(run)); // asked again next time
  }
  return text;
}

/** Shares a finished day (`run`): with the device's share sheet where there is one, else by copying its text. The
 * text is asked for first, so the sheet opens a moment after the tap, which every browser allows (its five seconds). */
export async function shareDay(run: number): Promise<Shared> {
  const text = await shareText(run);
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
