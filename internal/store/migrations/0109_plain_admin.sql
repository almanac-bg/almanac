-- /admin tells players by the day, new players and whether they came back, from the runs and the players alone
-- (2026-11-21): what was kept only to measure goes. Where a player came in and the version they met, the device a game
-- was played on, the parts of the game opened each week, the day's counts of what no table keeps, the weeks' cohorts
-- frozen and the versions released.
-- drops: users.came_from, users.first_version, users.used, users.used_week, runs.device
-- drops: daily_counts, cohort_weeks, releases
ALTER TABLE users DROP COLUMN came_from;
ALTER TABLE users DROP COLUMN first_version;
ALTER TABLE users DROP COLUMN used;
ALTER TABLE users DROP COLUMN used_week;
ALTER TABLE runs DROP COLUMN device;
DROP TABLE daily_counts;
DROP TABLE cohort_weeks;
DROP TABLE releases;
