export const meta = {
  name: 'question-batches',
  description: 'Write a batch of questions with facts per brief, then check each one independently against sources',
  phases: [
    { title: 'Write', detail: 'one writer per batch: questions, facts and sources, researched' },
    { title: 'Check', detail: 'a separate fact-checker per batch: OK / FIX / DROP with evidence' },
  ],
}

// The question-bank skill's batch workflow (SKILL.md → "For hundreds of questions"). Run with the Workflow tool:
//   Workflow({scriptPath: '.claude/skills/question-bank/workflows/batches.js',
//             args: {dir: '<work folder>', today: 'YYYY-MM-DD', slugs: [...], checkOnly: [...]}})
// <dir>/batches.json holds the briefs (from plan.js: slug, category, title, scope, avoid, siblings, mix). Each slug
// gets <dir>/<slug>/draft.json from a writer, then <dir>/<slug>/verified.json from a separate checker; checkOnly
// re-checks drafts whose check didn't finish. Then `bank.mjs collect <dir> <out>` → similar, giveaways, add, test.

const NODE = 'export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"'
const TOOL = 'node .claude/skills/question-bank/bank.mjs'

const WRITTEN = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    count: { type: 'integer' },
    easy: { type: 'integer' },
    medium: { type: 'integer' },
    hard: { type: 'integer' },
    notes: { type: 'string', description: 'anything the checker or the editor should know (left out topics, doubts)' },
  },
  required: ['file', 'count', 'easy', 'medium', 'hard', 'notes'],
}

const CHECKED = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    ok: { type: 'integer' },
    fix: { type: 'integer' },
    drop: { type: 'integer' },
    notes: { type: 'string', description: 'patterns worth knowing for later batches (kinds of mistakes found)' },
  },
  required: ['file', 'ok', 'fix', 'drop', 'notes'],
}

const CATEGORY = { gen: 'general', sci: 'science', his: 'history', geo: 'geography', mov: 'movies', mus: 'music', spo: 'sports', tec: 'technology', lit: 'literature', nat: 'nature' }
const categoryOf = (slug) => CATEGORY[slug.split('-')[0]]

const write = (slug) =>
  agent(
    `You write new questions for АЛМАНАХ, a real-time quiz game for Bulgarian players (repo: /Users/hristo/Developer/quiz).

Read .claude/skills/question-bank/SKILL.md first: "Adding questions" and "Writing „Знаеше ли?“ facts" are the rules for this task, and they are strict.

Your batch brief is the object with "slug": "${slug}" in ${args.dir}/batches.json: its category, title, scope, an "avoid" list (questions already in the bank near this scope: do NOT ask them again, nor the same fact reworded) and "siblings" (batches other writers are doing in the same category right now: stay out of their ground).

Write exactly as many questions as your brief's "mix" adds up to, at those difficulties (without a "mix": 20 — 8 easy, 8 medium, 4 hard). The mix comes from the bank's balance rule, so keep to it. For Bulgarian players: easy = most adults know it, medium = a well-read person, hard = an enthusiast. Each one with:
- q, options (4), answer (index of the right option), difficulty, category "${categoryOf(slug)}";
- answerSource: an https page that confirms the marked answer;
- fact: a „Знаеше ли?“ fact (20–200 characters, ends with a period) that adds something true and surprising about the answer, and factSource: an https page that supports every claim in it.

Never send personal data in any request: no names or email addresses in User-Agent headers, queries or URLs (use a generic User-Agent such as "almanac-question-check"). Research as you write: confirm every answer and every claim of every fact on its source page (WebSearch / WebFetch) before you keep it. Never write a number, date, name or superlative from memory alone; if you can't confirm it, choose another question. Keep the sources' hedges. Before finishing, list the category (grep '"category":"${categoryOf(slug)}"' private/questions.json) and make sure nothing duplicates an existing question; also run:
  ${NODE} && ${TOOL} similar ${args.dir}/${slug}/draft.json
and replace anything it shows that asks the same thing (the same answer from a different angle is fine, unless one gives the other away).

Vary the position of the right answer (about five each at 0, 1, 2, 3). For questions with four numbers, make the right one the smallest or the largest about half the time.

Write them as a JSON array to ${args.dir}/${slug}/draft.json (create the folder), each object:
{"tid":"${slug}-01","category":"${categoryOf(slug)}","difficulty":"easy","q":"…?","options":["…","…","…","…"],"answer":0,"fact":"….","factSource":"https://…","answerSource":"https://…"}
Edit no other file (never private/questions.json). Return the summary.`,
    { label: `write:${slug}`, phase: 'Write', schema: WRITTEN, agentType: 'general-purpose' },
  )

const check = (written, slug) =>
  agent(
    `You are an independent fact-checker for АЛМАНАХ, a quiz game for Bulgarian players (repo: /Users/hristo/Developer/quiz). A wrong answer or a wrong fact taught to players is the worst bug the game can ship, so be skeptical: drafts often contain a confident detail no source states.

Read .claude/skills/question-bank/SKILL.md first (its rules for questions and facts are the standard). Today is ${args.today}.

Input: ${args.dir}/${slug}/draft.json — the draft's questions in category ${categoryOf(slug)}, each with answerSource, fact and factSource. Check EVERY question. Never send personal data in any request: no names or email addresses in User-Agent headers, queries or URLs (use a generic User-Agent such as "almanac-question-check").

1. The marked answer is right (fetch answerSource; if it doesn't settle it, find a reliable source that does). No other option is also right or defensible. Nothing is outdated as of today. The question has one reading.
2. The fact: fetch factSource and check every claim — names, dates, numbers, and qualifiers like "only", "first", "largest", "still". It must say no more than the source; it must add something beyond the answer; 20–200 characters, ending with a period.
3. The question is fair for Bulgarian players at its difficulty; the options are plausible and of the same kind and form (no odd one out); the wording doesn't give the answer away; lengths (question ≤150, each option ≤45).
4. Correct, natural Bulgarian and the bank's typography („…“, spaced —, "г." after years, four-digit numbers without a space).

Verdict per question: OK; FIX (you correct whatever is wrong — question, options, answer, difficulty, fact, factSource — and the corrected version must itself be confirmed); DROP (contested, unconfirmable, or not fixable).

Write ${args.dir}/${slug}/verified.json: a JSON array with one object per draft question, in order:
{"tid":"…","verdict":"OK|FIX|DROP","category":"…","difficulty":"…","q":"…","options":[…],"answer":0,"fact":"…","factSource":"https://…","note":"what you checked or changed, with the evidence in a few words"}
(final values; for DROP keep the draft's values and say why). Edit no other file. Return the summary.`,
    { label: `check:${slug}`, phase: 'Check', schema: CHECKED, agentType: 'general-purpose' },
  ).then((c) => ({ slug, written, checked: c }))

// Batches whose draft is already written (an earlier wave's check didn't finish) only get checked.
const rechecks = (args.checkOnly ?? []).map((slug) => () => check({ file: `${args.dir}/${slug}/draft.json` }, slug))
// A batch whose writer didn't finish has nothing to check.
const [results, rechecked] = await Promise.all([
  pipeline(args.slugs, (slug) => write(slug), (written, slug) => (written ? check(written, slug) : null)),
  parallel(rechecks),
])
const done = [...results, ...rechecked].filter(Boolean)
log(`${done.length}/${args.slugs.length + rechecks.length} batches done`)
return done
