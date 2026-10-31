export const meta = {
  name: 'a-to-z-review',
  description: 'A-to-Z review of АЛМАНАХ: 15 area reviewers, an independent refute pass over every high/medium finding, one merged phased plan',
  phases: [
    { title: 'Review', detail: '15 reviewers in parallel, one area each, each writing <area>.md' },
    { title: 'Verify', detail: 'independent agents try to refute each high/medium finding as soon as its area is in' },
    { title: 'Plan', detail: 'dedupe across areas, phases, owner decisions, gaps → PLAN.md' },
  ],
}

// The A-to-Z review (SKILL.md). Run with the Workflow tool after writing the brief:
//   Workflow({scriptPath: '.claude/skills/a-to-z/workflows/review.js', args: {dir: '<scratchpad>/review-<date>'}})
// <dir>/BRIEF.md is the shared brief; each area writes <dir>/<area>.md, the refuters <dir>/verify/, the merge PLAN.md.
const R = args.dir

const AREAS = [
  { key: 'security', prefix: 'SEC', port: 3101, scope: `Application security end to end: auth (passwords/scrypt, sessions, sign-out, password reset, verify-email), admin roles and TOTP 2FA, CSRF and origin checks, CSP and the other headers (live and in code), rate limits/throttling (throttledNetwork), Socket.IO auth and per-event validation, uploads and signed picture URLs (set_images, /qimg), SSRF (push endpoint allowlist; the audit shows the cloud metadata service is reachable from the app container — is there any path for the app to be made to fetch a URL?), injection (SQL, HTML in mails, \`$\` patterns in the head), the data export's exclusion list, Sentry/monitoring scrubbing, the tunnel, dependencies (\`npm audit --omit=dev\` is fine: package names only), secrets in the repo and its history (grep; the bank must never be in the public repo), CodeQL state (\`gh api repos/almanac-bg/almanac/code-scanning/alerts?state=open\`), SECURITY.md and security.txt. New code since 29 Oct: Phase 7 (findConflicts, calendar dailies, holiday pages, /qimg with the new images). Try real attacks against your own local server (accounts, guests, sockets), never production.` },
  { key: 'server', prefix: 'SERVER', port: 3102, scope: `Server and data: the SQLite schema and migrations (now v39+; compatible flags, the pre-migration copies, rollback to the previous image), indexes and query plans (\`npm run plans\` exists), transactions and SQLITE_BUSY handling, Litestream interplay (busy_timeout, the lock), upkeep/maintenance steps, tallies, the realtime layer (Socket.IO rooms, reconnects, drain/handover on deploy, the evening Роял lobby), the matchmaker and bots, memory/CPU on a 2-CPU 4 GB ARM box, unbounded growth (match rows never pruned, answers log, logs), the bank loader (findConflicts at every load: cost and correctness with 3,900+ questions), error handling and what reaches Sentry. A short local load run on your own port and DB (≤2 minutes, e.g. \`npm run load -w @quiz/server\` with your PORT/DB_PATH, see docs/testing.md) is fine.` },
  { key: 'web-client', prefix: 'WEB', port: 3103, scope: `The web client and its performance: bundle and chunk sizes from the existing dist (don't rebuild), first load and route loads, lazy pages and preloading, the service worker (caching, update flow, offline page, pushsubscriptionchange), the app-version gate, state/store design, socket reconnect and resume, error boundaries and retries (R4c's WEB-3..17: check they hold), memory leaks over a long session (several matches in a row), rendering cost (see the 28 Oct lesson: infinite animations behind blur; measure CPU idle and during a match with Brave + CDP), images (/qimg pictures, srcset of the art), hydration of the drawn public pages (App.tsx isPublicPath / LEGAL_PATHS — the hyphenated holiday pages were once drawn as the landing), WebKit and Firefox behaviour where you can run them.` },
  { key: 'gameplay', prefix: 'GAMEPLAY', port: 3104, scope: `Gameplay and rules as a game designer: every mode (Соло and its paces, Дуел rounds and the pick, Арена 3–5, Отбори pairs, Роял 8 and its knockouts, the evening Роял up to 50, rooms/class rooms, own sets, friend duels, recordings, „Поправителен“, the daily), scoring (speed, streaks, the number final ×2 from 2026-10-31, teamPoints), козове, bots (the guessing model), rating/skill and mastery, XP/levels and the 1-of-2 choice, quests, achievements, groups, the calendar dailies and the new formats' place in matches (pictures, „Подреди“, 40 finals per category). docs/rules.md against the code. Play matches locally (GAME_TIME_SCALE, BOT_FILL_SECONDS=1). Adding, removing or changing modes and mechanics is welcome: propose boldly where the evidence supports it, and say what each change would do to the experience.` },
  { key: 'ux-tour', prefix: 'UX', port: 3105, scope: `A UX tour with screenshots of every screen, on a phone (390×844) and a desktop (1440×900), in dark and light themes, signed out, as a guest and signed in (make accounts on your local server; use the private bank so the content is real, and \`cli\` with your DB_PATH for anything you need set up). Cover the landing, the daily, every mode's lobby/match/results/RewardMoment, the number final, pictures and „Подреди“, rooms (host + presenter screen + player, with a second browser context), own sets, the profile, „Моят алманах“, the locker and the level choice, friends/groups, settings (push, keys, pace), the holiday and guide pages, errors/empty states/offline. Judge flows, clarity, friction, feedback, consistency and delight. Put screenshots in your folder and cite their paths.` },
  { key: 'accessibility', prefix: 'A11Y', port: 3106, scope: `Accessibility against WCAG 2.2 AA (not only 2.1): the new 2.2 criteria especially — 2.4.11 focus not obscured, 2.5.7 dragging movements („Подреди“!), 2.5.8 target size, 3.2.6 consistent help, 3.3.7 redundant entry, 3.3.8 accessible authentication (2FA, password reset) — plus keyboard play of every format (matchKeys), screen-reader semantics (MatchAnnouncer, live regions, the question h1, pictures' alt text vs giveaways), contrast in both themes (e2e/contrast.spec.ts exists), reduced motion, zoom 200%/400% and reflow, timing (timed questions: 2.2.1 — what do the paces offer?), language attributes (lang="bg"), the presenter screen, errors and forms. Run axe (it's in apps/web) on many screens, signed in and out, both themes; keyboard-walk the flows yourself.` },
  { key: 'visual-design', prefix: 'VD', port: 3107, scope: `Visual design, brand and sound: the new rosette mark everywhere it should be (nav, landing, favicon/apple-touch/maskable/badge icons — check the actual PNG bytes look right, og.jpg, the offline page, emails, the presenter screen, share texts), typography (Unbounded/Onest, sizes, Bulgarian letterforms), colour and both themes, spacing and rhythm, iconography and the Fluent art, motion (staged moments, RewardMoment) and its cost, the category faces, the big screen, pictures in questions (cropping, credits), and sound (the cues in code and files: levels, timing, what plays when, mute/settings). Take your own screenshots (phone/desktop, dark/light). Say what would make it look and feel world-class.` },
  { key: 'copy-seo', prefix: 'COPY', port: 3108, scope: `Copy, SEO and the public pages: every player-facing string (Bulgarian quality, tone, gender-neutral, consistency of terms, typography: quotes „“, dashes, nbsp), emails and push texts, share texts, errors; the public pages (landing, /how-to-play, /quiz and /quiz/<category>, the eight holiday pages incl. the seven new ones — check each question against the page's own title, lead and the other questions for giveaways — /facts, /teachers, legal pages), titles, descriptions, canonical/og tags, structured data, sitemap.xml and robots.txt (live and from the build), hreflang/lang, internal links, page speed signals, what a search engine sees without JavaScript. A handful of production GETs to compare live with local.` },
  { key: 'legal-privacy', prefix: 'LEGAL', port: 3109, scope: `Legal and privacy: GDPR (lawful bases, the privacy policy's every claim checked against what the code actually stores, sends and keeps — retention, logs, Sentry, push, email, backups in R2, the answers log, IP handling behind Cloudflare), processors and transfers (Hetzner, Cloudflare incl. the proxy, Scaleway, Sentry EU, Proton, Better Stack, GitHub/ghcr — are all named, correctly?), data subject rights (export, deletion, erased_bans), children (under-14s, class rooms, room-only guests), the DSA (notice and action, statements of reasons, appeals, the contact points, transparency), the terms, cookies/local storage and the ePrivacy angle, consent records, email law (unsubscribe, Auto-Submitted), licences (AGPL obligations incl. the source link, picture licences and credits, fonts, /licenses.txt), the public holiday pages' content rights. Bulgarian law where relevant (ЗЗЛД, КЗП, the age of consent for information society services in Bulgaria).` },
  { key: 'moderation', prefix: 'MOD', port: 3110, scope: `Moderation and admin: /admin as the owner and as a moderator (make both locally with \`cli admin\` and your DB_PATH; 2FA), reports and cases (players, groups, sets, questions), decisions, statements of reasons and mails, undo and the log, bans and appeals, renames and the name filters (usernames, group/set/room names, staff words), community questions (submissions, the similar list, „Поправих го“), picture blocking, auto-hide at 3 flags, alerts and the 09:00 digest, stats, the bank reload, abuse paths (mass reports, sockpuppets, guests, room spam, set spam). The 29 Oct items left out (MOD-16, 17, 19, 20, MOD-10): judge again on merit. Walk the flows in a browser and read the code.` },
  { key: 'bank', prefix: 'BANK', port: 3111, scope: `The question bank (private/questions.json + private/images; the public sample; the holiday pages' questions in apps/web/src/content/*.json): a sampled source check — at least 120 questions across all categories, difficulties and formats, weighted toward the ~800 added in Phase 7 (four-option, number finals, pictures, „Подреди“) but including older ones — checking the answer, the wrong options, the "Знаеше ли?" fact and its source against Wikipedia or another reliable source (User-Agent AlmanacBank/1.0 (https://almanac.bg); search for the fact, never the question's text). Also: giveaways (a question's text, options, fact or picture naming its own or another's answer), ambiguity, difficulty labels that look wrong, balance and coverage (\`node .claude/skills/question-bank/bank.mjs stats\` and other read-only commands only — nothing that writes), staleness (answers that change: office holders, records, "current", populations; list them with a review date), picture licences and credits, the public pages repeating bank questions. Never paste private questions anywhere public. Cite questions by id.` },
  { key: 'repo-dx', prefix: 'REPO', port: 3112, scope: `The repo, CI, tests and docs: .github/workflows/ci.yml (jobs, required checks vs job names, caching, timeouts, pinning, permissions, provenance, the publish job), Dependabot, the test suites (coverage of the newest code: Phase 7's findConflicts, calendar dailies, holiday pages, bank.mjs; flaky tests — WebKit class.spec, the Дуел pairing), lint/format/typecheck (\`npm run typecheck\` and \`npm run lint\` are fine to run), the scripts, the docs/ (are they true today? a newcomer's path from clone to a running app without the private bank), README, CONTRIBUTING, CHANGELOG's form, the .claude skills (question-bank, a-to-z) as maintainable tools, dead code, package names still @quiz/* after the rename to almanac (judge whether that matters), licence headers. Recent CI runs: \`gh run list -R almanac-bg/almanac -L 30\` and their timings/failures.` },
  { key: 'infra-github', prefix: 'GH', port: 3113, scope: `The GitHub organization almanac-bg and every repo it has (and otsirh/almanac.bg, the old repo with the bank's history: is it private and archived?): org settings readable with the token (members, 2FA requirement, base permissions, apps/installations, outside collaborators, verified domain), each repo's settings (visibility, default branch, merge options, delete-branch-on-merge, wiki/issues/discussions, social preview — GraphQL openGraphImageUrl/usesCustomOpenGraphImage: was the new rosette preview uploaded?), branch protection and rulesets (required checks vs the CI's actual job names), Actions (permissions, allowed actions, workflow token default, runners, secrets and variables by name only, environments), deploy keys (the server's read-only key on almanac-questions), webhooks, security features (Dependabot alerts and updates, code scanning, secret scanning and push protection), releases/tags, the ghcr package (what you can see without read:packages), CODEOWNERS. The owner's own account: what gh can read (keys, sessions need the owner). Reads only. Put what needs admin:org / read:packages / the owner's UI on a checklist.` },
  { key: 'infra-cloudflare', prefix: 'CF', port: 3114, scope: `Cloudflare for almanac.bg through the API (GET only, the exact curl form in the brief): verify the token; every zone setting (SSL/TLS mode, min TLS, TLS 1.3, HSTS, always-HTTPS, automatic HTTPS rewrites, 0-RTT, HTTP/3, early hints, Brotli, Rocket Loader/minify off?, caching level, browser cache TTL, development mode, IPv6, WebSockets, pseudo-IPv4, IP geolocation, security level, challenge passage, browser integrity check, bot fight mode, email obfuscation (does it break pages?), server-side excludes, hotlink protection), DNS records (every record: proxied or not and why, stale ones, the SPF comment, CAA, MX, DKIM CNAMEs, DMARC, the GitHub org verification TXT, google-site-verification), certificates (edge, the origin's Let's Encrypt cert renewal through the proxy), rules (page rules, cache rules, transform rules, redirect rules, configuration rules, WAF custom/managed rules, rate limiting), what is cached at the edge (live GETs: cf-cache-status on pages, /assets, sw.js, /qimg, /api), the DMARC reports (GraphQL dmarcReportsSourcesAdaptiveGroups over the last weeks), analytics for anomalies, HSTS preload status (hstspreload.org API). Account-level items (R2 bucket settings/lifecycle/public access, API tokens incl. the never-expiring Litestream token, alerts, members, audit log, billing) go to the owner's checklist with exact steps.` },
  { key: 'infra-server-email', prefix: 'OPS', port: 3115, scope: `The server, email, monitoring and the owner's accounts. Server: start from $R/infra-server-email/audit-2026-10-31.txt (you may re-run the audit once, in the exact form in the brief) — OS and kernel updates (a kernel update is waiting: is it ever installed? reboot policy), Docker updates, ufw vs the Hetzner firewall, sshd, containers' limits, Caddy (deploy/Caddyfile: headers, trusted proxies, HTTP/3, logs), the deploy/rollback/pull-image/check/backup-check scripts as written, cron, disk, the cloud-init failures. Backups: Litestream config (deploy/litestream.yml: retention, snapshot interval, validation), Hetzner Backups, the daily backup-check.sh restore — and an actual restore of the Litestream copy into a temp folder: you can't run it, so write the exact one-line \`! ssh …\` command the owner should run (restore into /tmp on the server, quick_check, count users, delete it), and say what result means what. The disaster plan: how long from "server gone" to "live again", is it written and was it ever rehearsed? Email: SPF/DKIM/DMARC alignment for both senders (dig the records; read the mailer code and its headers), MTA-STS, TLS-RPT, BIMI (ideas), bounce/complaint handling (the TEM webhook route), deliverability. Monitoring: Sentry config in code (release tags, source maps, sample rates, scrubbing, alert rules — the owner's UI), Better Stack monitors and heartbeats (what failures would go unnoticed today?), check.sh's checks. The owner's accounts: an exact checklist for Hetzner, Cloudflare, Scaleway, Sentry, Better Stack, Proton, GitHub, Bitwarden, Google Search Console and the registrar SuperHosting — 2FA, recovery codes stored, billing alerts/limits, DPAs accepted, members, API keys and their expiry.` },
  { key: 'mobile', prefix: 'MOBILE', port: 3116, scope: `The native app (brought back on 2026-10-31): its state in apps/mobile (or on the local branch \`mobile-app\`, read with \`git show\`/\`git archive\`, never checked out or pushed) against today's main (protocol and API drift, the shared packages under React Native), the approach (Expo / React Native vs a wrapped PWA), what the App Store and Google Play require (user content: report, block, filter; in-app account deletion; age rating; privacy labels and the Data safety form; children), native push next to web push, sessions and deep links (apple-app-site-association, assetlinks.json), legal and privacy for the app, its icon and listing, and how it's built, signed, released and tested; a phased path and the owner's accounts and devices.` },
]

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    report_path: { type: 'string' },
    summary: { type: 'string', description: 'at most five lines' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          kind: { type: 'string', enum: ['new', 'regression', 're-open'] },
          title: { type: 'string', description: 'one line' },
          evidence: { type: 'string', description: 'file:line, URL, command or screenshot path; short' },
          fix: { type: 'string', description: 'one or two lines' },
        },
        required: ['id', 'severity', 'kind', 'title', 'evidence', 'fix'],
      },
    },
    ideas: { type: 'array', items: { type: 'string' } },
    owner_items: { type: 'array', items: { type: 'string' }, description: 'what only the owner can check or do, with exact commands' },
    not_covered: { type: 'array', items: { type: 'string' } },
    checked_fine_count: { type: 'integer' },
  },
  required: ['area', 'report_path', 'summary', 'findings', 'not_covered', 'owner_items'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    notes_path: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['kept', 'refuted', 'downgraded', 'upgraded'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'the severity it should have' },
          reason: { type: 'string' },
          evidence: { type: 'string', description: 'what you ran or read that settles it' },
        },
        required: ['id', 'verdict', 'severity', 'reason', 'evidence'],
      },
    },
  },
  required: ['verdicts'],
}

const reviewPrompt = (a) => `You are the **${a.key}** reviewer in an A-to-Z review of АЛМАНАХ (almanac.bg).

First read the shared brief: ${R}/BRIEF.md — it has the product, where to read, how to judge, what's decided and planned, the rules (read-only; production public GETs only; your own port and DB_PATH for every server/cli command; no full test suites; no npm run build; no secrets in output) and the report format. Follow it exactly.

Your area: ${a.key}. Finding ID prefix: ${a.prefix}-1, ${a.prefix}-2, … Your port: ${a.port}. Your folder: ${R}/${a.key}/ (create it; databases, screenshots, scripts and notes go there). Your report: ${R}/${a.key}.md.

Scope:
${a.scope}

Be thorough and concrete: this review decides the next phase of work. Every high or medium finding will go to an independent agent who tries to refute it, so give exact evidence (file:line at HEAD, a command and its output, a screenshot path). Don't re-raise what the brief lists as decided or planned unless you have new evidence (then mark it re-open). Stop any server you started before you finish.

When the report is written, return the structured result: the same findings in short form (id, severity, kind, one-line title, short evidence, short fix), your ideas in one line each, the owner items, what you didn't cover, and how many things you checked and found fine.`

const verifyPrompt = (a, chunk, j) => `You are an independent verifier in an A-to-Z review of АЛМАНАХ (almanac.bg). The **${a.key}** reviewer reported the findings below. Your job is to **try to refute each one**: you did not write them and you have no stake in them.

Read the shared brief first: ${R}/BRIEF.md (the rules apply to you too: read-only on the repo; production public GETs only; Cloudflare/GitHub reads in the exact forms given; no ssh except the audit, whose output is in ${R}/infra-server-email/; if you run a server or cli, use port ${3200 + AREAS.indexOf(a) * 10 + (j % 10)} and DB_PATH under ${R}/verify/${a.key}-${j}/; no npm run build; no full test suites). Then read the full text of each finding in the report ${R}/${a.key}.md.

For each finding, check independently at HEAD:
1. Is the evidence accurate? (Open the file:line, run the command, look at the screenshot or reproduce it.)
2. Does the claim follow, and is it a real problem for the product or its users/operators?
3. Is it already fixed, already decided or already planned according to the brief (then it's refuted unless it brings new evidence)?
4. Is the severity right? (critical: live harm or data loss now; high: a serious defect, risk or gap; medium: a clear problem worth fixing soon; low: polish.)

Verdicts: "kept" (holds, severity right), "downgraded"/"upgraded" (holds, different severity), "refuted" (wrong, not reproducible, already fixed, or already decided/planned without new evidence). For a judgement call (design, copy, a rule), keep it only if the evidence exists and the reasoning would convince a demanding expert; otherwise refute. Write your notes (what you ran and saw, per finding) to ${R}/verify/${a.key}-${j}.md.

Findings to verify:
${chunk.map((f) => `- ${f.id} [${f.severity}, ${f.kind}] ${f.title}\n  evidence: ${f.evidence}\n  fix: ${f.fix}`).join('\n')}`

const chunks = (list, size) => {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

phase('Review')
const results = await pipeline(
  AREAS,
  (a) => agent(reviewPrompt(a), { label: `review:${a.key}`, phase: 'Review', schema: REVIEW_SCHEMA }),
  async (review, a) => {
    if (!review) {
      log(`${a.key}: the reviewer returned nothing`)
      return { area: a.key, review: null, verdicts: [] }
    }
    const f = review.findings || []
    const highs = f.filter((x) => x.severity === 'critical' || x.severity === 'high')
    const mediums = f.filter((x) => x.severity === 'medium')
    const groups = [...chunks(highs, 2), ...chunks(mediums, 4)]
    log(`${a.key}: ${f.length} findings (${highs.length} critical/high, ${mediums.length} medium) → ${groups.length} verifiers`)
    const out = await parallel(
      groups.map((g, j) => () =>
        agent(verifyPrompt(a, g, j), { label: `verify:${a.key}-${j}`, phase: 'Verify', schema: VERDICT_SCHEMA }),
      ),
    )
    const verdicts = out.filter(Boolean).flatMap((v) => v.verdicts || [])
    const missing = [...highs, ...mediums].filter((x) => !verdicts.some((v) => v.id === x.id)).map((x) => x.id)
    if (missing.length) log(`${a.key}: no verdict for ${missing.join(', ')} (kept as reported, marked unverified)`)
    return { area: a.key, review, verdicts, unverified: missing }
  },
)

phase('Plan')
const done = results.filter(Boolean)
const failed = AREAS.filter((a) => !done.some((d) => d.area === a.key && d.review)).map((a) => a.key)
if (failed.length) log(`areas without a report: ${failed.join(', ')}`)

const lines = []
for (const d of done) {
  if (!d.review) continue
  const r = d.review
  lines.push(`### ${d.area} — report ${r.report_path}`)
  lines.push(`summary: ${r.summary}`)
  lines.push(`checked and fine: ${r.checked_fine_count ?? '?'} items`)
  for (const f of r.findings || []) {
    const v = d.verdicts.find((x) => x.id === f.id)
    const status = v ? `${v.verdict} → ${v.severity}: ${v.reason}` : (f.severity === 'low' ? 'low, not verified (by design)' : 'UNVERIFIED (verifier missing)')
    lines.push(`- ${f.id} [${f.severity}, ${f.kind}] ${f.title} | evidence: ${f.evidence} | fix: ${f.fix} | verify: ${status}`)
  }
  if ((r.ideas || []).length) lines.push(`ideas:\n${r.ideas.map((x) => `  * ${x}`).join('\n')}`)
  if ((r.owner_items || []).length) lines.push(`owner items:\n${r.owner_items.map((x) => `  * ${x}`).join('\n')}`)
  if ((r.not_covered || []).length) lines.push(`not covered:\n${r.not_covered.map((x) => `  * ${x}`).join('\n')}`)
  lines.push('')
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plan_path: { type: 'string' },
    counts_reported: { type: 'object', properties: { critical: { type: 'integer' }, high: { type: 'integer' }, medium: { type: 'integer' }, low: { type: 'integer' } } },
    counts_final: { type: 'object', properties: { critical: { type: 'integer' }, high: { type: 'integer' }, medium: { type: 'integer' }, low: { type: 'integer' } } },
    refuted: { type: 'integer' },
    merged_duplicates: { type: 'integer' },
    top_ten: { type: 'array', items: { type: 'object', properties: { ids: { type: 'string' }, severity: { type: 'string' }, title: { type: 'string' } }, required: ['ids', 'severity', 'title'] } },
    phases: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' } }, required: ['name', 'title', 'summary'] } },
    decisions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, question: { type: 'string' }, recommendation: { type: 'string' } }, required: ['id', 'question', 'recommendation'] } },
    owner_checklist: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['plan_path', 'counts_final', 'top_ten', 'phases', 'decisions', 'gaps'],
}

const plan = await agent(`You merge an A-to-Z review of АЛМАНАХ (almanac.bg) into one plan. Read ${R}/BRIEF.md first (what's decided and planned, how to judge: the best possible product, never ranked by today's player count or by effort). Fifteen area reviewers wrote ${R}/<area>.md; independent verifiers tried to refute every high and medium finding (their notes are in ${R}/verify/). The data below lists every finding with its verdict. Read the reports wherever you need the full text.${failed.length ? ` These areas have no report (say so in the gaps): ${failed.join(', ')}.` : ''}

Write ${R}/PLAN.md:
1. **Counts by severity**: as reported, and final (after the refute pass and after merging duplicates), plus how many were refuted and how many merged.
2. **Top ten**, most important first, by merit for the finished product.
3. **Phases** that ship one by one, most important first, named Phase 8a, 8b, … (Phase 7 was the bank). Each phase: a title, what it achieves, and its items — every kept finding appears in exactly one phase (low ones included), with all the IDs that share a root cause merged into one item (e.g. "SEC-3 = SERVER-5 = WEB-2"), severity, a one-line fix and the evidence pointer. Live harm and security first; group by what ships well together.
4. **Decisions for the owner** (D1, D2, …): only real choices (product direction, trade-offs, anything that reverses something decided), each with the options and your recommendation.
5. **Owner checklist** (O1, O2, …): what only the owner can check or do, merged from all areas and deduplicated, with exact UI steps or \`! …\` commands — include the Litestream restore command from the infra-server-email report.
6. **Ideas** worth keeping that aren't findings, briefly, by area.
7. **Refuted**: each refuted finding with the verifier's one-line reason (so it isn't raised again), and any finding that stayed unverified.
8. **Not covered**: a plain list of what this review did not cover or couldn't check, and why — merged from every area's "not covered" plus anything you notice is missing across the whole (an area no one looked at, a claim no one could check).

Don't change anything in the repo. Don't put secrets in the plan. Then return the structured summary.

The data:

${lines.join('\n')}`, { label: 'merge:plan', phase: 'Plan', schema: PLAN_SCHEMA })

return { plan, failed, areas: done.map((d) => ({ area: d.area, findings: d.review ? d.review.findings.length : 0, verdicts: d.verdicts.length, unverified: d.unverified || [] })) }
