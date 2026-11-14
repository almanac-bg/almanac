-- The day's goals, kept once drawn (play.GoalsOf): the same all day whatever changes (a friend made, the bank, the
-- goals there are), and yesterday's at hand, so that today's are of other kinds. Only the last two days are kept.
CREATE TABLE day_goals (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT    NOT NULL, -- YYYY-MM-DD, in Bulgaria
  n       INTEGER NOT NULL, -- its place: 0 the day's questions, then the two drawn
  goal    TEXT    NOT NULL, -- a play.goalKinds id, with what it's about after a colon (topic:history)
  PRIMARY KEY (user_id, day, n)
) STRICT, WITHOUT ROWID;
