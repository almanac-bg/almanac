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

- **The direction (owner, 2026-11-20; final).** The owner asked for one direction to keep for years, after which the
  work is only fixing and finishing; it was set after eight rounds of independent review (simulations, player panels,
  evidence, security), whose last round found no flaw in it. *Every day ten questions; each one a player gets right in
  the issue writes its fact in ink in their Алманах; their rank in a chapter says how much of it the book holds in ink;
  played alone, with friends, and beside all of Bulgaria.* Not to drift:
  - **Three places:** Днес (the issue), Алманах (the book), Приятели (friends, the day's board, duels). Профил and
    Настройки open from the avatar. Nothing else gets a place.
  - **The issue is asked once.** Its score is the number right out of 10; a close answer is „близо“, not right. No
    points and no bonus. No played question is asked again (no Втори шанс, no past issues), and a share link opened
    after its day opens today's issue.
  - **Ink.** A right answer in the issue, the first time a player meets that question, writes its fact in ink. Every
    other fact a player meets (a miss, or any answer in chapter games and duels) is in the book in grey, as met: never
    counted, never promised to turn into ink. A chapter shows one number, its ink.
  - **Each chapter's seal (печат) is its rank,** from ink, never falling, named for the book, not the person
    (Бележка 1, Страница 5, Тетрадка 15, Книга 40, Том 100, Летопис 250, then „Летопис · 2“ for each further 100):
    a badge of its own (not the logo), filling in quarters between ranks; beside a name only the seal shows, the name
    only in the Алманах and on a rank-up. No check against guessing: the names claim nothing a count doesn't hold. The
    chapter's art becomes a choosable avatar at Страница. The animals stay free. Mastery is hidden: it steers chapter games and recordings.
    These are the only levels, titles and unlocks; nothing else adds up across games (no XP, currencies, goals,
    achievements, notes as rewards, lifetime totals, rating, divisions, leagues, rooms). Anything live stays out until
    the owner reopens it.
  - **The streak counts days the issue was played** and forgives up to two missed days a week by itself; an ended
    streak's number is never named.
  - **Duels on one's own time:** a friend has 7 days; or a real recording, chosen as „равен“ or „по-силен“. A friend's
    record against you stays: the one count kept between two players.
  - **Sharing:** the score and its tiles, never the answers, unsigned, with a way into the same ten.
  - **A result has a budget:** the score and tiles, the day's entry and its growth line, friends' tiles, one action,
    tomorrow; with a crowd, how Bulgaria did that day („средно 6,2“). Everything else under „Въпросите и фактите“. A
    wrong game is never celebrated; a best rank rising and a ten of ten are the only big moments.
  - **The player's nouns are a closed list:** Брой, близо, серия, Алманах (глави, факти, мастило), печат, игра на
    главата (Микс, България), приятели, класация, дуел (запис), споделяне, профил, напомняне. Adding one is the owner's
    call. `/admin` shows each one's weekly use; a session proposes removing one nobody uses.
  - **The rule for later.** A change is made only if it makes the issue better or names the measure it moves and what
    it removes; adds no noun; keeps every place's budget; is good at zero (first player, first day, 0 right, no
    friends); pays one deed once; is measured by a randomised hold-out where it can be (changes to the shared day are
    judged before and after, the owner's call), and while effects are too small to detect, removes at least as much as
    it adds (the default while numbers are small); and answers „Built to hold“ (CLAUDE.md). "Makes the issue better"
    means it changes only the questions, the clock or the play screen and adds nothing outside it. A fix restores
    stated behaviour; polish adds no data, count, block or notification. A hold-out states its measure and window in
    advance; if it shows nothing by then, the direction's choice stays.
  - **The bets,** each with its measure in `/admin`: that ink from the issue alone is enough progress (D30 of players
    who play only the day); that the seals are wanted (players who open or change theirs); that the share brings
    players (plays per shared link).
  The decisions below that this replaces are gone from this file; the code follows as each part lands.
- **The day's ten questions are the heart;** everything else serves them or stays out of the way. A new system replaces
  one or proves it's needed (CLAUDE.md, Direction).
- **For everyone, not for a group.** The game is made for any player, not tailored to one audience (children,
  classrooms, schools): no levels, question pools, filters, reports or texts that exist for one group (owner,
  2026-11-18, after the product review's classroom items).
- **„Микс“ and „България“ lead the Алманах** as two ways to play at its head, not chapters: „Микс“ is a game of every
  topic at once, „България“ the questions about Bulgaria from every topic (owner, 2026-11-20).
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
  Класации' „Вчера“, the book's notes and profile totals (on the direction), Втори шанс (the questions got wrong, asked again days later), the weekly leagues, rooms
  (playing together with a code; the games played in them stay the players'), and blocking players (a request can
  still be declined, a friend removed). The
  Алманах's facts are a chapter's entries, the latest first, each dated with where it was learned (the edition's
  mockups, chosen 20 Nov), never one list of them all. Friends are added by username or email.
  Don't bring any of them back, or something in their place, without the owner's call.
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

- **A bright almanac** (owner, 2026-11-20, replacing „the edition“, whose paper look put the owner off): a game, bright
  and alive; each chapter its colour, always with its glyph; right and wrong carried by shape and fill, never by colour
  alone; the almanac's forms (the issue's sheet and its turn, ink and pencil), never a paper texture; one obvious action
  per screen. The owner judges mockups on the real screens before it is built. `web/DESIGN.md` holds the rules.
- **Art never changes the rules.** Asked for pictures, draw pictures; a drawing doesn't change what the game gives
  because it exists (#234, undone in #236).
- **The mark is the rosette:** abstract, not a letter, no gradients. Ask before changing the mark itself.
- **Bulgarian for players, English for code and URLs; never Bulgarian in Latin letters** (`/daily`, not `/dnes`).

## Phones

- **No app for phones** (owner, 2026-11-20): the game is the website only, played in the phone's browser. An app (a
  shell around the site, with notifications through Apple and Google) was built and removed; don't propose it again.
