# Checking a category's part of a batch

You check another agent's new questions before they go into the bank of АЛМАНАХ, a Bulgarian quiz game. A wrong
answer or a wrong fact is the worst bug the game can ship: players learn from it. You didn't write these. Trust
nothing in them, and nothing the writer says about them.

Your prompt gives you: `<skill>` (this folder), `<repo>` (the game's code), `<bank>` (the real bank, **read-only**),
`<batch>` (this batch's folder) and your category.

## Read first

- `<repo>/.claude/skills/questions/SKILL.md`: the rules, the difficulty rubric, the format, the style.
- `<skill>/WRITE.md`: what the writer was asked, the dated questions and the pictures included.
- Your category's entry in `<batch>/plan.json`.
- The questions: `<batch>/write/<category>/<category>.json`, their pictures in `images/`. The writer's sources are in
  `<batch>/sources/<category>.json`: a place to start, never enough. Confirm each claim from a page you open yourself, a second source
  where one exists.

## Check every question

1. **The answer:** the marked answer is right under every reliable source; no wrong option is also right, or could be
   argued to be; nothing is outdated (or it is pinned to a date, with `reviewBy`).
2. **The fact:** true, about the answer (not about something else the question mentions), says something the
   question didn't, claims no more than the sources (their hedges kept: „около“, „според преданието“), at most 140
   characters.
3. **Dates (`on`):** the date is exactly the day of what the question is about; the `day` line is true, names that
   date and says what happened on it, in one short sentence; the text names the date only if the date is what's
   asked; a true-or-not never names it (dealt on its date, it would answer itself); the fact says something new, not
   the date again. Bulgarian events before 1916 on the New Style date Bulgaria marks today.
4. **One reading:** the wording can't be read two ways. True-or-not is false by one clear fact, never by a trick,
   and a false one's fact starts with what is true. Numbers are estimates (a year, or more than 20 steps), with one
   accepted value (or the text pins the source) and the skill's tolerance formula, and **a well-read player can place
   them** (an anchor: a height, a distance, an age, a famous total, named in the text or the fact), never an archive's
   count (episodes, seats, a council's members, prize money, works, goals, awards, times): such a number is a DROP or
   a FIX. An easy true-or-not that nobody could miss (a truism, not a misconception) is a FIX. **The category:** it belongs under its category
   (a player of the category expects it there). Orders: exact values, measured ones
   10% apart. Matches: one right per left, a tempting decoy that fits no left. Splits: every item in its group only,
   under every source. Clues are off (2026-11-23): a new clues question is a DROP.
5. **The difficulty** fits the rubric for players in Bulgaria. Relabel only within the plan's cells: a question that
   doesn't fit its cell is a FIX (reword or change options) or a DROP, not a relabel into a cell the plan didn't ask
   for.
6. **No giveaways, no near-duplicates:** grep the bank (`<bank>/questions/*.json`, case-insensitively) and the rest
   of this file for the answer, the key names, years and numbers. Another question or fact that gives this one away,
   or that this one gives away (at the reveal too: every value of an order, every option's name), is a DROP or a FIX
   that removes the leak. No "who or what is this" answer the bank asks already. This is the commonest flaw.
   `bank add -check` finds the plain cases (a value next to the same subject, both sides of a pair, shared order
   items, an identity asked twice) as errors; the rest only a reader finds: a name, a date said another way.
7. **Pictures:** the picture really is what it says; the licence on its Commons page is PD, CC0, CC BY or CC BY-SA
   (an artwork: the artist died 70+ years ago); no legible text naming the answer; it reads at about 170×100 px on a
   phone. Look at each with the Read tool.
8. **`bg`** is right: about Bulgaria, not merely in Bulgarian. **`avoid`:** no answer or main subject from the plan's
   list. **`theme`** is the one of the chapter's themes (`<bank>/themes.json`, what each `covers`) the question is
   mainly about: fix a wrong one (it's a label, never a reason to drop).
9. **Bulgarian:** standard literary Bulgarian; „…“ quotes, spaced dash —, „г.“ after a year; Bulgarian words, not
   Russian ones or loanwords (check the ones you're unsure of in rechnik.chitanka.info or the РБЕ); gender-neutral to
   the player.

Fetch pages with WebFetch (bg/en Wikipedia, Britannica, official sites, Commons file pages); WebSearch is
rate-limited, so when it fails go on with WebFetch. **Anything you cannot confirm from a page you've read is a DROP.**
Politics and recent history: facts only, nothing that reads as a judgement. Never send personal data anywhere.

## Deliver

- `<batch>/verify/<category>/<category>.json`: the questions as they should go in. OK ones unchanged; FIXed ones
  corrected (same id, `updated` stays the plan's date); DROPped ones left out. Keep the ids as they are: gaps are
  fine. **Every kept question carries `sources`**: the pages you confirmed it on yourself (https://…, the answer's and
  the fact's), the writer's ones only where you read them and they hold.
- `<batch>/verify/<category>/images/`: the pictures the kept questions use (copied from the writer's `images/`, or new ones you made by
  WRITE.md's rules for a picture you swapped).
- `<batch>/verify/<category>.md`: one line per question: id, OK / FIX / DROP, and for FIX and DROP what was wrong and the source.
  A changed difficulty stands out: **difficulty: medium → hard**.

Check it against the real bank, and fix what it reports:

```bash
cd <repo> && go run ./cmd/almanac bank add -check <batch>/verify/<category> <bank>
```

Your final answer (structured): the counts OK / FIX / DROP, how many you kept in each cell of the plan, and the worst
problem you found.
