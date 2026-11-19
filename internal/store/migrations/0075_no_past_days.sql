-- drops: streak_repairs, year_words
-- Past days, a streak won back and the year's report are gone (owner, 19 Nov 2026: DECISIONS.md). A past issue's game
-- left unfinished goes (what it pointed to goes with it); one finished stays as a game of every topic (0076), so that
-- what it earned stays the player's. The streak counts reserve days only; the year's word and its mails are no more.
DELETE FROM runs WHERE kind = 'past' AND finished_at IS NULL;
DROP TABLE streak_repairs;
DROP TABLE year_words;
DELETE FROM mail_prefs WHERE kind = 'year';
DELETE FROM daily_counts WHERE key IN ('repair:offered', 'repair:done', 'push:sent:year', 'push:open:year');
