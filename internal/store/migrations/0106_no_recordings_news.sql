-- The recorded player is no longer told what others' duels against their recordings came to, so nothing keeps when
-- they last heard of it; and „Още един дуел срещу запис“ asks for the level the player chose last on that device
-- (web/src/screens/duel.ts), so a duel no longer keeps the level asked for apart from the level met (duels.level).
-- drops: users.recordings_told, duels.asked
ALTER TABLE users DROP COLUMN recordings_told;
ALTER TABLE duels DROP COLUMN asked;
