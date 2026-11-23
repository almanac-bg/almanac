export const meta = {
  name: 'new-questions',
  description: "A batch of new questions for АЛМАНАХ's bank: a writer and an independent checker per category, then one cross-check of all ten",
  whenToUse: 'Run by the /new-questions skill, with the plan from `almanac bank plan -json`.',
  phases: [
    { title: 'Write', detail: 'one writer per category, by the plan', model: 'opus' },
    { title: 'Verify', detail: 'one independent checker per category, on another model', model: 'fable' },
    { title: 'Blind', detail: 'the checked questions answered without the key, on a third model', model: 'sonnet' },
    { title: 'Cross', detail: 'pairs across the categories, the sizes, the final batch', model: 'fable' },
  ],
}

// The models are pinned here, so that no session's model or subagent default changes who writes and who checks.
// Writers: Claude Opus 5.5. Checkers and the cross-check: Claude Fable 5.2, the most capable model, and a different one
// from the writers', so that a mistake the writing model is prone to doesn't pass the same blind spot. Change them only
// on the owner's word.
const WRITER = { model: 'opus', effort: 'high' }
const CHECKER = { model: 'fable', effort: 'high' }
// The blind answerers: a third model, neither the writers' nor the checkers', answers the checked questions without
// the key; where it is sure of something else, the cross-check finds out who is right. The sheets are made by a helper
// on the same model, so no answerer ever runs what reads the key.
const BLIND = { model: 'sonnet', effort: 'medium' }

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
    passes: { type: 'boolean', description: 'bank add -check passed on final/, the categories within 2% of their mean' },
    worst: { type: 'array', items: { type: 'string' }, description: 'the three worst problems the batch caught' },
  },
  required: ['each', 'pairs', 'dropped', 'passes', 'worst'],
}

// Each category goes on to its checker as soon as its writer is done.
const categories = await pipeline(
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

const missing = plan.categories.filter((c, i) => !categories[i]?.checked).map((c) => c.id)
if (missing.length) {
  log(`not done: ${missing.join(', ')}; resume this run to finish them (the rest is kept)`)
  return { done: false, missing, categories: categories.filter(Boolean) }
}

phase('Blind')
const fix = `${repo}/.claude/skills/fix-questions`
const made = await agent(
  `Run exactly this, and nothing else: cd ${repo} && python3 -I ${fix}/blind.py sheets ${bank} ${batch} --from ${batch}/verify --size 150\nIt prints "<n> questions on <s> sheets". Don't open any file. Your final answer: the number of sheets.`,
  { ...BLIND, effort: 'low', label: 'blind:sheets', phase: 'Blind', schema: { type: 'object', properties: { sheets: { type: 'integer' } }, required: ['sheets'] } },
)
if (!made?.sheets) {
  log('the blind sheets were not made; resume this run')
  return { done: false, missing: ['blind'], categories }
}
const sheets = Array.from({ length: made.sheets }, (_, i) => i + 1)
const answered = await parallel(
  sheets.map((n) => () =>
    agent(
      `Answer the sheet ${batch}/blind/sheets/${n}.json into ${batch}/blind/answers/${n}.json. Read ${fix}/ANSWER.md and follow it exactly.`,
      { ...BLIND, label: `blind:${n}`, phase: 'Blind', schema: { type: 'object', properties: { answered: { type: 'integer' }, sure: { type: 'integer' } }, required: ['answered', 'sure'] } },
    ),
  ),
)
if (answered.some((r) => !r)) {
  log('a blind sheet was not answered; resume this run')
  return { done: false, missing: ['blind'], categories }
}

phase('Cross')
const bankProblems = categories.flatMap((t) => t.written.bankProblems.map((p) => `${t.id}: ${p}`))
const crossed = await agent(
  `You make the final batch. Read ${skill}/CROSS.md and follow it exactly.\n\n${where}\n<fix> = ${fix}` +
    (bankProblems.length ? `\n\nThe writers found these in questions already in the bank:\n- ${bankProblems.join('\n- ')}` : ''),
  { ...CHECKER, label: 'cross', phase: 'Cross', schema: CROSSED },
)
return { done: Boolean(crossed?.passes), categories, crossed }
