# Decisions

The owner's calls that the code alone doesn't explain, each with its reason. A session doesn't undo one of these on its
own judgment, however good the case: it says so, and why, and the owner decides. When the owner makes a new call, or
changes one, the session that hears it writes it here in the same pull request as the work. Mechanics live in the
packages' doc comments; this file holds only what must not drift.

## How the work is done

- **The session owns the product (owner, 2026-11-21).** The session is the product's PM and PO: it decides the
  product, its design, its priorities and its quality, and answers for them. The owner provides the money
  (infrastructure, servers, domains, accounts) and access where only the owner's hands can do it, asked for as one
  short, concrete step. A session never hands a product decision back to the owner, and every decision carries its
  own reason, never "the owner said so" or "it was approved". The owner's wishes and complaints are an opinion worth
  hearing, not an order: the session weighs them, argues back when they're wrong, and adopts them only on their
  merits. The calls below marked „owner“ stand until the session changes them, with its reason, here.
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
- **No mechanism for a risk already covered, and no experiment or metric whose answer can't be read:** a review's
  finding gets the smallest fix, not a system (the owner's delegation, 2026-11-21).

## The game

- **The direction (owner, 2026-11-20; final).** The owner asked for one direction to keep for years, after which the
  work is only fixing and finishing; it was set after eight rounds of independent review (simulations, player panels,
  evidence, security), whose last round found no flaw in it. *Every day ten questions; each one a player gets right in
  the issue writes its fact in ink in their Алманах; their rank in a chapter says how much of it the book holds in ink;
  played alone, with friends, and beside all of Bulgaria.* Not to drift:
  - **Three places:** Днес (the issue and, on its result, the day's board), Алманах (the book), Приятели (friends,
    duels). Профил and Настройки open from the avatar. Nothing else gets a place. The board is about the day's issue,
    so it is Днес's (2026-11-22), and Приятели is what it says, the people and the duels. It is one card on the result
    with two tabs, Приятели and Всички (2026-11-22, the owner: a „Класация“ link to a page of its own was a detour,
    and the tabs were what worked in Приятели): it takes the place of „Приятели днес“ and „България днес“, so the
    result holds no more than before, and it has no page of its own.
  - **The issue is asked once.** Its score is the number right out of 10; a close answer is „близо“, not right. No
    points and no bonus. No played question is asked again (no Втори шанс, no past issues), and a share link opened
    after its day opens today's issue.
  - **Time never counts:** not in the score, not in a tie (board places are shared; a duel even in right answers and
    the hard number's closeness is a draw), not in a duel's play (nothing says when the other side answered).
  - **Right or not** (owner, 2026-11-21, the direction audit): „близо“ is the number's alone. An order is dealt three
    of its four items (one chronology still, six arrangements, not 24 all or nothing) and is right or wrong; a hard
    question, a player's mastery and a recording's fit count right answers, never a partial score. Every right answer
    sounds the same: nothing counts a row of them.
  - **Ink.** A right answer in the issue, the first time a player meets that question, writes its fact in ink. Every
    other fact a player meets (a miss, or any answer in chapter games and duels) is in the book in grey, as met: never
    counted, never promised to turn into ink. A chapter shows one number, its ink.
  - **Each chapter's seal (печат) is its rank,** from ink, never falling, named for the book, not the person
    (Бележка 1, Страница 5, Тетрадка 15, Книга 40, Том 100, Летопис 250, then „Летопис · 2“ for each further 100):
    a badge of its own (not the logo); the way to the next rank is a bar of the chapter's ink out of the next rank's, in
    steps (2026-11-22, the owner: how many are left should show without reading a number; the way halved, and its right
    end halved again, until five or fewer are left, one ink each, so a long way is a few big steps and the last few are
    facts),
    the rank named under its left end and what's left under its right (2026-11-22: a bar of the way between two ranks
    was empty just past each, and its ends named nothing, so it didn't show how close the next was: „Страница“, „още 8
    до „Тетрадка““); with a player only the seal shows, on their
    avatar's corner (2026-11-21: one place, everywhere, never after the name), the name only in the Алманах and on a
    rank-up. No check against guessing: the names claim nothing a count doesn't hold. Avatars are the animals only, all
    free (2026-11-21): a seal's reward is the seal itself, worn as the badge; an avatar is a face, so animals only, and
    the profile gets simpler. Mastery is hidden: it steers chapter games and recordings.
    The badge is the player's best seal, never chosen (the highest rank, then the most ink, then the rank that came
    first: a choice nobody playing saw the point of, and the best says the most).
    These are the only levels, titles and unlocks; nothing else adds up across games (no XP, currencies, goals,
    achievements, notes as rewards, lifetime totals, rating, divisions, leagues, rooms). Anything live stays out until
    the owner reopens it.
    Профил names the book's whole ink beside „Печати“ (2026-11-22): it is ink, summed, earned only by the day's issue,
    so it adds no second score.
  - **The streak counts days the issue was played** and forgives up to two missed days a week by itself; an ended
    streak's number is never named.
  - **Duels on one's own time:** a friend has 7 days; or a real recording, of one kind (2026-11-22, the owner: the
    choice between „равен“ and „по-силен“ is gone: one more thing to decide, for little; the recording is the game
    nearest to the player, „на играч, който знае горе-долу колкото теб“). A friend's record against you stays: the
    one count kept between two players. A friend's row says it and the day's issue as an icon and a number each
    („7/10“, „3:1“), whole in the tooltip (2026-11-22, the owner: „днес още не“ and „дуели 3:1“ in words read as
    neither).
  - **A duel has no result page** (2026-11-22, the owner): everything about a duel is on its card in Приятели's
    „Дуели“: the two, the score, the two rows of marks, one quiet line, and „Въпросите“, its questions in their
    dialog, on any day (2026-11-22, the owner: the other side plays when they can, so a duel's result often comes
    on another day, and its questions are what the two talk over). Nothing else on a card: „Реванш“ and „Още един
    срещу запис“ are gone (2026-11-22, the owner), a new duel starts from „Нов дуел“, the one way. A duel's game ends on that tab, its card first, the score counting up
    once; `/duel/<id>` only starts and plays one, and an old link to a finished duel comes to its card. The played
    list is the last ten, and says so („Последните 10 изиграни“).
  - **Friends** are added by username or email, a request the other says yes to. The personal invite link was removed
    (21 Nov): little use, much machinery; friends come by username or email.
  - **Приятели's dot is news since the player last looked there** (2026-11-21), on any device: a friend request, a
    duel sent to them, a result of one of their duels (played back or run out). Opening Приятели clears it. It isn't
    a to-do count: as „a duel waits for you“ it stayed lit up to a week after its news was read (the owner hit it), and
    a result never lit it. A duel to play stays first in Приятели until it's played; the ping is for news arriving.
  - **Sharing:** the score and its tiles, never the answers, unsigned, with a way into the same ten.
  - **A result has a budget:** the score and tiles, what the day wrote in the book (its ink by chapter, a rank risen:
    2026-11-22, no single question picked out of the ten), one action, tomorrow, the
    day's board (Приятели · Всички); with a crowd, how Bulgaria did that day („средно 6,2“). Everything else is in the
    questions' dialog, off the page: one dialog for every game's questions (the day's, a chapter's game's, a
    duel's), opened by „Прегледай въпросите“, by the score's card, and by a tile at its question (2026-11-22, the
    owner: the list in the page made the result long, and a duel had a second kind of it). A
    wrong game is never celebrated; a best rank rising and a ten of ten are the only big moments.
  - **The player's nouns are a closed list:** Брой, близо, серия, Алманах (глави, факти, мастило), печат, игра на
    главата (всички глави, България), приятели, класация, дуел (запис), споделяне, профил, напомняне. Adding one is the owner's
    call.
  - **The rule for later.** A change is made only if it makes the issue better or names the measure it moves and what
    it removes; adds no noun; keeps every place's budget; is good at zero (first player, first day, 0 right, no
    friends); pays one deed once; removes at least as much as it adds while effects are too small to detect (judged
    before and after, by the players who come back: `/admin`); and answers „Built to hold“ (CLAUDE.md). "Makes the
    issue better" means it changes only the questions, the clock or the play screen and adds nothing outside it. A
    fix restores stated behaviour; polish adds no data, count, block or notification.
  - **The bets,** each read from what the game keeps anyway (runs, facts, duels, shares), by a query when it's asked,
    never by new tracking: that ink from the issue alone is enough progress (D30 of the players whose games are only
    the day's); that the share brings players (new players beside the days shared, day by day).
  The decisions below that this replaces are gone from this file.
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
  against someone (owner, 2026-11-19, undoing review S13's unnamed recordings). The other way, the recorded player is
  never told who played their games. The privacy page says so.
- **Removed to keep the game simple** (owner, 2026-11-19; sharing and friends' duels came back with the redesign): past days'
  questions (the archive of past issues, and going over a game after its day, except a duel's own questions, from
  its card: 2026-11-22), winning a broken streak back, and the
  year's report; and on 20 Nov, Профил's chart of the days („Твоите броеве“), Начало's line of how yesterday ended,
  Класации' „Вчера“, the book's notes and profile totals (on the direction), Втори шанс (the questions got wrong, asked again days later), the weekly leagues, rooms
  (playing together with a code; the games played in them stay the players'), and blocking players (a request can
  still be declined, a friend removed). The
  Алманах's facts are a chapter's entries, the latest first, each dated with where it was learned (the edition's
  mockups, chosen 20 Nov), never one list of them all. Friends are added by username or email.
  Don't bring any of them back, or something in their place, without the owner's call.
- **Gamification only from what the game really counts:** no invented currencies, no random boxes, never real money.

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
