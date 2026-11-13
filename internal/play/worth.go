package play

import (
	"math"

	"github.com/almanac-bg/almanac/internal/bank"
)

// worth is what an answer earns: its score, times what a right answer to a question of its difficulty is worth.
// Harder questions are worth more, so that knowing a topic well (and so drawing harder questions) pays more; a run
// that goes from easy to hard (a day's, a Роял's) earns about what it would at a flat 100.
func worth(q bank.Question, score float64) int {
	return int(math.Round(score * MaxPoints * weight[q.Base().Difficulty]))
}

var weight = map[bank.Difficulty]float64{bank.Easy: 0.6, bank.Medium: 1, bank.Hard: 1.4}
