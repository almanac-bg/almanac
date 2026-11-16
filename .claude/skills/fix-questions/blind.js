export const meta = {
  name: 'blind-answers',
  description: "Answer АЛМАНАХ's bank without its key, a sheet per agent, on a third model, to find what the key gets wrong",
  whenToUse: 'Run by the /fix-questions skill, after blind.py sheets.',
  phases: [{ title: 'Answer', detail: 'one answerer per sheet', model: 'sonnet' }],
}

// A third model: not the writers' (Opus) nor the checkers' (Fable), so it doesn't share their blind spots. Pinned
// here; change it only on the owner's word.
const ANSWERER = { model: 'sonnet', effort: 'medium' }

const { sheets, work, skill } = args ?? {}
if (!sheets?.length || !work || !skill) throw new Error('args: {sheets, work, skill}: the sheet numbers, and absolute paths')

const ANSWERED = {
  type: 'object',
  properties: { answered: { type: 'integer' }, sure: { type: 'integer' } },
  required: ['answered', 'sure'],
}
const results = await parallel(
  sheets.map((n) => () =>
    agent(
      `Answer the sheet ${work}/blind/sheets/${n}.json into ${work}/blind/answers/${n}.json. Read ${skill}/ANSWER.md and follow it exactly.`,
      { ...ANSWERER, label: `answer:${n}`, phase: 'Answer', schema: ANSWERED },
    ).then((r) => ({ sheet: n, ...r })),
  ),
)
const missing = sheets.filter((n, i) => !results[i])
if (missing.length) log(`not answered: ${missing.join(', ')}; resume this run to finish them`)
return { done: missing.length === 0, missing, results: results.filter(Boolean) }
