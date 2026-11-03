// After the browser tests in CI: the tests that passed only on their retry, written into the job's summary and as a
// warning, with `flaky=<n>` for the step's output (the report and both attempts' traces are uploaded then). A flaky
// pass is still green, and nobody would look otherwise. Reads apps/web/reports/results.json (playwright.config.ts →
// json). On main, a test that was flaky in each of the two runs before this one too fails the job: a flake that keeps
// coming back is a bug to fix, not noise (the 31 October review, REPO-3; class.spec's lost set name sat behind a retry
// for days).
import fs from 'node:fs';
import { ciRuns, flakyIn } from './flaky-runs.mjs';

const file = new URL('../apps/web/reports/results.json', import.meta.url);
const flaky = [];
if (fs.existsSync(file)) {
  const walk = (suite, path) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        if (test.status === 'flaky') flaky.push(`${[...path, spec.title].join(' › ')} [${test.projectName}]`);
    for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
  };
  for (const suite of JSON.parse(fs.readFileSync(file, 'utf8')).suites ?? []) walk(suite, [suite.title]);
}
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `flaky=${flaky.length}\n`);
if (flaky.length) {
  const lines = [`### ${flaky.length} browser test(s) passed only on a retry`, '', ...flaky.map((t) => `- ${t}`), ''];
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  for (const t of flaky)
    console.log(`::warning::Passed only on a retry (both attempts' traces are in the uploaded report): ${t}`);
}

const onMain = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main';
if (onMain && flaky.length && process.env.GITHUB_TOKEN) {
  try {
    // The two runs on main before this one (finished: a run still going has nothing to compare yet).
    const before = (await ciRuns('branch=main&event=push&status=completed', 3))
      .filter((run) => run.id !== Number(process.env.GITHUB_RUN_ID))
      .slice(0, 2);
    let again = new Set(flaky);
    for (const run of before) {
      const theirs = await flakyIn(run);
      again = new Set([...again].filter((t) => theirs.has(t)));
    }
    if (before.length === 2 && again.size) {
      for (const t of again)
        console.log(`::error::Flaky in three runs on main in a row (fix it, don't retry it): ${t}`);
      process.exitCode = 1;
    }
  } catch (err) {
    // The comparison is a check on top: a failure to read the earlier runs doesn't fail the tests.
    console.log(`::warning::Couldn't compare with the earlier runs on main: ${err.message}`);
  }
}
