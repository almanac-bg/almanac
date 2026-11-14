-- The avatars drawn anew (web/src/art/pictures.ts): the nine free shapes became animals, and the eye that „Нощна
-- птица“ unlocks became an owl. A look is "shape-tone": the shape changes, the tone stays.
UPDATE users
SET avatar = CASE substr(avatar, 1, instr(avatar, '-') - 1)
    WHEN 'petal' THEN 'fox'
    WHEN 'rosette' THEN 'bear'
    WHEN 'circle' THEN 'cat'
    WHEN 'diamond' THEN 'hare'
    WHEN 'triangle' THEN 'hedgehog'
    WHEN 'moon' THEN 'dog'
    WHEN 'leaf' THEN 'deer'
    WHEN 'wave' THEN 'stork'
    WHEN 'hex' THEN 'frog'
    WHEN 'eye' THEN 'owl'
  END || substr(avatar, instr(avatar, '-'))
WHERE instr(avatar, '-') > 0
  AND substr(avatar, 1, instr(avatar, '-') - 1) IN
    ('petal', 'rosette', 'circle', 'diamond', 'triangle', 'moon', 'leaf', 'wave', 'hex', 'eye');
