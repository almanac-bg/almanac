export const meta = {
  name: 'new-questions',
  description: "A batch of new questions for АЛМАНАХ's bank: a writer and an independent checker per topic, then one cross-check of all ten",
  whenToUse: 'Run by the /new-questions skill, with the plan from `almanac bank plan -json`.',
  phases: [
    { title: 'Write', detail: 'one writer per topic, by the plan', model: 'opus' },
    { title: 'Verify', detail: 'one independent checker per topic, on another model', model: 'fable' },
    { title: 'Cross', detail: 'pairs across the topics, equal sizes, the final batch', model: 'fable' },
  ],
}

// The models are pinned here, so that no session's model or subagent default changes who writes and who checks.
// Writers: Claude Opus 5.5. Checkers and the cross-check: Claude Fable 5.2, the most capable model, and a different one
// from the writers', so that a mistake the writing model is prone to doesn't pass the same blind spot. Change them only
// on the owner's word.
const WRITER = { model: 'opus', effort: 'high' }
const CHECKER = { model: 'fable', effort: 'high' }

const { plan, batch, repo, bank, skill } = args ?? {}
if (!plan?.categories?.length || !batch || !repo || !bank || !skill) {
  throw new Error('args: {plan, batch, repo, bank, skill}: the plan from `almanac bank plan -json` and absolute paths')
}
const where = `<skill> = ${skill}\n<repo> = ${repo}\n<bank> = ${bank}\n<batch> = ${batch}`
const focus = plan.focus ? `\n\nThe owner's focus for this batch: ${plan.focus}` : ''

const WRITTEN = {
  type: 'object',
  properties: {
    written: { type: 'integer', description: 'questions written, spares included' },
    byCell: { type: 'string', description: 'how many in each cell of the plan' },
    datesSkipped: { type: 'array', items: { type: 'string' }, description: 'dates not written for, with why' },
    unconfirmed: { type: 'array', items: { type: 'string' }, description: 'ids not fully confirmed, with what' },
    bankProblems: { type: 'array', items: { type: 'string' }, description: 'faults in questions already in the bank: id, what, source' },
  },
  required: ['written', 'byCell', 'datesSkipped', 'unconfirmed', 'bankProblems'],
}
const CHECKED = {
  type: 'object',
  properties: {
    ok: { type: 'integer' },
    fix: { type: 'integer' },
    drop: { type: 'integer' },
    keptByCell: { type: 'string', description: 'how many kept in each cell of the plan' },
    worst: { type: 'string', description: 'the worst problem found' },
  },
  required: ['ok', 'fix', 'drop', 'keptByCell', 'worst'],
}
const CROSSED = {
  type: 'object',
  properties: {
    each: { type: 'integer', description: 'how many questions every category adds in final/' },
    pairs: { type: 'integer', description: 'pairs across categories resolved' },
    dropped: { type: 'integer', description: 'questions dropped in all, checkers and cross-check' },
    passes: { type: 'boolean', description: 'bank add -check passed on final/ with equal sizes' },
    worst: { type: 'array', items: { type: 'string' }, description: 'the three worst problems the batch caught' },
  },
  required: ['each', 'pairs', 'dropped', 'passes', 'worst'],
}

// Each topic goes on to its checker as soon as its writer is done.
const topics = await pipeline(
  plan.categories,
  (c) =>
    agent(
      `You write the "${c.id}" (${c.name}) part of a batch of new questions. Read ${skill}/WRITE.md and follow it exactly.\n\n${where}${focus}`,
      { ...WRITER, label: `write:${c.id}`, phase: 'Write', schema: WRITTEN },
    ),
  (written, c) => {
    if (!written) throw new Error(`no writer's result for ${c.id}`)
    const doubts = written.unconfirmed.length
      ? `\n\nThe writer wasn't fully sure of: ${written.unconfirmed.join('; ')}. Treat those as unconfirmed until you've read a source.`
      : ''
    return agent(
      `You check the "${c.id}" (${c.name}) part of a batch of new questions. Read ${skill}/VERIFY.md and follow it exactly.\n\n${where}${doubts}`,
      { ...CHECKER, label: `verify:${c.id}`, phase: 'Verify', schema: CHECKED },
    ).then((checked) => ({ id: c.id, written, checked }))
  },
)

const missing = plan.categories.filter((c, i) => !topics[i]?.checked).map((c) => c.id)
if (missing.length) {
  log(`not done: ${missing.join(', ')}; resume this run to finish them (the rest is kept)`)
  return { done: false, missing, topics: topics.filter(Boolean) }
}

phase('Cross')
const bankProblems = topics.flatMap((t) => t.written.bankProblems.map((p) => `${t.id}: ${p}`))
const crossed = await agent(
  `You make the final batch. Read ${skill}/CROSS.md and follow it exactly.\n\n${where}` +
    (bankProblems.length ? `\n\nThe writers found these in questions already in the bank:\n- ${bankProblems.join('\n- ')}` : ''),
  { ...CHECKER, label: 'cross', phase: 'Cross', schema: CROSSED },
)
return { done: Boolean(crossed?.passes), topics, crossed }
