-- Sign-in codes mailed to an address, whoever asked and from wherever: a few an hour and a day at most
-- (account.CodesPerAddressHour, CodesPerAddressDay), so that no one can flood an inbox from many networks (review
-- 2026-11-18, S5). Kept a day (account.CleanUp).
CREATE TABLE code_mails (
  email TEXT    NOT NULL,
  at    INTEGER NOT NULL
) STRICT;
CREATE INDEX code_mails_email ON code_mails (email, at);
CREATE INDEX code_mails_at ON code_mails (at);

-- Addresses the mail server refused (no such mailbox or domain): no mail goes to them until `until` (mail.Suppressed),
-- and one refused again while it's remembered is suppressed longer. Forgotten a while after it ends.
CREATE TABLE mail_suppressed (
  email  TEXT    PRIMARY KEY,
  until  INTEGER NOT NULL,
  times  INTEGER NOT NULL, -- how many times it was refused
  reason TEXT    NOT NULL  -- the mail server's words
) STRICT, WITHOUT ROWID;

-- The urgent mail (codes) goes by rank, the lowest first: a network that asked for many codes this minute waits for
-- everyone else's (mail.Outbox.Urgent).
ALTER TABLE outbox ADD COLUMN rank INTEGER NOT NULL DEFAULT 0;
DROP INDEX outbox_due;
CREATE INDEX outbox_due ON outbox (urgent DESC, rank, next_at);
