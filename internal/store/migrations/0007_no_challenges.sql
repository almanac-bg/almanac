-- Challenges are gone (friends duel each other, and compare their day): their links and the runs' link to them.
-- Runs of challenges stay, as the games they were.
-- drops: challenges, runs.challenge, runs_challenge
DROP INDEX runs_challenge;
DROP TABLE challenges;
ALTER TABLE runs DROP COLUMN challenge;
