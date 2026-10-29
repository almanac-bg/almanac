import { errors } from '@playwright/test';
import { expect, playMatch, startAsGuest, startSolo, test } from './support';

test('a solo player stops on a "Знаеше ли?" fact to read it, and finds the facts again in the results', async ({
  page,
}) => {
  await startAsGuest(page);
  // Every Geography question in the sample bank has a fact.
  await startSolo(page, 'География');

  const answer = page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false });
  const stop = page.getByRole('button', { name: 'Спри, за да прочета', exact: true });
  const resume = page.getByRole('button', { name: 'Продължи', exact: true });
  const counter = page.getByText(/^Въпрос \d+ от \d+$/);

  // At the test speed the reveal lasts 0.6 s: a "Спри" that comes too late lets the next question come as usual
  // (which is the point: the match never waits for it), and the next reveal tries again.
  let question = '';
  for (let tries = 0; !(await resume.isVisible()); tries++) {
    expect(tries, 'never managed to stop on a fact').toBeLessThan(9);
    await answer.first().click({ timeout: 15_000 });
    question = (await counter.textContent())!;
    await expect(page.getByText('Знаеше ли?')).toBeVisible({ timeout: 2_000 });
    await stop.click({ timeout: 1_500 }).catch((error) => {
      if (!(error instanceof errors.TimeoutError)) throw error;
    });
    await expect(resume.or(answer.first())).toBeVisible({ timeout: 15_000 });
  }

  // Held: several reveals' worth of time later, still the same question, and the fact to read.
  await page.waitForTimeout(2_000);
  await expect(counter).toHaveText(question);
  await expect(resume).toBeVisible();

  await resume.click();
  const next = Number(question.match(/\d+/)![0]) + 1;
  await expect(counter).toHaveText(new RegExp(`^Въпрос ${next} от`));

  await playMatch(page);
  await expect(page.getByRole('heading', { name: 'Научи днес', exact: true })).toBeVisible();
  // Three up front, the other seven in the review below.
  await expect(page.getByText('Още 7 — в прегледа на въпросите по-долу.')).toBeVisible();
});
