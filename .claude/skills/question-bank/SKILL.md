---
name: question-bank
description: Add new questions to АЛМАНАХ's question banks, write and verify their "Знаеше ли?" facts, or fix reported questions. Use whenever the work touches private/questions.json or apps/server/src/data/questions.sample.json — new batches, facts, rewording, difficulty changes, removing a question.
---

# Question bank

The questions are the game: a wrong answer or a wrong fact is the worst bug АЛМАНАХ can ship, because players learn
from it. Every batch is verified independently before it goes in.

## Where things are

- `private/questions.json` — the real bank (~2 000 questions). A clone of the private repo
  `almanac-bg/almanac-questions`, ignored by this repo. Production pulls it on every deploy (`deploy/deploy.sh`).
  It's private so answers can't be searched or copied: never paste many of its questions anywhere public.
- `apps/server/src/data/questions.sample.json` — the public sample (12 per category), an older snapshot of 120
  questions. CI and the browser tests play it. Every Geography question in it has a fact (`apps/web/e2e/facts.spec.ts`
  relies on that): a new sample Geography question needs one too.
- The rules: the zod schema in `apps/server/src/questions.ts` and `apps/server/test/questions.test.ts` (format,
  unique ids and texts, category × difficulty minimums, numeric answers not always in the middle, answer positions
  spread, fact length/source/giveaways). README → „Добавяне на въпроси“ documents the format.
- The tool: `node .claude/skills/question-bank/bank.mjs` — `stats`, `show`, `add`, `facts` (usage at its top). Use
  it to write the banks: it keeps the one-question-per-line layout, so a diff is one line per changed question. For a
  one-off fix, editing that question's line directly is fine.

Node isn't on the tool shell's PATH: `export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"`.

## Adding questions

1. **Find the gaps.** `bank.mjs stats` shows each category by difficulty and the next free id. The content
   priorities (memory: roadmap) are events after 2018, the Balkan neighbours, women authors, sport after 2017, fewer
   "най-…" superlatives in nature. Grep the bank for the topic first: no near-duplicates.
2. **Write them** to a scratch JSON array (ids from `stats`; never reuse a removed question's id, since reports and
   stats refer to ids):
   - Bulgarian, for Bulgarian players. Difficulty for them: easy = most adults know it, medium = a well-read person,
     hard = an enthusiast. Text addressing the player is gender-neutral (CONTRIBUTING → Стил).
   - Question 10–150 characters, ending in "?"; four distinct options of at most 45 characters; exactly one
     defensibly right answer, the others plausible and of the same kind and form (all cities, all years; no odd one
     out like the only multi-word option or the only one in quotes).
   - Nothing in the wording that gives the answer away („Партенонът в Атина“ → Атина), and nothing that answers
     another question: Микс serves every category in one match. Grep the bank for the answer and the key words.
   - Numbers: the right one is the smallest or the largest of the four about half the time (the test fails below
     35%); vary `answer` across 0–3.
   - Nothing that goes stale ("the current", "the latest", records that may fall) unless it's pinned to a date
     („през 2023 г.“).
   - Typography and spelling as in the bank: „…“ quotes, a spaced em dash —, ’ and … characters, "г." after a
     year; Едисон, Ейбрахам Линкълн, Нидерландия (not Холандия), айрян, a hyphen in name-nickname
     (Георги Георгиев-Гого).
3. **Verify independently.** Give a fresh agent the scratch file (questions and answers, not your reasoning) and ask
   it to check each against reliable sources: the marked answer is right, no other option is also right, nothing is
   outdated, the wording has one reading. It reports OK / FIX / DROP with evidence. Apply its fixes; drop what it
   can't confirm.
4. **Add and test.** `bank.mjs add new.json`, then `cd apps/server && node --import tsx --test test/questions.test.ts`.
5. **Commit and push in `private/`** (`git -C private …`, the usual commit trailer). Production gets the change on
   the next deploy; deploying is outward-facing, so ask the owner unless they already said to ship it.
6. **Tell the owner** what went in: a short list (question → answer, and the fact if any), so they can read it.

## Writing "Знаеше ли?" facts

The fact shows right after the answer is revealed (alone, with "Спри, за да прочета" to pause the match; for
everyone in the results' „Научи днес“ and the question review). Players read it in a few seconds.

- One or two sentences, 20–200 characters, ending with a period. Something true and surprising **about the answer**
  that the question didn't say: a cause, a consequence, a number that puts it in scale, a common misconception
  corrected. Not the answer restated, not "Интересно е, че…".
- It must not answer another question in the bank (the test catches the obvious cases; also grep the fact's names
  and numbers against other questions' answers).
- Claim only what the source claims: keep its hedges („според преданието“, „около“, „едно от най-…“). Where sources
  disagree on a number, use wording that's true under all of them („над 3 800 години“).
- Bulgarian number style: four digits without a space (6000, 3700), a non-breaking space (U+00A0) between a
  number and its unit or "г." (2925 м, 1885 г., 7,2 милиона), so a narrow screen never wraps "2925 / м".
- `factSource`: an https page that supports every claim in the fact — the Wikipedia article on the subject (bg or
  en) is fine, Britannica, a museum or official site better where it has the detail.
- **Never from memory alone.** Draft the facts with their sources into a scratch file
  (`[{id, question, answer, fact, factSource}]`), then have a fresh agent fetch every source and check every claim
  (names, dates, numbers, qualifiers like "only", "first", "largest") and the Bulgarian, with a verdict per fact:
  OK, FIX (corrected text) or DROP. Batches of 10–20 per agent keep the checking thorough; several agents can run
  in parallel. Only OK and FIX go in.
- Then `bank.mjs facts verified.json` (and `bank.mjs facts verified.json sample` when the questions are in the
  sample too: ids it doesn't have are listed and skipped; check the sample's wording of the question still fits),
  run the bank test, commit both repos.

## Fixing a reported question

Players report questions in the game; admins see them at `/admin` (a wrong marked answer, more than one right
answer, outdated information, a typo, an error in the fact — with its source linked — or other). Check the report against sources before
changing anything: reports are often wrong. Edit the question's line in place (same id), run the bank test, commit
in `private/`. If the question can't be made unambiguous, delete it rather than keep a bad one; its id stays retired.
