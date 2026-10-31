export const meta = {
  name: 'question-formats',
  description: 'Write number, order or picture questions per brief, then check each one independently against sources',
  phases: [
    { title: 'Write', detail: 'one writer per batch: questions in the format, facts and sources, researched' },
    { title: 'Check', detail: 'a separate fact-checker per batch: OK / FIX / DROP with evidence' },
  ],
}

// The question-bank skill's workflow for its special formats (number finals, „Подреди“, pictures):
//   Workflow({scriptPath: '.claude/skills/question-bank/workflows/formats.js',
//             args: {dir: '<work folder>', format: 'number'|'order'|'picture', today: 'YYYY-MM-DD', slugs: [...], checkOnly: [...]}})
// <dir>/batches.json holds the briefs (slug, category, title, scope, mix, siblings). Each slug gets <dir>/<slug>/draft.json
// from a writer, then <dir>/<slug>/verified.json from a separate checker. Then `bank.mjs collect <dir> <out>` →
// similar, giveaways, add (pictures: `bank.mjs image` first), the bank test.

const SECTION = { number: 'Number questions', order: 'Ordering questions („Подреди“)', picture: 'Image questions' }
const KIND = { number: 'number', order: 'order', picture: null }
const section = SECTION[args.format]
if (!section) throw new Error(`format must be one of ${Object.keys(SECTION).join(', ')}`)

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
const kindLine = KIND[args.format] ? `"kind": "${KIND[args.format]}", ` : ''

const write = (slug) =>
  agent(
    `You write new questions for АЛМАНАХ, a quiz game for Bulgarian players (repo: /Users/hristo/Developer/almanac). Players learn from it: a wrong number or fact is the worst bug it can ship.

Read first, all of it: .claude/skills/question-bank/SKILL.md ("Adding questions" and "Writing „Знаеше ли?“ facts") and .claude/skills/question-bank/briefs/formats-write.md ("Ground rules" and the section "${section}"). They are the rules for this task, and they are strict.

Your batch brief is the object with "slug": "${slug}" in ${args.dir}/batches.json: its category, title, scope, "mix" (how many at each difficulty) and "siblings" (another writer's batch in the same category, running now: stay out of its ground).

Before writing, see what the bank already has in your category and format, so you repeat none of it:
  grep '"category":"${categoryOf(slug)}"' private/questions.json | grep '"kind":"${KIND[args.format] ?? 'choice'}"'
and grep the bank for every subject and number you use.

Write exactly as many as the mix says, at those difficulties, in Bulgarian, each with ${kindLine}"category": "${categoryOf(slug)}", "added": "${args.today}", "tid": "${slug}-01" (then -02…), "answerSource", and a fact with its factSource (on all of them if you can). Tag ["bg"] what is about Bulgaria; give "reviewBy" (about a year from ${args.today}) to anything that may change.

Research as you write: confirm every number, date, name and claim on the page you cite (WebSearch / WebFetch) before you keep it; never from memory alone. If you can't confirm one, choose another. Never send personal data in any request: use the User-Agent "AlmanacBank/1.0 (https://almanac.bg)", no names or email addresses in queries or URLs.

Write them as a JSON array to ${args.dir}/${slug}/draft.json (create the folder). Edit no other file (never private/questions.json). Return the summary.`,
    { label: `write:${slug}`, phase: 'Write', schema: WRITTEN, agentType: 'general-purpose' },
  )

const check = (written, slug) =>
  agent(
    `You are an independent fact-checker for АЛМАНАХ, a quiz game for Bulgarian players (repo: /Users/hristo/Developer/almanac). Someone else drafted these questions; don't trust their notes. Drafts often hold a confident detail no source states: be skeptical. Today is ${args.today}.

Read first, all of it: .claude/skills/question-bank/briefs/formats-check.md (which tells you to read formats-write.md too; its section "${section}" is this batch's format) and .claude/skills/question-bank/SKILL.md.

Input: ${args.dir}/${slug}/draft.json (category ${categoryOf(slug)}). Check EVERY question as formats-check.md says, fetching the sources yourself. Never send personal data in any request: use the User-Agent "AlmanacBank/1.0 (https://almanac.bg)", no names or email addresses in queries or URLs.

Write ${args.dir}/${slug}/verified.json: the batch as a JSON array, every question with all its fields (your corrected values for a FIX), plus "verdict" ("OK" | "FIX" | "DROP") and "check" (the evidence in a sentence or two: what you verified where, what you changed or why you dropped it). Keep "tid". Edit no other file. Return the summary.`,
    { label: `check:${slug}`, phase: 'Check', schema: CHECKED, agentType: 'general-purpose' },
  ).then((c) => ({ slug, written, checked: c }))

const rechecks = (args.checkOnly ?? []).map((slug) => () => check({ file: `${args.dir}/${slug}/draft.json` }, slug))
const [results, rechecked] = await Promise.all([
  pipeline(args.slugs, (slug) => write(slug), (written, slug) => (written ? check(written, slug) : null)),
  parallel(rechecks),
])
const done = [...results, ...rechecked].filter(Boolean)
log(`${done.length}/${args.slugs.length + rechecks.length} batches written and checked`)
return done
