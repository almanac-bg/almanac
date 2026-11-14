-- Points are ten times what they were (play/worth.go: a right answer is worth a thousand), so that a game's score
-- feels like what it earned. Points kept so far are scaled too: a duel against a run played before, or a day's board,
-- compares like with like.
UPDATE runs SET points = points * 10;
UPDATE answers SET points = points * 10;
