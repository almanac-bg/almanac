import { expect, me, playMatch, points, signUp, test, uniqueName } from './support';

interface MyChallenge {
  id: string;
  players: number;
  myScore: number | null;
}

interface SharedForTest {
  sharedForTest: ShareData[];
}

test('a challenge link brings a signed-out friend in to beat the score', async ({ page, newPlayer, baseURL }) => {
  // The system share sheet can't be driven from a test: whatever the app hands it is kept for the test to read.
  await page.addInitScript(() => {
    const shared: ShareData[] = [];
    Object.defineProperty(window, 'sharedForTest', { value: shared });
    navigator.share = async (data?: ShareData) => void shared.push(data ?? {});
  });

  const creator = uniqueName('Мария');
  await signUp(page, creator, 'tajna-parola-1');

  // The creator plays the ten questions first…
  await page.getByRole('button', { name: 'Създай предизвикателство', exact: true }).click();
  await expect(page).toHaveURL(/\/game$/);
  expect(await playMatch(page)).toEqual({ answered: 10, total: 10 });
  await expect(page.getByRole('heading', { name: 'Сега прати линка', exact: true })).toBeVisible();

  // …then shares the link.
  await page.getByRole('button', { name: 'Сподели линка', exact: true }).click();
  const sharedTexts = () =>
    page.evaluate(() => (window as unknown as SharedForTest).sharedForTest.map((data) => data.text ?? ''));
  await expect.poll(sharedTexts).toHaveLength(1);
  const [shared] = await sharedTexts();
  const id = /\/c\/([\w-]+)\s*$/.exec(shared)?.[1];
  expect(id, `a challenge link in "${shared}"`).toBeTruthy();
  expect(shared).toContain(`${baseURL}/c/${id}`);

  const res = await page.request.get('/api/challenges');
  expect(res.ok()).toBe(true);
  const { challenges } = (await res.json()) as { challenges: MyChallenge[] };
  expect(challenges).toEqual([expect.objectContaining({ id, players: 1, myScore: expect.any(Number) })]);
  const toBeat = challenges[0].myScore!;
  // Every pick is the first answer, so now and then none is right: then there's no bar to speak of yet.
  const headline = toBeat > 0 ? 'Летвата е поставена!' : 'Линкът е готов';
  await expect(page.getByRole('heading', { name: headline, exact: true })).toBeVisible();

  // A friend opens the link, signed out: who's challenging, and the score to beat.
  const friend = await newPlayer();
  await friend.goto(`/c/${id}`);
  // The page itself carries the challenge (for link previews in chat apps).
  await expect(friend).toHaveTitle(`${creator} те предизвиква в АЛМАНАХ`);
  await expect(friend.getByRole('heading', { name: `${creator} те предизвиква`, exact: true })).toBeVisible();
  await expect(friend.getByText('Резултат за биене')).toBeVisible();
  await expect(friend.getByText(points(toBeat))).toBeVisible();

  // One tap: a guest account, straight into the same ten questions.
  await friend.getByRole('button', { name: 'Приеми предизвикателството', exact: true }).click();
  await expect(friend).toHaveURL(/\/game$/);
  expect(await playMatch(friend)).toEqual({ answered: 10, total: 10 });
  const guest = await me(friend);
  expect(guest.isGuest).toBe(true);

  // Their place among everyone who played the link.
  await expect(friend.getByText('от 2 играчи')).toBeVisible();
  await expect(friend.getByRole('heading', { level: 1 })).toHaveText(/^(Първо място!|2-ро място)$/);

  // The link's board lists both, for either of them.
  await friend.getByRole('button', { name: 'Виж класирането', exact: true }).click();
  await expect(friend).toHaveURL(new RegExp(`/c/${id}$`));
  await page.goto(`/c/${id}`);
  for (const viewer of [friend, page]) {
    const board = viewer.getByRole('region', { name: 'Класиране', exact: true });
    await expect(board.getByText('2 играчи')).toBeVisible();
    await expect(board.getByRole('link')).toHaveCount(2);
    await expect(board.getByRole('link', { name: creator })).toBeVisible();
    await expect(board.getByRole('link', { name: guest.username })).toBeVisible();
  }
});
