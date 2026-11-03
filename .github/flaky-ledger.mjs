// The flaky-test ledger across runs (.github/workflows/flaky-ledger.yml, weekly): every test CI passed only on a retry
// in the last 7 days, counted over all runs (pull requests and main). One that did so twice or more gets an issue of
// its own, labelled `flaky` — opened, or brought up to date with this week's count — and an issue whose test has
// passed first time for 14 days is closed. A retry hides a failure in the run it happens in; across runs it shows
// (the 31 October review, REPO-3).
import { api, ciRuns, flakyIn } from './flaky-runs.mjs';

const DAY = 24 * 60 * 60 * 1000;
const since = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
const LABEL = 'flaky';
const title = (test) => `Flaky: ${test}`;

/** Each test's flaky passes in the runs since `days` ago, with the runs it happened in. */
async function ledger(days) {
  const counts = new Map();
  for (const run of await ciRuns(`created=>=${since(days)}&status=completed`)) {
    for (const test of await flakyIn(run)) {
      const entry = counts.get(test) ?? { count: 0, runs: [] };
      entry.count++;
      entry.runs.push(run);
      counts.set(test, entry);
    }
  }
  return counts;
}

const week = await ledger(7);
const fortnight = await ledger(14);

// The label, once.
await api('/labels', {
  method: 'POST',
  body: JSON.stringify({
    name: LABEL,
    color: 'd93f0b',
    description: 'A test that passes only on its retry, again and again',
  }),
}).catch(() => {});

const open = [];
for (let page = 1; ; page++) {
  const issues = await api(`/issues?labels=${LABEL}&state=open&per_page=100&page=${page}`);
  open.push(...issues.filter((i) => !i.pull_request));
  if (issues.length < 100) break;
}

for (const [test, { count, runs }] of week) {
  if (count < 2) continue;
  const lines = runs
    .slice(0, 20)
    .map(
      (r) =>
        `- ${r.created_at.slice(0, 10)} · [${r.head_sha.slice(0, 7)}](${r.html_url}) · ${r.event === 'push' ? 'main' : `PR ${r.head_branch}`}`,
    );
  const body = [
    `**\`${test}\`** passed only on its retry in **${count}** CI runs in the last 7 days.`,
    '',
    ...lines,
    '',
    "Each run's report (with both attempts' traces) is in its artifacts. A flake that keeps coming back is a bug: in the test, or in the app.",
  ].join('\n');
  const issue = open.find((i) => i.title === title(test));
  if (issue) {
    await api(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    await api(`/issues/${issue.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: `This week: ${count} flaky passes.` }),
    });
    console.log(`updated #${issue.number}: ${test} (${count})`);
  } else {
    const made = await api('/issues', {
      method: 'POST',
      body: JSON.stringify({ title: title(test), body, labels: [LABEL] }),
    });
    console.log(`opened #${made.number}: ${test} (${count})`);
  }
}

for (const issue of open) {
  const test = issue.title.replace(/^Flaky: /, '');
  if (fortnight.has(test)) continue;
  await api(`/issues/${issue.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      body: 'Passed first time in every run for 14 days: closed. It reopens as a new issue if it comes back.',
    }),
  });
  await api(`/issues/${issue.number}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
  });
  console.log(`closed #${issue.number}: ${test}`);
}
