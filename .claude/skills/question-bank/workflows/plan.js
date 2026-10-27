export const meta = {
  name: 'question-plan',
  description: 'Plan new questions per category: non-overlapping topics of 20, sized by the balance rule',
  phases: [{ title: 'Plan', detail: 'one planner per category reads its existing questions' }],
}

// The question-bank skill's planning workflow (SKILL.md → "For hundreds of questions"). Run with the Workflow tool:
//   Workflow({scriptPath: '.claude/skills/question-bank/workflows/plan.js', args: {batches: {music: 2, general: 1}}})
// args.batches: batches of 20 per category (a category left out isn't planned); without it, 5 for every category.
// It returns, per category, batches that overlap neither each other nor the bank, each with a difficulty mix from
// `bank.mjs stats`. Save them as batches.json for batches.js, adding "siblings" (the other titles in the category).

const CATEGORIES = [
  { id: 'general', prefix: 'gen', name: 'Обща култура', hint: 'everyday knowledge, customs and holidays, food, language and sayings, symbols, institutions, money, measures; Bulgarian life first' },
  { id: 'science', prefix: 'sci', name: 'Наука', hint: 'physics, chemistry, biology, medicine, astronomy and space, earth science, maths; scientists incl. Bulgarian ones and women in science' },
  { id: 'history', prefix: 'his', name: 'История', hint: 'Bulgarian history in every era, the Balkan neighbours, world history from antiquity to after 2018' },
  { id: 'geography', prefix: 'geo', name: 'География', hint: 'Bulgarian regions, towns, rivers, mountains; the Balkans and Europe; world capitals, countries, physical geography' },
  { id: 'movies', prefix: 'mov', name: 'Кино и телевизия', hint: 'Bulgarian film and TV, world cinema classics and modern films, animation, series, actors and directors' },
  { id: 'music', prefix: 'mus', name: 'Музика', hint: 'Bulgarian folk, pop, rock and classical; world pop and rock; classical composers; instruments; Eurovision' },
  { id: 'sports', prefix: 'spo', name: 'Спорт', hint: 'Bulgarian athletes and teams across many sports (not only football), Olympics, world football, tennis, volleyball, wrestling, weightlifting, rules; sport after 2017' },
  { id: 'technology', prefix: 'tec', name: 'Технологии и игри', hint: 'computing history incl. Bulgarian, the internet, phones, companies, inventions, video games and board games, programming' },
  { id: 'literature', prefix: 'lit', name: 'Изкуство и литература', hint: 'Bulgarian and world literature (incl. women authors and living authors), painting, sculpture, architecture, theatre, mythology' },
  { id: 'nature', prefix: 'nat', name: 'Природа и животни', hint: 'animals and plants of Bulgaria and the world, behaviour, protected areas, ecology; fewer "най-…" superlatives' },
]

const PLANNED = CATEGORIES.map((c) => ({ ...c, batches: args?.batches ? (args.batches[c.id] ?? 0) : 5 })).filter(
  (c) => c.batches > 0,
)

const plan = (n) => ({
  type: 'object',
  properties: {
    category: { type: 'string' },
    existing: { type: 'integer', description: 'questions in this category now' },
    coverage: { type: 'string', description: '3-5 sentences: what the existing questions cover well, and the clearest gaps' },
    batches: {
      type: 'array',
      minItems: n,
      maxItems: n,
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'kebab-case ascii, starting with the category prefix, e.g. geo-balkan-neighbours' },
          title: { type: 'string' },
          scope: { type: 'string', description: '2-4 sentences: which topics, eras, regions and kinds of question; concrete enough that a writer knows where to look and where not to' },
          avoid: { type: 'array', items: { type: 'string' }, description: 'topics or specific facts the bank already asks about near this scope (quote the existing question briefly), which the writer must not repeat' },
          mix: {
            type: 'object',
            properties: { easy: { type: 'integer' }, medium: { type: 'integer' }, hard: { type: 'integer' } },
            required: ['easy', 'medium', 'hard'],
            description: 'how many of the 20 at each difficulty (they add up to 20)',
          },
        },
        required: ['slug', 'title', 'scope', 'avoid', 'mix'],
      },
    },
  },
  required: ['category', 'existing', 'coverage', 'batches'],
})

phase('Plan')
const plans = await parallel(PLANNED.map((c) => () => agent(
  `You plan new questions for one category of АЛМАНАХ, a real-time quiz game for Bulgarian players (repo: /Users/hristo/Developer/quiz).

First read .claude/skills/question-bank/SKILL.md: the bank's rules and conventions.

Category: ${c.id} (${c.name}; ids start with "${c.prefix}-"). Its usual ground: ${c.hint}.
The bank is private/questions.json, one question per line; list this category with:
  grep '"category":"${c.id}"' private/questions.json
Read ALL of them before planning. Any saved but unwritten briefs for this category are in private/plans/ — reuse them where they still fit.

We are adding ${c.batches * 20} new questions to this category, in ${c.batches} batches of 20, written by ${c.batches} different writers at the same time. So the batches must not overlap each other, and must not repeat what the bank already asks.

The difficulty mix follows the bank's balance rule (SKILL.md). Run
  export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH" && node .claude/skills/question-bank/bank.mjs stats
and spread this category's "to balance" numbers over the batches (anything beyond them: 40% easy, 40% medium, 20% hard). Give each batch its "mix".

Plan the ${c.batches} batches. Guidance:
- What a Bulgarian player would enjoy and find fair. Roughly half Bulgarian or Balkan content and half world content (adapt to the category).
- Fill the gaps you find rather than adding to topics that are already rich. Spread across eras, regions and kinds of question (who/what/where/when/which), not just "най-…" superlatives.
- Content priorities for the whole bank: events after 2018 (pinned to a year), the Balkan neighbours, women authors and scientists, sport after 2017.
- Avoid topics whose answers change often (current office holders, records likely to fall, "the latest" anything).
- For each batch, the avoid list names existing questions near its scope (quote them briefly), so the writer doesn't repeat them.

Do not write any questions and do not edit any file. Return the plan.`,
  { label: `plan:${c.id}`, phase: 'Plan', schema: plan(c.batches), agentType: 'general-purpose' },
)))

const ok = plans.filter(Boolean)
log(`${ok.length}/${PLANNED.length} categories planned`)
return ok
