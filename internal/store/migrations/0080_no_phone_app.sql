-- The app for phones is gone (the owner's call, 20 Nov 2026: DECISIONS.md): the game is the website only. The phones'
-- tokens for Apple's and Google's push services go with it. A player who first came in through the app came from
-- somewhere else as far as anyone can tell now (other), a game played in it was played on a phone, and the counts of
-- the app's visits and guests go.
-- drops: phones
DROP TABLE phones;
UPDATE users SET came_from = 'other' WHERE came_from = 'app';
UPDATE runs SET device = 'phone' WHERE device IN ('app-ios', 'app-android');
DELETE FROM daily_counts WHERE key IN ('visit:app', 'guest:app');
