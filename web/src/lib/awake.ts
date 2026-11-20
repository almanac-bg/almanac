// Keeping the screen on while a live game needs it (Роял's lobby and game, a live duel): a phone
// that falls asleep drops the stream, and with it the player. The browser lets the lock go when the page is hidden, so
// it's asked for again once the page shows; a browser that has no lock, or refuses it (a low battery), is let be.

import { effect, onCleanup } from "./dom.ts";

/** Keeps the screen on while on() holds, in the current scope; let go as it ends. */
export function keepAwake(on: () => boolean): void {
  if (!("wakeLock" in navigator)) return;
  const wake = navigator.wakeLock;
  let lock: WakeLockSentinel | null = null;
  let wanted = false;
  const take = () => {
    if (!wanted || lock || document.visibilityState !== "visible") return;
    wake.request("screen").then(
      (l) => {
        if (!wanted) {
          l.release().catch(() => {});
          return;
        }
        lock = l;
        l.addEventListener("release", () => {
          if (lock === l) lock = null;
        });
      },
      () => {}, // refused: the game goes on, the screen may sleep
    );
  };
  const free = () => {
    lock?.release().catch(() => {});
    lock = null;
  };
  effect(() => {
    wanted = on();
    if (wanted) take();
    else free();
  });
  document.addEventListener("visibilitychange", take);
  onCleanup(() => {
    wanted = false;
    document.removeEventListener("visibilitychange", take);
    free();
  });
}
