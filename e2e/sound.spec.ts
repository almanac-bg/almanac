import { expect, test } from "@playwright/test";
import { answer } from "./play.ts";

// The game's sounds start with the player's first tap, and come back after the game has been in the background.
test("sounds start with a tap and come back from the background", async ({ page }) => {
  // The audio, watched: its contexts, and every tone started.
  await page.addInitScript(() => {
    const w = window as unknown as { contexts: AudioContext[]; tones: number };
    w.contexts = [];
    w.tones = 0;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        w.contexts.push(this);
      }
      override createOscillator(): OscillatorNode {
        w.tones++;
        return super.createOscillator();
      }
    };
  });
  const audio = () =>
    page.evaluate(() => {
      const w = window as unknown as { contexts: AudioContext[]; tones: number };
      return { contexts: w.contexts.length, state: w.contexts[0]?.state, tones: w.tones };
    });
  await page.goto("/");
  // Nothing sounds, nor is started, before a touch.
  expect(await audio()).toEqual({ contexts: 0, state: undefined, tones: 0 });
  await page.getByRole("button", { name: "Започни" }).click();
  await answer(page);
  await expect.poll(audio).toMatchObject({ contexts: 1, state: "running" });
  expect((await audio()).tones).toBeGreaterThan(0);
  // The game in the background and back: the audio is started again, and still the one.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(audio).toMatchObject({ contexts: 1, state: "running" });
});
