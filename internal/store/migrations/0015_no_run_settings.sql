-- Game settings are gone: everyone plays the same game. Runs played with them stay, as the games they were.
-- drops: runs.settings
ALTER TABLE runs DROP COLUMN settings;
