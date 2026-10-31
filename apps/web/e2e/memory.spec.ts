import { expect, expectLobby, playMatch, startAsGuest, startSolo, test } from './support';

// A tab that plays match after match keeps what it shows now, not every screen it has shown. In Chromium a lazy image
// with `sizes="auto, …"` stayed registered for viewport changes after it was gone and kept its whole removed screen
// alive: the lobby grew by about 2,400 DOM nodes a match, for as long as the tab lived (the 31 October review, WEB-1;
// components/Emoji.tsx). Chromium only: the DOM count comes from its DevTools protocol.
test('the lobby stays the same size after match after match in one tab', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'counts DOM nodes over the Chrome DevTools Protocol');
  test.setTimeout(test.info().timeout * 3);
  await startAsGuest(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const lobbyNodes = async () => {
    await expectLobby(page);
    // Twice: a collection can leave what the first one freed for the next.
    for (let i = 0; i < 2; i++) await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((m) => m.name === 'Nodes')!.value;
  };
  const home = page.getByRole('button', { name: /^(Начало|Към началото)$/ }).first();
  // One match first, so whatever a first match loads once (the game's code, its sounds) is in before the count.
  const counts: number[] = [];
  for (let match = 0; match < 4; match++) {
    await startSolo(page, 'Микс', 'Без часовник');
    expect(await playMatch(page, { moment: 'pass' })).toEqual({ answered: 10, total: 10 });
    await home.click();
    counts.push(await lobbyNodes());
  }
  const [first, ...rest] = counts;
  // A few nodes come and go (a toast, a card's state); a leak adds thousands a match.
  for (const n of rest) expect(n, `lobby DOM nodes after each match: ${counts.join(' → ')}`).toBeLessThan(first * 1.1);
});
