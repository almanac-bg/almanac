---
name: new-questions
description: Add a batch of new questions to АЛМАНАХ's bank, start to finish — the plan from the day's runway, a writer and an independent checker per category on pinned models, a cross-check, the bank check, the commit and the questions live on the server. Run as /new-questions [questions per category] [focus].
argument-hint: "[брой на тема, 30] [насока]"
disable-model-invocation: true
model: opus
effort: high
---

# A batch of new questions

`/new-questions` adds a batch to the bank and puts it live: 30 questions a category by default (300 in all), or the number
given first (`/new-questions 50`). Any words after it are the owner's focus for the writers („повече за България след
2015“). Run it through without asking: the plan, the models and every check are fixed here, and the owner reads the
report at the end. Stop and say why only when a step below says to.

The rules for every question are the `questions` skill (`.claude/skills/questions/SKILL.md`); this skill is how a batch
gets made by them. It changes the bank only through `almanac bank add`, never by hand.

## The models

Fixed for every batch, never a session's default:

| Who | Model | Why |
| --- | --- | --- |
| This session (plan, merge, report) | Claude Opus 5.5 (`model: opus` above) | |
| Writers, one per category | Claude Opus 5.5 (`opus`, effort high) | strong writer, half Fable's price for the longest stage |
| Checkers, one per category, and the cross-check | Claude Fable 5.2 (`fable`, effort high) | the most capable model, on the gate that matters, and not the writers' model: a mistake one model is prone to doesn't pass its own blind spot |
| Blind answerers, after the checkers | Claude Sonnet 5.5 (`sonnet`, effort medium) | a third model answers the checked questions without the key; where it's sure of something else, the cross-check settles it from sources |

They are pinned in `batch.js`, per agent, so a subagent setting or another session model doesn't change them (this
skill's `model:` holds only for the turn it starts in; the pins hold for the whole run). If an agent fails because a
model isn't available, stop and tell the owner; never run the batch on a weaker model instead.

## Steps

`<repo>` is the checkout you're in (`git rev-parse --show-toplevel`). `<bank>` is the private bank: `<repo>/private`, or
in a worktree the main checkout's (`$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/private`).
`<batch>` is `<scratchpad>/batch-<date>`. Run the `almanac` commands as `go run ./cmd/almanac …` from `<repo>`.

**Whenever you stop before the end** (a step below says to, or something fails), first put things back: `<bank>` as
it was (`git -C <bank> checkout -- . && git -C <bank> clean -fd -- images`, unless the batch is committed already),
and the lock removed. A lock left behind holds the next batch up for a day.

1. **Make sure the bank is ready.** Stop and say why if any of these fails:
   - no other batch runs: `<bank>/.git/new-questions.lock` doesn't exist (if it does and is over a day old, it was
     left behind: remove it). Then write the lock: the date, this session's folder;
   - `git -C <bank> status --porcelain` is empty, then `git -C <bank> pull --ff-only`;
   - `bank check <bank>` has no errors;
   - `<repo>` has the rules as they are now: `git -C <repo> fetch origin main`, and `git -C <repo> log --oneline
     HEAD..origin/main -- internal/bank cmd/almanac .claude/skills` prints nothing (else the batch would be checked by
     old rules, and the server, which has the new ones, would refuse it at the end: update the checkout first).
2. **Fetch the days' questions** from the server, so that the runway counts what the days have left, not the whole
   bank (only question ids and the last day drawn come back, nothing of a player's):
   `ssh -i ~/.ssh/hetzner -o BatchMode=yes root@2.31.121.12 systemd-run --pipe --wait -p User=almanac -p EnvironmentFile=/etc/almanac/env /usr/local/bin/almanac bank used > <batch>/used.txt`.
   Its second line is `# through <the last day drawn>`; if the command fails, say so and plan without `-used` (the
   runway then counts the whole bank and overstates it).
3. **Plan.** `bank plan -n <N> -json -used <batch>/used.txt <bank> > <batch>/plan.json` (N = the number given, else
   30), and add the owner's focus to it as `"focus"` if one was given. Show the owner the text plan (the same without
   `-json`) in a few lines: how many, which places of the day, the runway before → after with the day the shortest
   runs out on, how many about Bulgaria, and the themes each chapter writes into (the plan's `themes`: the ones
   furthest short of their targets, the Bulgarian ones first). Don't wait for an answer.
4. **Write and check.** Run the workflow, and wait for its notification (don't poll):
   `Workflow({scriptPath: "<repo>/.claude/skills/new-questions/batch.js", args: {plan: <plan.json's content, as an
   object>, batch: "<batch>", repo: "<repo>", bank: "<bank>", skill: "<repo>/.claude/skills/new-questions"}})`.
   It runs ten writers, each category's checker as soon as its writer is done, then the blind answers, then the
   cross-check over all ten. If it
   returns `done: false` (an agent died, a category missing, or the final batch didn't pass), resume it with the same
   `scriptPath`, `args` and `resumeFromRunId`: what finished is kept. Two failed resumes: stop and tell the owner.
5. **Read what came back:** the cross-check's result and `<batch>/final/REPORT.md`. Every category adds the same
   number; if it's less than N, the report says why, and you say so to the owner. If more than a fifth of the batch was
   dropped, read the checkers' `verify/<cat>.md` for a pattern (a writer that guessed, a misread rule) and say it.
6. **Add it.** `bank add -checked-by "new-questions fable-5.2" <batch>/final <bank>` (the checkers' model: change it
   with batch.js), then `bank fmt <bank>` and `bank check -used <batch>/used.txt <bank>`: no errors, the
   categories within 2% of their mean, and no place of the day's runway shorter than in the plan's `days`. If anything fails,
   `git -C <bank> checkout -- . && git -C <bank> clean -fd -- images` and stop. Read the chapters' themes in the
   check's report: each theme the plan wrote into is closer to its target than before.
7. **Fix what the batch found in the bank.** For the problems in REPORT.md about questions already in the bank: check
   each yourself from a source, and fix the real ones by the `questions` skill (set `updated`; a change in what a
   question asks retires it, and its replacement goes in the same cell). Keep these in a commit of their own.
8. **Report.** Write `<bank>/reports/<date>-<slug>.md` in Bulgarian, in the form of the newest report there: a title,
   a short paragraph (what the batch is for, how many, the runway before → after, live per category), one line on the
   process with the models (писатели: Claude Opus 5.5; проверка и обща проверка: Claude Fable 5.2) and how many were
   fixed and dropped; then by category, each question: id · kind/difficulty · flags (дата, България, с картинка) — text →
   answer, and its fact in italics.
   Keep the batch's record beside it: `<batch>/plan.json`, `final/REPORT.md` and the checkers' `verify/<cat>.md` into
   `<bank>/reports/<date>-<slug>/` (each question's sources are in the question itself).
9. **Commit and put it live.** In `<bank>`: `git add -A`, commit `feat: <count> questions …` (what they are for, the
   bank's size per category after; the body lists the ids by category), `git push`. Then on the server:
   `ssh -i ~/.ssh/hetzner -o BatchMode=yes root@2.31.121.12 almanac-bank`. Its first line must be the bank's count
   (`…: N questions (M live)`, M the new live total), its second the problems counted (`…: 0 errors, W warnings
   (by rule)`: anything but 0 errors stops it before the bank on the server moves, with the errors), and its last `live: <your commit>` (the server confirmed it plays it). If the push
   or the server step fails, say so; the batch is safe in the commit. `almanac-bank` and a deploy of the game share one
   lock: if a deploy is under way it says so and waits for it, by itself. Let it wait; never reload the bank another
   way (a reload during a deploy's health watch sent a healthy release back, 23 Nov 2026).
10. **Tell the owner,** in a few lines: how many went in, the runway before → after, how many the checks dropped and
   the worst they caught, what was fixed in older questions, a handful of the new questions (question → answer), and
   the report's path.
11. **Clean up:** remove the lock and `<batch>` (its record is in the bank's commit now), and anything else of yours
    (CLAUDE.md, "Leave the machine as you found it").

## When it goes wrong

- **The bank changed under the batch** (another session committed to it): `bank add` refuses ids that aren't the
  next free ones (an id the bank has now reads as a change to that question, refused with "or, as a new question,
  it takes the next free id"). Renumber the final files from the new `firstId`s (the ids aren't used anywhere yet) and add again.
- **`bank add` says „its kind changed“:** a question keeps its kind for good. Retire the old one (`retire.json`:
  `{"id", "why", "by"}`) and add the new one with a new id.
- **`bank add` says „added is …: a new question is added today“:** the batch took more than 7 days from its plan. Set
  `added` and `updated` of its questions to today and add again.
- **`almanac-bank` says „not taken: … has errors“ with an unknown field or „no such rule“,** while `bank check` passes
  here: the server's program is older than this checkout (a field or a rule it doesn't know yet). Nothing moved on
  the server and the game plays the bank it had. Get the game's release live first (`https://almanac.bg/api/health` shows the version it runs), then run
  `almanac-bank` again. Never the other way round: the server never goes back to a program older than its bank
  (`almanac-deploy` refuses one that can't read it).
- **A writer or checker ran out of web search:** the brief tells them to fetch pages directly; what they couldn't
  confirm is dropped, and the cross-check fills from spares. A category far short: resume, or run that category again.
- **Never** skip the checkers or the cross-check, relax a rule to keep a question, or put a dropped question back
  without a source.
