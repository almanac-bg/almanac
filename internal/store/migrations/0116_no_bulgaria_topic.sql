-- „България“ is no longer a way to play (owner, 2026-11-22): its games, ten questions about Bulgaria from every topic,
-- are kept as games of every topic (play.MixTopic), which a duel may take as a recording.
UPDATE runs SET category = 'mix' WHERE kind = 'topic' AND category = 'bulgaria';
