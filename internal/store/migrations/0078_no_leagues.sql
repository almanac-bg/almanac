-- The weekly leagues are gone (the owner's call, 20 Nov 2026: DECISIONS.md), and with them what only they made: the
-- weeks, their groups and places, the league a player was in, the XP the places paid (it leaves each player's total
-- with the places), the achievements of the leagues („Нагоре“, „Първо място в групата“, „На върха“) with their XP,
-- the champion's title of Рила and the frames of its peaks (whoever wore one wears none), what was told of them, and
-- the league among the systems a player was told of. „Между приятели“ (a friend beaten in a duel) goes the same way.
-- A notification waits for nothing a player must have met any more: the only one that did (a week's end) goes.
-- drops: league_week, league_groups, league_members, league_results, users.league, push_queue.needs
DROP TABLE league_members;
DROP TABLE league_groups;
DROP TABLE league_week;
DROP TABLE league_results;
ALTER TABLE users DROP COLUMN league;

DELETE FROM achievements WHERE id IN ('leagueUp', 'leagueFirst', 'rila', 'friendWin');
UPDATE users SET title = NULL WHERE title = 'champion';
UPDATE users SET frame = NULL WHERE frame IN ('peak3', 'peak4', 'peak5');
DELETE FROM unlocks_told
WHERE id LIKE 'title:champion:%' OR id LIKE 'frame:peak3:%' OR id LIKE 'frame:peak4:%' OR id LIKE 'frame:peak5:%';
UPDATE users SET systems_told = trim(replace(' ' || systems_told || ' ', ' league ', ' '))
WHERE ' ' || systems_told || ' ' LIKE '% league %';

DELETE FROM push_queue WHERE needs IS NOT NULL;
ALTER TABLE push_queue DROP COLUMN needs;
