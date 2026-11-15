-- The achievements for answers given („Сто отговора“, „Хиляда отговора“) become the ones for facts collected in the
-- Алманах (play.Achievements): „Сто факта“ and „Хиляда факта“. Whoever earned one keeps it under its new name, with
-- the XP it paid and what it unlocked (the book avatar, the first epic's pattern), whatever their almanac holds now.
UPDATE achievements SET id = 'facts100' WHERE id = 'answers100';
UPDATE achievements SET id = 'facts1000' WHERE id = 'answers1000';
