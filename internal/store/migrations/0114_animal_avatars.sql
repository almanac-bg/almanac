-- An avatar is a face, so an animal (2026-11-21, DECISIONS.md: a seal's reward is the seal itself, worn on the
-- avatar's corner): a chapter's art chosen as an avatar goes, and the player has the animal the game gives them
-- (play.DefaultAvatar). By the shape alone, kept as "shape" or as "shape-tone", so that it holds before or after the
-- tone goes from the avatar.
UPDATE users SET avatar = NULL
WHERE avatar IS NOT NULL
  AND substr(avatar, 1, instr(avatar || '-', '-') - 1) NOT IN (
    'fox', 'bear', 'cat', 'hare', 'hedgehog', 'dog', 'deer', 'stork', 'frog',
    'mouse', 'squirrel', 'sheep', 'turtle', 'badger', 'lynx'
  );
