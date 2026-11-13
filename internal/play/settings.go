package play

import (
	"encoding/json"
	"errors"
	"math"
	"math/rand/v2"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Settings are how a player wants a topic run: how many questions, how hard, which kinds, and how much time. The zero
// value is the standard run: ten questions shaped by how well the player knows the topic, every kind, the usual time.
type Settings struct {
	// Length is 5, 10 or 15 (0 for ten).
	Length int `json:"length,omitempty"`
	// Difficulty is easy, medium or hard for a run of only those ("" to follow the player's level).
	Difficulty bank.Difficulty `json:"difficulty,omitempty"`
	// Kinds are the kinds of question to ask, in bank.TypeOrder's order (none for every kind).
	Kinds []string `json:"kinds,omitempty"`
	// Slow doubles every question's time.
	Slow bool `json:"slow,omitempty"`
}

// Lengths a run may have.
var Lengths = []int{5, Length, 15}

// ErrBadSettings is settings a run can't be played by.
var ErrBadSettings = errors.New("settings a run can't take")

// Normal checks settings and puts them in their one form: the standard run's are the zero value (kept as NULL), a
// length of ten is 0, and the kinds are in order, all of them being none.
func (s Settings) Normal() (Settings, error) {
	if s.Length == Length {
		s.Length = 0
	}
	if s.Length != 0 && !slices.Contains(Lengths, s.Length) {
		return s, ErrBadSettings
	}
	if s.Difficulty != "" && !slices.Contains(bank.Difficulties, s.Difficulty) {
		return s, ErrBadSettings
	}
	var kinds []string
	for _, t := range bank.TypeOrder {
		if slices.Contains(s.Kinds, t) {
			kinds = append(kinds, t)
		}
	}
	if len(kinds) != len(s.Kinds) {
		return s, ErrBadSettings // an unknown kind, or one twice
	}
	if len(kinds) == len(bank.TypeOrder) {
		kinds = nil
	}
	s.Kinds = kinds
	return s, nil
}

// Standard is whether these are the standard run's settings.
func (s Settings) Standard() bool {
	return s.Length == 0 && s.Difficulty == "" && len(s.Kinds) == 0 && !s.Slow
}

// Count is how many questions a run of these settings has.
func (s Settings) Count() int {
	if s.Length == 0 {
		return Length
	}
	return s.Length
}

// stored is the settings as a run keeps them: NULL for the standard run.
func (s Settings) stored() any {
	if s.Standard() {
		return nil
	}
	data, _ := json.Marshal(s)
	return string(data)
}

// limit is how long a question is shown in a run of these settings.
func (s Settings) limit(q bank.Question) time.Duration {
	if s.Slow {
		return 2 * Limit(q)
	}
	return Limit(q)
}

// worth is what an answer earns: its score, times what a right answer to a question of its difficulty is worth.
// Harder questions are worth more, so that playing at one's level pays more than picking easy ones; a run that goes
// from easy to hard (a day's, a Роял's) earns about what it would at a flat 100.
func worth(q bank.Question, score float64) int {
	return int(math.Round(score * MaxPoints * weight[q.Base().Difficulty]))
}

var weight = map[bank.Difficulty]float64{bank.Easy: 0.6, bank.Medium: 1, bank.Hard: 1.4}

// slots is a topic run's shape for a player's skill there (how often they're right) and their settings. Following
// the player's level, easier questions for those still learning a topic, harder ones as they get it right; or all of
// one difficulty. Every kind: a true-or-not early, an order and a match in the middle, a number to finish on, and the
// rest choices (a short run has room for one of the order, the match and the number). Some kinds only: spread
// through the run in the shares the bank aims for.
func (s Settings) slots(skill float64, r *rand.Rand) []slot {
	n := s.Count()
	var easy, medium int
	switch {
	case skill < 0.45:
		easy, medium = 5, 4
	case skill < 0.7:
		easy, medium = 3, 5
	case skill < 0.85:
		easy, medium = 2, 4
	default:
		easy, medium = 1, 4
	}
	easy, medium = easy*n/Length, int(math.Round(float64(medium*n)/Length))
	slots := make([]slot, n)
	for i := range slots {
		d := bank.Hard
		switch {
		case s.Difficulty != "":
			d = s.Difficulty
		case i < easy:
			d = bank.Easy
		case i < easy+medium:
			d = bank.Medium
		}
		slots[i] = slot{difficulty: d, typ: "choice"}
	}
	if len(s.Kinds) > 0 {
		for i, t := range spread(s.Kinds, n) {
			slots[i].typ = t
		}
		return slots
	}
	slots[1].typ = "truefalse"
	switch n {
	case 5:
		slots[3].typ = []string{"order", "match", "number"}[r.IntN(3)]
		return slots
	case 15:
		slots[easy+medium].typ = "truefalse"
	}
	mid := max(2, easy+medium/2)
	slots[mid].typ = "order"
	slots[max(mid+1, easy+medium-1)].typ = "match"
	slots[n-1].typ = "number"
	return slots
}

// spread gives n places kinds in the shares of bank.TypeMix among them (each at least once, where n allows), each
// kind's places spaced evenly through the run.
func spread(kinds []string, n int) []string {
	var sum float64
	for _, t := range kinds {
		sum += bank.TypeMix[t]
	}
	counts := make([]int, len(kinds))
	left := n
	for i, t := range kinds {
		counts[i] = max(1, int(float64(n)*bank.TypeMix[t]/sum))
		left -= counts[i]
	}
	for i := 0; left > 0; i = (i + 1) % len(kinds) { // the spare places to the larger shares first
		counts[i]++
		left--
	}
	for left < 0 { // more kinds than places: the larger ones give theirs up
		i := slices.Index(counts, slices.Max(counts))
		counts[i]--
		left++
	}
	type place struct {
		at   float64
		kind string
	}
	var places []place
	for i, t := range kinds {
		for j := range counts[i] {
			places = append(places, place{(float64(j) + 0.5) / float64(counts[i]), t})
		}
	}
	slices.SortStableFunc(places, func(a, b place) int {
		switch {
		case a.at < b.at:
			return -1
		case a.at > b.at:
			return 1
		}
		return 0
	})
	out := make([]string, n)
	for i, p := range places {
		out[i] = p.kind
	}
	return out
}
