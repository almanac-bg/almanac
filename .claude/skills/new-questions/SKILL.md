---
name: new-questions
description: Add a batch of new questions to АЛМАНАХ's bank, start to finish — the plan from the day's runway, a writer and an independent checker per topic on pinned models, a cross-check, the bank check, the commit and the questions live on the server. Run as /new-questions [questions per topic] [focus].
argument-hint: "[брой на тема, 30] [насока]"
disable-model-invocation: true
model: opus
effort: high
---

# A batch of new questions

`/new-questions` adds a batch to the bank and puts it live: 30 questions a topic by default (300 in all), or the number
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
| Writers, one per topic | Claude Opus 5.5 (`opus`, effort high) | strong writer, half Fable's price for the longest stage |
| Checkers, one per topic, and the cross-check | Claude Fable 5.2 (`fable`, effort high) | the most capable model, on the gate that matters, and not the writers' model: a mistake one model is prone to doesn't pass its own blind spot |

They are pinned in `batch.js`, per agent, so a subagent setting or another session model doesn't change them (this
skill's `model:` holds only for the turn it starts in; the pins hold for the whole run). If an agent fails because a
model isn't available, stop and tell the owner; never run the batch on a weaker model instead.

## Steps

`<repo>` is the checkout you're in (`git rev-parse --show-toplevel`). `<bank>` is the private bank: `<repo>/private`, or
in a worktree the main checkout's (`$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/private`).
`<batch>` is `<scratchpad>/batch-<date>`. Run the `almanac` commands as `go run ./cmd/almanac …` from `<repo>`.

1. **Make sure the bank is ready.** Stop and say why if any of these fails:
   - no other batch runs: `<bank>/.git/new-questions.lock` doesn't exist (if it does and is over a day old, it was
     left behind: remove it). Then write the lock: the date, this session's folder;
   - `git -C <bank> status --porcelain` is empty, then `git -C <bank> pull --ff-only`;
   - `bank check <bank>` has no errors.
2. **Plan.** `bank plan -n <N> -json <bank> > <batch>/plan.json` (N = the number given, else 30), and add the
   owner's focus to it as `"focus"` if one was given. Show the owner the text plan (`bank plan -n <N> <bank>`) in a
   few lines: how many, which places of the day, the runway before → after. Don't wait for an answer.
3. **Write and check.** Run the workflow, and wait for its notification (don't poll):
   `Workflow({scriptPath: "<repo>/.claude/skills/new-questions/batch.js", args: {plan: <plan.json's content, as an
   object>, batch: "<batch>", repo: "<repo>", bank: "<bank>", skill: "<repo>/.claude/skills/new-questions"}})`.
   It runs ten writers, each topic's checker as soon as its writer is done, then the cross-check over all ten. If it
   returns `done: false` (an agent died, a topic missing, or the final batch didn't pass), resume it with the same
   `scriptPath`, `args` and `resumeFromRunId`: what finished is kept. Two failed resumes: stop and tell the owner.
4. **Read what came back:** the cross-check's result and `<batch>/final/REPORT.md`. Every category adds the same
   number; if it's less than N, the report says why, and you say so to the owner. If more than a fifth of the batch was
   dropped, read the checkers' `verify/<cat>.md` for a pattern (a writer that guessed, a misread rule) and say it.
5. **Add it.** `bank add <batch>/final <bank>`, then `bank fmt <bank>` and `bank check <bank>`: no errors, every
   category the same size, and no place of the day's runway shorter than in the plan's `days`. If anything fails,
   `git -C <bank> checkout -- . && git -C <bank> clean -fd -- images` and stop.
6. **Fix what the batch found in the bank.** For the problems in REPORT.md about questions already in the bank: check
   each yourself from a source, and fix the real ones by the `questions` skill (set `updated`; a change in what a
   question asks retires it, and its replacement goes in the same cell). Keep these in a commit of their own.
7. **Report.** Write `<bank>/reports/<date>-<slug>.md` in Bulgarian, in the form of the newest report there: a title,
   a short paragraph (what the batch is for, how many, the runway before → after, live per topic), one line on the
   process with the models (писатели: Claude Opus 5.5; проверка и обща проверка: Claude Fable 5.2) and how many were
   fixed and dropped; then by topic, each question: id · kind/difficulty · flags (дата, България, с картинка) — text →
   answer, and its fact in italics.
8. **Commit and put it live.** In `<bank>`: `git add -A`, commit `feat: <count> questions …` (what they are for, the
   bank's size per topic after; the body lists the ids by topic), `git push`. Then on the server:
   `ssh -i ~/.ssh/hetzner -o BatchMode=yes root@2.31.121.12 almanac-bank`. Its first line must be the bank's count
   (`…: N questions (M live)`, M the new live total; anything else is a problem the server found) and its last your
   commit; then `journalctl -u almanac -n 20 --no-pager` over the same ssh shows the reload with no error. If the push
   or the server step fails, say so; the batch is safe in the commit.
9. **Tell the owner,** in a few lines: how many went in, the runway before → after, how many the checks dropped and
   the worst they caught, what was fixed in older questions, a handful of the new questions (question → answer), and
   the report's path.
10. **Clean up:** remove the lock and `<batch>` (it's in the commit and the report now), and anything else of yours
    (CLAUDE.md, "Leave the machine as you found it").

## When it goes wrong

- **The bank changed under the batch** (another session committed to it): `bank add` refuses ids that aren't the
  next free ones. Renumber the final files from the new `firstId`s (the ids aren't used anywhere yet) and add again.
- **A writer or checker ran out of web search:** the brief tells them to fetch pages directly; what they couldn't
  confirm is dropped, and the cross-check fills from spares. A topic far short: resume, or run that topic again.
- **Never** skip the checkers or the cross-check, relax a rule to keep a question, or put a dropped question back
  without a source.
