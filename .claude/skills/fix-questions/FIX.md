# Fixing a chunk of questions already in the bank

You fix questions in АЛМАНАХ's bank (a Bulgarian quiz game) that a check flagged or a rule asks to judge again. An
independent checker who trusts nothing will go over every change after you. What you can't stand behind, don't
change: leave it, and say why.

Your prompt gives you: `<skill>` (this folder), `<repo>` (the game's code), `<bank>` (the real bank, **read-only**:
never edit it), `<work>` (this pass's folder) and your chunk's name.

## Read first

1. `<repo>/.claude/skills/questions/SKILL.md`: the rules for every question, fact, `day` line and picture, the
   difficulty rubric, the format, the Bulgarian style, how to change a question (in place, or retire and replace).
2. Your chunk: `<work>/chunks/<chunk>.json`: `category`, `ids` (the free ids for any replacement you write, in order),
   and `items`: each a question `id` with its `problems` (what `bank lint` says, by rule) and `judge` (rules that code
   can't check and you judge: see below).
3. Each question in the bank (`<bank>/questions/<category>.json`) and, for a problem that names another question,
   that one too.

## For each item, decide one

- **change**: fix it in place when it still asks the same thing, better. Set `updated` to today; set `changed` to
  today too if what it asks changed (text, answer, options, items, pairs, decoy, clues, groups, picture, tolerance,
  unit, step, scale, direction), and leave `changed` as it was if only the fact, the `day` line or a label changed.
  Keep `added`. Update `sources`: the pages you read for the fix (keep the old ones that still hold).
- **replace**: when the fix would ask something else (another subject or answer), or the question can't be saved:
  retire it (`why`: wrong, stale, weak, twin, giveaway or rule) and write a new question **in the same cell** (same
  category, kind, difficulty, with a picture if it had one), with the next id from your chunk's `ids`, `added` and
  `updated` today, `sources`, a fact, `day` if dated. Rule `estimate` is the exception: a small count becomes a
  **choice** about the same subject, in the same difficulty.
- **waive**: only a true exception to a rule (a question about a word itself, a proverb to finish, a temperature
  below zero). Say why in a sentence. Never to keep a weak question.
- **keep**: only for a `judge` item that passes the rule as it is. A `problems` item is never kept unchanged: fix it,
  replace it, or waive it.

What the rules ask (the questions skill has the details):

- **giveaway, pair-giveaway, shared-items, answer-word, options, long-answer**: remove the leak or the tell with the
  smallest change: drop a year from a fact, change an option or an item, reword. The question named on the other side
  may be the one to change; change whichever loses least, and only one of the two.
- **same-identity**: keep the better of the two, replace the other (`why`: twin).
- **estimate**: see replace above. **tolerance**: set the formula's value (the questions skill).
- **stale**: pin it to a date („към 2026 г.“) and add `reviewBy`, or reword to what doesn't change.
- **dated**: write the `day` line (what happened on that day, naming it: „На 16 декември 1982 г. умира Колин
  Чапман.“). Take the date out of the text unless the date is what's asked. If the fact only repeated the date, write a
  new fact worth knowing.
- **judge: false-fact** (a true-or-not whose answer is false): the fact must start with what is true („Роден е в
  Русе, не във Варна…“ or simply the true value first). If it does, keep; if not, change the fact only.
- **judge: easy-picture** (an easy choice with a picture, the day's second place): the picture must be the question
  (a place, a face, a species, a work, something people confuse), never "name this everyday object", and a quarter of
  Bulgarian adults still miss it. If it's trivial, replace it with a good one in the same cell; pictures as in
  `<repo>/.claude/skills/new-questions/WRITE.md` (Commons, licences, cwebp, sizes), into
  `<work>/fix/<chunk>/images/`.
- **decoy, order-gap, fact, spelling, typography, ending, address, language**: as the rule's message says.

Before you change anything, **grep the bank** for the subject, the answer and the key names and numbers (no new
give-away, no near-duplicate), and **confirm every claim from a page you read in this session** (bg/en Wikipedia,
Britannica, official sites; WebFetch the page itself; WebSearch is rate-limited). Never send personal data anywhere.

## Deliver

In `<work>/fix/<chunk>/` (nothing else in it):

- `<category>.json`: one JSON array: every changed question whole (its id), then every new question (ids from your
  range). Leave kept and waived ones out.
- `retire.json` if you replace any: `[{"id": "<old>", "why": "<why>", "by": "<new id>"}]`.
- `images/` only if you made pictures.

And `<work>/fix/<chunk>.md`: one line per item: id, change / replace / waive / keep, what and why, the source. And
`<work>/fix/<chunk>.waivers.json` if you waive any: `[{"id", "rule", "why"}]`.

Check it against the real bank before you finish, and fix what it reports for your ids:

```bash
cd <repo> && go run ./cmd/almanac bank add -check <work>/fix/<chunk> <bank>
```

Your final answer (structured): the counts per decision, and anything you couldn't fix and why.
