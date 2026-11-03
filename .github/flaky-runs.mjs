// The flaky browser tests of earlier CI runs, read back from the warnings .github/flaky.mjs wrote in each browser job
// (its annotations): for flaky.mjs on main, and for the weekly ledger (.github/flaky-ledger.mjs).

/** A call to this repository's REST API with the job's token. */
export async function api(path, init = {}) {
  const res = await fetch(`${process.env.GITHUB_API_URL}/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${init.method ?? 'GET'} ${path}`);
  return res.status === 204 ? null : res.json();
}

/** "Passed only on a retry (…): <test>", as flaky.mjs writes it (the words in brackets have changed over time). */
const WARNING = /^Passed only on a retry(?: \([^)]*\))?: (.+)$/;

/** CI's runs, newest first, up to `limit`: `query` narrows them (branch, event, created, status). */
export async function ciRuns(query, limit = 1000) {
  const runs = [];
  for (let page = 1; runs.length < limit; page++) {
    const { workflow_runs } = await api(`/actions/workflows/ci.yml/runs?per_page=100&page=${page}&${query}`);
    runs.push(...workflow_runs);
    if (workflow_runs.length < 100) break;
  }
  return runs.slice(0, limit);
}

/** The tests one run's browser jobs passed only on a retry, as "<file> › … › <title> [<project>]". */
export async function flakyIn(run) {
  const tests = new Set();
  const { jobs } = await api(`/actions/runs/${run.id}/jobs?per_page=100`);
  for (const job of jobs.filter((j) => j.name.startsWith('browser tests') || j.name.startsWith('test (Node'))) {
    const notes = await api(`/check-runs/${job.id}/annotations?per_page=100`);
    for (const note of notes) {
      const test = WARNING.exec(note.message ?? '')?.[1];
      if (test) tests.add(test);
    }
  }
  return tests;
}
