import { expect, playMatch, signUp, startSolo, test, uniqueName } from './support';

// Laptop and desktop screens are wide but short: a picture question's four answers must all be on screen and take a
// tap where they show, with nothing over them (at 1280×720 two went below the fold, and the emote strip along the
// bottom took the others' clicks: the 31 October review, UX-1). The sizes the review found it at.
const SCREENS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 789 },
  { width: 1536, height: 730 },
];

test('@desktop a picture question’s four answers are on screen and take a click, on every common laptop size', async ({
  page,
}) => {
  // A new account: none of the sample bank's pictures seen yet, so a match places two.
  await signUp(page, uniqueName('Екран'), 'parola-123');
  await startSolo(page, 'Микс', 'Без часовник');
  const picture = page.locator('main figure img');
  let checked = 0;
  await playMatch(page, {
    onQuestion: async () => {
      if (!(await picture.isVisible())) return;
      for (const screen of SCREENS) {
        await page.setViewportSize(screen);
        await page.evaluate(() => window.scrollTo(0, 0));
        const answers = page.locator('main [data-answer]');
        await expect(answers).toHaveCount(4);
        for (let i = 0; i < 4; i++) {
          const box = (await answers.nth(i).boundingBox())!;
          const where = `${screen.width}×${screen.height}, answer ${'АБВГ'[i]}`;
          expect(box.y + box.height, `${where}: below the fold`).toBeLessThanOrEqual(screen.height);
          // What a click at its middle lands on is the answer itself, not something drawn over it.
          const hit = await answers
            .nth(i)
            .evaluate(
              (el, [x, y]) => el.contains(document.elementFromPoint(x, y)),
              [box.x + box.width / 2, box.y + box.height / 2],
            );
          expect(hit, `${where}: covered`).toBe(true);
        }
      }
      checked++;
    },
  });
  expect(checked, 'both pictures of the match').toBe(2);
});
