# Decisions

The owner's calls that the code alone doesn't explain, each with its reason. A session doesn't undo one of these on its
own judgment, however good the case: it says so, and why, and the owner decides. When the owner makes a new call, or
changes one, the session that hears it writes it here in the same pull request as the work. Mechanics live in the
packages' doc comments; this file holds only what must not drift.

## How the work is done

- **The owner gives a purpose; the session decides the rest** and says why in a line. A question back is only for what
  is truly the owner's: money, legal, credentials, something that can't be undone, a change to a decision below.
- **The right shape, not a pleasing one.** Asked „ok?“, give the trade-off first: what it duplicates, what it should
  replace. A complaint („I don't see it“) is a reason to rethink the design, not to add another way in.
- **Asked for an opinion, give your own,** even against a decision here: say where it's wrong. Building still follows
  the decision until the owner changes it.
- **The best finished product,** not one tuned to today (few players, little time). Effort is never the reason to
  leave something out.
- **Fast over ceremony.** Merge is deploy; nothing waits on the browser tests (CLAUDE.md, Shipping). Work from several
  builders at once gets an independent review before or right after it merges.
- **No open-source ritual** (contributing guides, templates, changelogs by hand): the repo serves the game and the
  sessions that build it.

## The game

- **The redesign (owner, 2026-11-20).** After a walk through everything with every kind of player, the owner chose
  to rebuild the game around one idea: *every day ten questions write the player's almanac, and set them beside all of
  Bulgaria.* What follows from it, and is not to drift back:
  - **Three places:** Днес (the day's issue), Алманах (the player's book), Приятели (friends, the day's board, duels).
    Профил and Настройки open from the player's avatar. Nothing else gets a place.
  - **One measure of progress: the Алманах.** A chapter per topic (Микс and България as chapters of their own), the
    facts a player has collected in it, and how much of it they know (mastery). The streak is the habit. Nothing else
    adds up across games: no XP, no levels, no day's goals, no achievements, no titles, no frames, no backdrops, no
    unlocks of any kind. Milestones (a streak of 7, 30, 100, 365 days, a first ten of ten, a chapter completed) are
    noted in the book, not given as medals.
  - **The streak forgives one missed day a week by itself** (Monday to Sunday); nothing to earn or hold. A streak that
    ends isn't won back.
  - **Every avatar is free** from the first day: the animals, chosen by the player. No tones, frames or patterns to
    unlock.
  - **No rating and no divisions.** Points are one game's score; a player's strength is what their Алманах says.
  - **No Роял.** It needs dozens at one moment; with few players it is an empty room that teaches nobody plays. A live
    evening may come back, built anew, once thousands play daily: the owner's call then.
  - **A duel is played on one's own time:** the same ten as a friend (who plays them when they can) or as a real
    recorded game, said plainly; no live matching, no rating. A friend's record against you stays.
  - **Sharing the day's result comes back:** the score and its shape, never the answers, with a way into the game.
  - **The first screen of a new visitor is the day alone;** topics are played from their chapter in the Алманах.
  - **A result is one page:** how it went, how Bulgaria did, the one thing worth keeping, sharing, tomorrow. A wrong
    game is never celebrated.
  The decisions below that this replaces are gone from this file; the code follows as each part lands.
- **The day's ten questions are the heart;** everything else serves them or stays out of the way. A new system replaces
  one or proves it's needed (CLAUDE.md, Direction).
- **For everyone, not for a group.** The game is made for any player, not tailored to one audience (children,
  classrooms, schools): no levels, question pools, filters, reports or texts that exist for one group (owner,
  2026-11-18, after the product review's classroom items).
- **„Микс“ and „България“ lead the topics** on Начало, before the bank's: „Микс“ is a game of every topic at once,
  „България“ the questions about Bulgaria from every topic (owner, 2026-11-20).
- **Accessibility for special needs comes later, not now.** No new work for screen readers, extra time, pausing the
  pace or similar needs until the owner calls for it; what the game already has (contrast, labels, the axe checks)
  stays and isn't broken. Layout that breaks for ordinary players (large system text, small tap targets) is not this:
  it's fixed as any bug (owner, 2026-11-18).
- **A recording shows who played it.** Against a recording, the player sees the real player as anywhere in the game
  (name, profile, avatar), labelled „Запис“, never as an anonymous animal: a duel is
  against someone (owner, 2026-11-19, undoing review S13's unnamed recordings). The other way stays numbers only: the
  recorded player hears how many played their games and how it went, never who. The privacy page says so.
- **Removed to keep the game simple** (owner, 2026-11-19; sharing and friends' duels came back with the redesign): past days'
  questions (the archive of past issues, and going over a game after its day), winning a broken streak back, and the
  year's report; and on 20 Nov, Профил's chart of the days („Твоите броеве“), Начало's line of how yesterday ended,
  Класации' „Вчера“, Втори шанс (the questions got wrong, asked again days later), the weekly leagues, rooms
  (playing together with a code; the games played in them stay the players'), and blocking players (a request can
  still be declined, a friend removed). Моят
  Алманах is one list in the order the facts were learned, with no datelines. Friends are added by username or email.
  Don't bring any of them back, or something in their place, without the owner's call.
- **Right answers in a row earn no points** (owner, 2026-11-18, review E6): where a miss fell decided close duels.
  The climb stays as sound and feel; a game with every answer right still earns its bonus.
- **Gamification only from what the game really counts:** no invented currencies, no random boxes, never real money.
- **A tenth of players get no reminders, to tell what reminders do.** 10 % of players, drawn once by a hash of their
  id (`play/experiment.go`), are held out of the day's notification and the streak's mail; what they would have had
  is kept as if sent, by the same rules and hours, and `/admin` compares the two groups with intervals, counted by
  player. Without it the reminders' rows only show the habit they're timed to (owner, 2026-11-18, review D4). The
  reminder by mail is never held out: a player asked for it, and gets it (owner, 2026-11-18). The privacy page says
  so.

## Questions

- **The real bank is private** (`almanac-bg/almanac-questions`, in `private/`): answers that leak make cheating and
  copies. Only `bank/sample` is public.
- **The bank grows by the day's runway** (how many days each place of the day has left), topics kept equal in size.
- **Balance by adding, never by retiring.** A question is retired only for a real flaw (wrong, stale, weak, a twin that
  gives another away), never to make room.
- **Rules are code** (`bank lint`), so a later change of a rule is a query, not a pass over 14 000 questions.

## How it looks and speaks

- **The edition** (owner, 2026-11-20, replacing „Modern Editorial Gamified“): the game looks like a publication a
  player keeps, not a generic game app: paper-light first with a night of its own, serif headlines, numerals as the
  heroes, colour only where it means something, one obvious action per screen. `web/DESIGN.md` holds the rules as they
  land.
- **Art never changes the rules.** Asked for pictures, draw pictures; a drawing doesn't change what the game gives
  because it exists (#234, undone in #236).
- **The mark is the rosette:** abstract, not a letter, no gradients. Ask before changing the mark itself.
- **Bulgarian for players, English for code and URLs; never Bulgarian in Latin letters** (`/daily`, not `/dnes`).

## Phones

- **No app for phones** (owner, 2026-11-20): the game is the website only, played in the phone's browser. An app (a
  shell around the site, with notifications through Apple and Google) was built and removed; don't propose it again.
