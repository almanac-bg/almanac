# The cross-check: the last gate before the bank

Ten writers wrote one category each, in parallel, and ten checkers checked one category each. None of them saw the
others' files: the same subject gets written twice, and one category's question gives another's away. You are the one
who sees all ten, and you make the batch that goes into the bank.

Your prompt gives you: `<skill>` (this folder), `<repo>` (the game's code), `<bank>` (the real bank, **read-only**)
and `<batch>` (this batch's folder).

## Read first

- `<repo>/.claude/skills/questions/SKILL.md` and `<skill>/WRITE.md`.
- `<batch>/plan.json`: `each` is how many questions every category adds.
- For each category: the writer's `write/<cat>/<cat>.json` and `sources/<cat>.json`, the checker's
  `verify/<cat>/<cat>.json` (what it passed) and `verify/<cat>.md` (why it fixed or dropped each).

## Do

0. **The blind answers.** A third model answered every checked question without the key (`<batch>/blind/`). Run
   `cd <repo> && python3 -I <fix>/blind.py compare <bank> <batch>`: `<batch>/blind/disagree.json` lists each question
   where it was sure of another answer. Each is a doubt to settle from sources you read now (WebFetch), not a vote:
   the key wrong → fix it, or drop the question; two answers defensible (an option that can be argued, a text read
   two ways, a value that differs by source) → change the wording or the option until one holds, or drop it; the key
   right and one reading → keep it. Don't open the answers to look for more: only these are doubts.
1. **Pairs across categories.** Run `cd <repo> && go run ./cmd/almanac bank related -from <batch>/verify/general,<batch>/verify/science,…` (all ten verified folders, comma-separated) `<bank>`: under each question, the ten most like it in the bank and the whole batch, with their text, answer and fact. Read every list. Find every pair (or more) of questions across the ten verified files that ask the same
   thing, share an answer about the same subject, or give each other away: a text, option, item, clue or fact that
   names another's answer, or shows a value an order or number question asks. For each, keep exactly one, the best
   written, in the category it fits best; drop or fix the others. Check the drops in the checkers' `verify/<cat>.md` too: a
   question dropped as a duplicate of another category's may be the one to keep, if the other side was dropped as well.
2. **What a checker didn't really confirm.** Search every `verify/<cat>.md` for "memory", "not fetched", "unconfirmed",
   "couldn't", "likely" and the like. Confirm each such question from a reliable page now (WebFetch), or drop it.
3. **Sizes.** Every category adds `each` questions. Where a category has more, cut the spares: first
   from cells already over their `count`, then the weakest or the most repetitive subjects, keeping the dated ones and
   the hard estimates where you can. Where a category has fewer (too many drops), take its writer's questions the
   checker dropped only for a fault you can fix, fix them and check them as a checker would; never put back a question
   dropped for a wrong answer or an unconfirmed fact. If a category still can't reach `each`, it adds fewer, and you
   say so prominently: the bank holds the categories within 2% of their mean size (`bank add -check` says if the
   batch would break that), so never cut the others to match, and never pad.
4. **Within each category, the plan's cells:** keep each cell's `count`, and the category's `bg` about Bulgaria, where
   the questions allow; report the cells (and a `bg`) that came out short. When you cut, keep the questions in the
   plan's `themes` (those with `write` > 0, the Bulgarian ones first) over those in themes already over their target;
   report the themes the batch wrote into against the plan's `write`.

## Deliver

In `<batch>/final/` (nothing else in it but these):

- `<category>.json` for each of the ten: the questions to add, `each` in each where it could, each with its `sources`
  (the checker's; add the page for anything you confirmed or fixed yourself).
- `images/`: the pictures the final questions use, and nothing else.
- `REPORT.md`: first the blind answers (how many it answered, how many doubts, and for each: kept, fixed or dropped,
  and why); then per category the count added, its cells against the plan, what you dropped, restored or fixed and why;
  every pair you resolved; the problems the writers, the checkers and you found in questions already in the bank (id, what's
  wrong, the source), for the owner's session to fix.

Check the whole batch against the real bank: it must pass (every rule of the bank holds for a new question: an error
otherwise; a give-away across the ten categories too), with the categories within 2% of their mean after it:

```bash
cd <repo> && go run ./cmd/almanac bank add -check -checked-by "new-questions" <batch>/final <bank>
```

Your final answer (structured): the size each category adds, the number of pairs resolved, how many questions were
dropped in all (checkers and you), and the three worst problems the batch caught.
