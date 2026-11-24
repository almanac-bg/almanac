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
    so it is Днес's (2026-11-22), and Приятели is what it says, the people and the duels, on one page with no tabs
    (2026-11-22, the owner: both in sight at once): who asks to be friends, the duels waiting, the friends, the duels
    played. The board is one card on the result with two tabs, Всички first, then Приятели, where it opens once the
    player has friends (2026-11-22, the owner: a „Класация“ link to a page of its own was a detour): it takes the place
    of „Приятели днес“ and „България днес“, so the
    result holds no more than before, and it has no page of its own.
  - **The issue is asked once.** Its score is the number right out of 10; a close answer is „близо“, not right. No
    points and no bonus. No played question is asked again (no Втори шанс, no past issues), and a share link opened
    after its day opens today's issue.
  - **Time never counts:** not in the score, not in a tie (board places are shared; a duel even in right answers and
    the hard number's closeness is a draw), not in a duel's play (nothing says when the other side answered).
  - **Right or not** (owner, 2026-11-21, the direction audit): „близо“ is the number's alone. An order is right or
    wrong (dealt all four of its items again since 2026-11-23, the owner; three from 21 Nov); a hard question and a
    player's mastery count right answers, never a partial score. Every right answer sounds the same: nothing counts a
    row of them.
  - **The kinds** (owner, 2026-11-23): choice (with pictures), true-or-not, number, order (4 items), match and split.
    Clues („Подсказки“) are switched off (2026-11-23, the owner): with only right or wrong, waiting for clues was
    pointless. Their questions stay in the bank, never dealt, and no new one is written (`bank.Off`); match and split,
    converted to choices on 21–22 Nov, came back as they were.
  - **The issue's shape** (2026-11-23): one puzzle a day (an order, a match or a split, in turn), so that a single
    slip on an all-or-nothing puzzle can't sink the day as three of them could, and two pictures (an easy one, and a
    medium one while the bank has them, written for by the runway); the rest plain choices, a true-or-not and the hard
    number last (`daySlots`).
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
    до „Тетрадка““); a player's seals are on their profile and in their Алманах, never with their name nor on their
    avatar (the owner, 2026-11-22, „махни печата от аватара навсякъде“: it had been on the avatar's corner since
    2026-11-21), the rank's name only in the Алманах, on Профил and on a rank-up; no seal is worn, none chosen. No
    check against guessing: the names claim nothing a count doesn't hold. Avatars are the animals only, all free
    (2026-11-21): a seal's reward is the seal itself; an avatar is a face, so animals only, and the profile gets
    simpler. Mastery is hidden: it steers chapter games and duels.
    These are the only levels, titles and unlocks; nothing else adds up across games (no XP, currencies, goals,
    achievements, notes as rewards, lifetime totals, rating, divisions, leagues, rooms). Anything live stays out until
    the owner reopens it.
    Профил names the book's whole ink beside „Печати“ (2026-11-22): it is ink, summed, earned only by the day's issue,
    so it adds no second score.
  - **The streak counts days the issue was played** and forgives up to two missed days a week by itself; an ended
    streak's number is never named. Днес shows it from its first day (2026-11-23, the owner: a player's second day,
    the one that decides whether they stay, showed nothing of the first), and on the result too.
  - **Duels on one's own time, with a friend,** challenged directly: „Дуел“ on their row in Приятели or on their
    profile, the only ways (2026-11-22, the owner: the duel against a recording of another's game is gone, and „Нов
    дуел“, its picker, with it). The friend has 7 days. Three sent to one friend wait at most: no fourth until they play
    one, and their row says so, „Дуел“ off (2026-11-22, the owner). A friend's record against you stays: the
    one count kept between two players. A friend's row says it in words under the name („Дуели помежду ви: печелиш 3,
    губиш 1“, by verbs so whose wins they are is never in doubt: 2026-11-23, the owner's go; „Още нямате дуели“), and „Дуел“ as a button at its end; not the friend's day, which is the day's board's
    (2026-11-22, the owner).
  - **A duel has no result page** (2026-11-22, the owner): everything about a duel is in Приятели: the two, the
    score, the two rows of marks, one quiet line, and „Въпросите“, its questions in their dialog, on any day (2026-11-22, the owner: the other side plays when they can, so a duel's result often comes
    on another day, and its questions are what the two talk over). Every duel is a card,
    „Чакащи дуели“ and „Завършени дуели“ (2026-11-22, the owner: the cards read better than compact rows): one the
    player's to play acts only by its „Играй“; every duel they have to play is in one stack, whoever sent it, the first
    challenged on top, opened in a dialog in that order to choose which to play (2026-11-22, the owner); one whose side
    they've played opens its questions; no name on a duel is a link to a profile, which opens from the friends'
    list (2026-11-22, the owner). Nothing else: „Реванш“ is
    gone (2026-11-22, the owner), a new duel starts from the friend's row or profile. A duel's game ends on Приятели,
    first in its group, the score counting up once; `/duel/<id>` only starts and plays one, and an old link to a
    finished duel comes to it there. The finished list is the last ten, and says so („Последните 10 завършени дуела“: „завършени“, not „изиграни“,
    since one run out unplayed is in it, 2026-11-23); all
    of them open from under it in a dialog, a page at a time (2026-11-22, the owner). A duel the player sent and the
    friend hasn't played isn't listed: it's the friend's to do (2026-11-22, the owner: it only muddled the list).
    A friend's duel waiting for the player is on Днес too (2026-11-23, the owner): under the streak on the cover,
    „Играй“ beside it; once the day is played, it is the result's action, „Сподели“ then a quiet link. It's the one
    piece of others' news on Днес: a duel waits on the player, and asks for the same few minutes the day does.
  - **Friends** are added by username or email, a request the other says yes to, or from a day someone shared with
    you (owner, 2026-11-24): having played that day by its link, a player with no friends yet has on the board's
    Приятели one action, „Покани човека, който ти прати връзката“, an ordinary request to whoever shared it, within
    the request's limits and at most 20 by one link; they see it with the link's issue, and its sender learns who it
    was only if they say yes. The share was the one way a new person came, and it left them with no friends, so the
    friends' board, duels and the push naming a friend never began for them; this rides on the link already shared,
    with no new link, page or noun. The personal invite link was removed (21 Nov): little use, much machinery, a
    separate link to make and send.
  - **Приятели's dot is news since the player last looked there** (2026-11-21), on any device: a friend request, a
    duel sent to them, a result of one of their duels (played back or run out). Opening Приятели clears it. It isn't
    a to-do count: as „a duel waits for you“ it stayed lit up to a week after its news was read (the owner hit it), and
    a result never lit it. A duel to play stays first in Приятели until it's played; the ping is for news arriving.
  - **Sharing:** the score and its tiles, never the answers, unsigned, with a way into the same ten. Unsigned means
    nothing the link shows, nor anything the game answers about it, says whose it is: a request by it (Friends) names
    nobody to its sender until it's accepted (2026-11-24).
  - **A result has a budget:** the score and tiles, what the day wrote in the book (its ink by chapter, a rank risen:
    2026-11-22, no single question picked out of the ten), the streak with today's in it (2026-11-23, the owner: it
    grew out of sight once the „Утре“ card went), one action (a friend's duel waiting, else „Сподели“: 2026-11-23, the
    owner), the
    day's board (no „Утре“ card, nothing of tomorrow's issue: 2026-11-22, the owner: superfluous) (Всички · Приятели); with a crowd, how Bulgaria did that day („средно 6,2“). Everything else is in the
    questions' dialog, off the page: one dialog for every game's questions (the day's, a chapter's game's, a
    duel's), opened by „Прегледай въпросите“, by the score's card, and by a tile at its question (2026-11-22, the
    owner: the list in the page made the result long, and a duel had a second kind of it). A
    wrong game is never celebrated; a best rank rising and a ten of ten are the only big moments.
  - **The day's questions say how the player's friends did** (owner, 2026-11-22): in the day's questions' dialog,
    under how Bulgaria did with each question, which of the friends who finished the day got it right (up to four by
    name, each with their sign; more, two rows, those who did and those who didn't, each opening to its whole list);
    never before the player has finished, never anyone's answers. The day is the same ten for everyone, and this turns
    a score into something to talk about. The day's issue only: a duel's dialog shows its two sides, a chapter's game
    has no friends in it. The faces there are the avatars alone, as everywhere.
  - **The player's nouns are a closed list:** Брой, близо, серия, тема, Алманах (глави, факти, мастило), печат, игра
    по тема, приятели, класация, дуел, споделяне, профил, напомняне. Adding one is the owner's
    call.
  - **What questions are about is a „тема“; „глава“ is the book's word** (owner, 2026-11-22, undoing „глава“
    everywhere): in the Алманах a topic is a chapter of the book („Глава 1“ over „Обща култура“, „Главите“), and
    everywhere else it's a „тема“ („всяка от десетте теми“, „тема „История““, „Игра по тема“, „Към темата“, „Печат за
    тема“). „Глава“ read oddly out of the book: one is „силен в тема Технологии“, never „в глава Технологии“
    (`language.test.ts`: „глава“ is said only in `screens/almanac.ts`).
  - **The rule for later.** A change is made only if it makes the issue better or names the measure it moves and what
    it removes; adds no noun; keeps every place's budget; is good at zero (first player, first day, 0 right, no
    friends); pays one deed once; removes at least as much as it adds while effects are too small to detect (judged
    before and after, by the players who come back: `/admin`); and answers „Built to hold“ (CLAUDE.md). "Makes the
    issue better" means it changes only the questions, the clock or the play screen and adds nothing outside it. A
    fix restores stated behaviour; polish adds no data, count, block or notification.
  - **The bets,** each read from what the game keeps anyway (runs, facts, duels, shares), by a query when it's asked,
    never by new tracking, but for one count: that ink from the issue alone is enough progress (D30 of the players
    whose games are only the day's); that the share brings players (new players beside the days shared, and of them
    „Нови по връзка“, day by day). That one count (owner, 2026-11-24) is a number a day, of new players whose first
    game, the day's issue played as a person plays, began on a page opened by a shared link, kept with nothing of who
    (privacy.go says so): without it, a day the share brought players can't be told from a day a mention or a search
    did, and the bet that justifies sharing can't be read.
  The decisions below that this replaces are gone from this file.
- **The day's ten questions are the heart;** everything else serves them or stays out of the way. A new system replaces
  one or proves it's needed (CLAUDE.md, Direction).
- **For everyone, not for a group.** The game is made for any player, not tailored to one audience (children,
  classrooms, schools): no levels, question pools, filters, reports or texts that exist for one group (owner,
  2026-11-18, after the product review's classroom items).
- **A game outside the day is a chapter's** (owner, 2026-11-22, undoing 2026-11-20's „Микс“ and „България“ at the
  Алманах's head): no „Играй от всички теми“, no „Играй за България“. The book's head says whose book it is and what
  ink means, and its chapters are the ways to play; a duel still draws from every chapter. Past games of „България“ are
  kept as games of every chapter.
- **Accessibility for special needs comes later, not now.** No new work for screen readers, extra time, pausing the
  pace or similar needs until the owner calls for it; what the game already has (contrast, labels, the axe checks)
  stays and isn't broken. Layout that breaks for ordinary players (large system text, small tap targets) is not this:
  it's fixed as any bug (owner, 2026-11-18).
- **Removed to keep the game simple** (owner, 2026-11-19; sharing and friends' duels came back with the redesign): past days'
  questions (the archive of past issues, and going over a game after its day, except a duel's own questions, from
  its card: 2026-11-22), winning a broken streak back, and the
  year's report; and on 20 Nov, Профил's chart of the days („Твоите броеве“), Начало's line of how yesterday ended,
  Класации' „Вчера“, the book's notes and profile totals (on the direction), Втори шанс (the questions got wrong, asked again days later), the weekly leagues, rooms
  (playing together with a code; the games played in them stay the players'), and blocking players (a request can
  still be declined, a friend removed); and on 22 Nov the duel against a recording of another's game (a duel is with
  a friend, challenged directly) and „Нов дуел“. The
  Алманах's facts are a chapter's entries, the latest first, each dated with where it was learned (the edition's
  mockups, chosen 20 Nov), never one list of them all. Friends are added by username, email or a shared day (Friends).
  Don't bring any of them back, or something in their place, without the owner's call.
- **Gamification only from what the game really counts:** no invented currencies, no random boxes, never real money.

## Questions

- **The real bank is private** (`almanac-bg/almanac-questions`, in `private/`): answers that leak make cheating and
  copies. Only `bank/sample` is public.
- **The bank grows by the day's runway** (how many days each place of the day has left), chapters kept equal in size.
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
