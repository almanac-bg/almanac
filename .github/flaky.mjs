// After the browser tests in CI: the tests that passed only on their retry, written into the job's summary and as a
// warning, with `flaky=<n>` for the step's output (the report and the retry's trace are uploaded then). A flaky pass
// is still green, and nobody would look otherwise. Reads apps/web/reports/results.json (playwright.config.ts → json).
import fs from 'node:fs';

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
  for (const t of flaky) console.log(`::warning::Passed only on a retry (its trace is in the uploaded report): ${t}`);
}
