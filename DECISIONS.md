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

- **The day's ten questions are the heart;** everything else serves them or stays out of the way. A new system replaces
  one or proves it's needed (CLAUDE.md, Direction).
- **For everyone, not for a group.** The game is made for any player, not tailored to one audience (children,
  classrooms, schools): no levels, question pools, filters, reports or texts that exist for one group. Rooms serve
  anyone who plays together, whether family, friends, a pub or a class, with the same rules for all (owner,
  2026-11-18, after the product review's classroom items).
- **Accessibility for special needs comes later, not now.** No new work for screen readers, extra time, pausing the
  pace or similar needs until the owner calls for it; what the game already has (contrast, labels, the axe checks)
  stays and isn't broken. Layout that breaks for ordinary players (large system text, small tap targets) is not this:
  it's fixed as any bug (owner, 2026-11-18).
- **Points, XP and rating are kept apart** (`play/worth.go`). The word stays **XP**, not „опит“: „опит“ already means a
  try in the game's texts.
- **Live means live.** Duels are played at once, with a recording of a real game when nobody comes; Роял is online only,
  at 21:00, Friday to Sunday until the evenings fill. No made-up opponents: no bots answering by a player's rates.
- **Роял cuts by right answers,** after the 5th, 8th, 11th and 14th: everyone level on right answers with the last
  player through goes through, up to a quarter more than the cut keeps (`play.RoyalThrough`); only past that does the
  time of the right ones decide among those level. So time decides the final, the places and only a crowded line,
  never more rights against fewer but faster (owner, 2026-11-18, review M2: the first cut had been a contest of
  seconds, partly of the network). It always reaches the 15th. Those cut keep answering on the same clock, off the
  standings, placed as they stood at their cut (not reordered by their total). Rejected: out at the first wrong (most
  were out by the 5th), lives, a final from zero (luck over knowledge).
- **One challenge**, by a link anyone can open (#402): friend duels and challenges were two near-identical systems.
- **Leagues race on the day's right answers**, not XP: a group ranks by the week's right answers on the day's ten, then
  its points, then who joined first, as the day's board does (owner, 2026-11-18, review E3). A league's last group,
  under five, races with the one before it.
- **Reserve days: one a week at most,** Monday to Sunday, from whichever source comes first (the day itself and the
  goals); none before a streak's third day, which brings the first, told then. Players kept the reserve days they held
  when this came in. „Година без пропуск“ is 365 days in a row with no reserve day or repair spent; the streak's year
  is „Година с Алманаха“ (owner, 2026-11-18, review E4, E11).
- **Минали броеве replaced „Всички теми“,** and is how a broken streak is won back. Any past day's ten can be played
  once, after its day, by whoever didn't finish them on it: scored as a topic's game, outside the day's board, the
  streak, the league and the goals, and told against that day's players. A streak that just ended comes back by
  playing the missed issue and today's, not „one more game“ of any kind (owner, 2026-11-18, review O9, R4: a new
  system replaces one; the game of every topic stays only as a challenge's choice).
- **Right answers in a row earn no points** (owner, 2026-11-18, review E6): where a miss fell decided close duels and
  weeks. The climb stays as sound and feel; a game with every answer right still earns its bonus.
- **The day's goals serve the day,** each one game at most: the day's ten; one more game (a topic's, three questions
  fixed in Втори шанс, or a duel); and a game played well (8 of 10 or more). No goal for how many or how fast, and a
  room's game counts only when someone else played it too (owner, 2026-11-18, review O4: the volume and speed goals
  sent players into a quarter of an hour of other games, away from the day).
- **Gamification only from what the game really counts:** no invented currencies, no random boxes, never real money.
- **Sharing:** what's shared ends with the player's own link, and the text itself has no invitation words nor anyone
  else's name: the day's result, and a win (a duel against a person, Роял's first three) in the same style (owner,
  2026-11-18, review M10).
- **A tenth of players get no reminders, to tell what reminders do.** 10 % of players, drawn once by a hash of their
  id (`play/experiment.go`), are held out of the day's notification, the streak's mail and the year's notification
  (once a year in December, „Твоята 2026 в АЛМАНАХ“, to a player with 7 days or more that year: owner, review R8);
  what they would have had is kept as if sent, by the same rules and hours, and `/admin` compares the two groups with
  intervals, counted by player. Without it the reminders' rows only show the habit they're timed to (owner,
  2026-11-18, review D4). The reminder by mail is never held out: a player asked for it, and gets it (owner,
  2026-11-18); nor is the year's word by mail. The privacy page says so.

## Questions

- **The real bank is private** (`almanac-bg/almanac-questions`, in `private/`): answers that leak make cheating and
  copies. Only `bank/sample` is public.
- **The bank grows by the day's runway** (how many days each place of the day has left), topics kept equal in size.
- **Balance by adding, never by retiring.** A question is retired only for a real flaw (wrong, stale, weak, a twin that
  gives another away), never to make room.
- **Rules are code** (`bank lint`), so a later change of a rule is a query, not a pass over 14 000 questions.

## How it looks and speaks

- **Modern Editorial Gamified** (`web/DESIGN.md`): the owner's final choice among three. Night first, gold for the one
  right answer, one obvious action per screen.
- **Art never changes the rules.** Asked for pictures, draw pictures; an achievement doesn't start giving avatars
  because a drawing exists (#234, undone in #236).
- **The mark is the rosette:** abstract, not a letter, no gradients. Ask before changing the mark itself.
- **Bulgarian for players, English for code and URLs; never Bulgarian in Latin letters** (`/daily`, not `/dnes`).

## The app on phones

- **A shell around the site** (Capacitor, `mobile/`): one game, one client. Never Expo.
