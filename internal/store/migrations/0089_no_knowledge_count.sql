-- The boards of knowledge are gone with Класации (the client's redesign): nothing counts everyone's mastery any more,
-- so the count of it kept for a restart (play/snapshot.go) goes. The hardness and the crowds are still kept.
DELETE FROM counts WHERE name = 'knowledge';
