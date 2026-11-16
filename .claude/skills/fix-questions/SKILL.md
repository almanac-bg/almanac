---
name: fix-questions
description: Fix questions already in АЛМАНАХ's bank by what `almanac bank lint` flags or a rule asks to judge again — a fixer and an independent checker per chunk on pinned models, then `bank add` (all of it or nothing), the report, the commit and the questions live. Run as /fix-questions [rules] [judge] [categories]; for a rule change, add the rule's check first, then run this.
argument-hint: "[rules: all|giveaway,stale,…] [judge: false-fact,easy-picture] [categories]"
disable-model-invocation: true
model: opus
effort: high
---

# Fixing the bank by its rules

How a rule reaches every question it touches, without anyone going through the whole bank: the rule is a check in
code (`internal/bank/rules.go`; `bank lint` lists what breaks it), and this pass fixes exactly those questions. A rule
code can't check is a `judge` item: the questions a selector picks (in `worklist.py`) are judged one by one.

The rules are the `questions` skill's. The bank changes only through `almanac bank add` (a changed question replaces
its id whole; a new one takes the next free id; a retired one says why and by what): checked against the bank as it
would be, all or nothing.

## The models

As `/new-questions`, pinned in `fix.js` per agent: fixers Claude Opus 5.5, checkers Claude Fable 5.2 (effort high).
If an agent fails because a model isn't available, stop and tell the owner; never run on a weaker model.

## Steps

`<repo>`, `<bank>` as in `/new-questions`; `<work>` is `<scratchpad>/fix-<date>`. Run `almanac` as
`go run ./cmd/almanac …` from `<repo>`. The skill's folder is `<repo>/.claude/skills/fix-questions` (`<skill>`).

1. **Make sure the bank is ready**: no batch running (`<bank>/.git/new-questions.lock`; write it for this pass), `git
   -C <bank> status --porcelain` empty, `git -C <bank> pull --ff-only`, `bank check <bank>` with no errors. Keep
   `bank lint -summary <bank>` as the "before".
2. **Mechanical first.** What a program can fix exactly (a value the rule computes, like `tolerance`), fix with a
   short program through the bank's own code, never by hand, set `updated` (and `changed` if what it asks changed),
   and commit it on its own. Then lint again.
3. **The work list**: `python3 -I <skill>/worklist.py <repo> <bank> <work> --rules … --judge … [--categories …]`
   prints the chunks (about 40 questions each, with free ids for replacements).
4. **Fix and check**: `Workflow({scriptPath: "<skill>/fix.js", args: {chunks: [...], work, repo, bank, skill}})`, at
   most about 24 chunks a run (48 agents); run the rest in further runs. Wait for each notification; if `done:
   false`, resume with `resumeFromRunId`. The first run of a new pass: a few chunks only, then read the checkers'
   notes for what the fixers got wrong, and sharpen FIX.md before the rest.
5. **Apply each run**: `python3 -I <skill>/merge.py <work> <bank> <chunks…>` (the checked chunks into
   `<work>/batch/`, their waivers into `<bank>/waivers.json`), then `bank add -checked-by "fix-questions fable-5.2"
   <work>/batch <bank>`, `bank fmt`, `bank check` (no errors). If `bank add` refuses, read why: a chunk whose new
   question collides with another's, or a change that made a new problem, goes back to its checker's notes; leave
   that chunk out (`merge.py` with the others) and fix it in the next round.
6. **Lint again.** What's left (an item the fixer left, a problem a fix made elsewhere) is the next round's work list,
   until a round fixes nothing more; what's left then is listed for the owner.
7. **Report**: `<bank>/reports/<date>-fix-<slug>.md` in Bulgarian: what the pass was for, lint before → after by
   rule, how many changed, replaced (with the new ids), waived and kept, what the checkers took out and the worst
   they caught; then by topic, each changed or new question: id — what changed (the old → the new text, answer or
   fact, short). The chunks' notes (`fix/*.md`, `checked/*.md`) go beside it in `<bank>/reports/<date>-fix-<slug>/`.
8. **Commit and put it live** (as `/new-questions` step 9): one commit per run, the message saying the rules and the
   counts; `almanac-bank` on the server; its count line and 0 errors.
9. **Tell the owner** in a few lines, and **clean up**: the lock, `<work>`, anything of yours.
