---
name: a-to-z
description: The owner's full expert review of АЛМАНАХ "from A to Z" — the product and everything it runs on (GitHub org, Cloudflare, the server, email, monitoring, accounts) — by parallel reviewers in a workflow, each finding verified, merged into a phased plan. Only when the owner asks for it (/a-to-z): it is a large multi-agent run.
disable-model-invocation: true
---

# The A-to-Z review

The owner asks for this before a big phase of work or after one ships: a full expert review of everything, so the next
plan comes from evidence. Invoking it (`/a-to-z`) is the owner's opt-in for the Workflow tool: load the
`workflow-authoring` skill, write the workflow, run it. One run is a few million tokens (the 12-reviewer run of
2026-10-29 used about four); say so once, in the first message, and go on.

Anything written after `/a-to-z` adjusts the run (e.g. "infrastructure only", "skip the bank"): $ARGUMENTS

## Scope: everything, not only this repo

- **Product.** Security; server and data (SQLite, migrations, realtime, load); web client and performance; gameplay and
  rules (adding, removing or changing modes and mechanics is welcome); a UX tour (screenshots on phone and desktop,
  dark and light themes, signed out and in); accessibility (WCAG 2.2 AA); visual design, brand and sound; copy, SEO and
  the public pages; legal and privacy (GDPR, DSA, children; the policy texts against what the code does); moderation
  and admin; the question bank (a sampled source check of answers and facts, giveaways, balance, staleness); repo, CI,
  tests and docs.
- **Infrastructure.** The GitHub org and every repo in it (settings, protection, Actions, keys, secrets, scanning);
  Cloudflare (DNS, TLS, proxy and caching, rules, R2, alerts, API tokens); the server (OS and Docker updates,
  firewall, Caddy, backups, and an actual restore of the Litestream copy into a temp folder); email (SPF, DKIM, DMARC,
  Proton, Scaleway); monitoring (Sentry, Better Stack); the owner's accounts (2FA, recovery codes, billing alerts,
  DPAs). What needs the owner's UI or a production read goes to them as an exact checklist or a `!` command.

## How to judge

- **The best possible product, not one tuned to today's player count.** Effort and cost are never a reason to leave
  something out. No go-to-market plan unless asked.
- **Know what's decided.** Read the memory, `CHANGELOG.md`, `docs/` and `README.md` first, and give the reviewers what
  is decided and what is already planned. They don't re-raise it without new evidence; with it, they mark it a re-open
  and say why.
- **Evidence for everything**: file:line, a URL, a screenshot, a command and its output; why it matters; a concrete
  fix. Severity critical / high / medium / low. Each reviewer also lists what it checked and found fine, so it isn't
  checked again next time.
- **Verify before reporting.** An independent agent tries to refute each high or medium finding; what doesn't hold up
  is dropped. Dedupe across the areas (several reviewers often find the same root cause).

## The run

1. Write a shared brief to the session scratchpad, `review-<date>/BRIEF.md`: the product and its stack, where to read,
   how to judge, what's decided and planned, the rules below, the report format. Give the areas one each (security,
   server, web-client, gameplay, ux-tour, accessibility, visual-design, copy-seo, legal-privacy, moderation, bank,
   repo-dx, infra-github, infra-cloudflare, infra-server-email) with a port each from 3101 up.
2. Reviewers in parallel, each writing `review-<date>/<area>.md` (evidence in `review-<date>/<area>/`): a summary of
   five lines at most, findings most severe first with IDs (`<AREA>-1`…), ideas, checked and fine.
3. The refute pass over high and medium findings, as soon as each area's report is in.
4. Merge into `review-<date>/PLAN.md`: counts by severity; the findings grouped into phases that ship one by one, most
   important first; the decisions that are the owner's (D1, D2, …), each with a recommendation; and a plain list of
   what the review did **not** cover or couldn't check, and why.
5. Reply with the summary (counts, the top ten, the phases, the decisions, the gaps) and the plan's path. Then stop:
   nothing changes until the owner says go.

## Rules for the reviewers

- **Read-only.** No edits in the repo (build outputs from `npm run build` are fine) and no git command that changes
  anything.
- **Production: public GETs only**, a handful, no load. The server only through `deploy/audit.sh`, Cloudflare only
  through its API with the owner's token header file, GitHub through `gh api`; change nothing there either. The owner
  allowed these as exact command forms: copy them from the memory (production deployment, the allow rules) into the
  brief, never into this public repo (the server's address stays behind Cloudflare).
- **Locally**: each reviewer on its own port with its own `DB_PATH` in its own scratch folder; every `cli` or server
  command gets that `DB_PATH` (one without it once migrated the owner's dev database). Never `apps/server/data`, never
  port 3001. No full test suites (slow for everyone running at once); targeted runs are fine.
- Node: `export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"`. Browser: Brave at
  `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`. No system installs.
- **No personal data in any outside request** (User-Agent `AlmanacBank/1.0 (https://almanac.bg)` for Wikipedia and the
  like). Never paste private-bank questions anywhere public. Secrets never go into a report or the chat.
