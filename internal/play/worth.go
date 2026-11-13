package play

import (
	"math"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Points are a game's score: what each answer earned, added up within one game, to compare players who played the
// same questions (a duel, the day's, a room). They're never added up across games: what a player earns by playing
// is XP (xp), and how strong they are is their rating.
//
// An answer earns
//
//	MaxPoints × difficulty × kind × score × (1 − SpeedShare + SpeedShare × speed)
//
// where score is what the answer was worth (0–1, luck taken out: bank.Graded), difficulty pays more for harder
// questions, kind pays half for a true-or-not (half of guesses come out right: a guess at one is worth what a guess
// at a choice of four is), and speed is how quick it came: full in the first QuickPart of the question's time, then
// less, down to nothing at the end. Speed is at most SpeedShare of an answer, so that knowing counts the most and
// looking an answer up costs.

const (
	// SpeedShare is the part of an answer's points that's for speed.
	SpeedShare = 0.25
	// QuickPart is the part of a question's time an answer may take and still earn all of its speed: time to read,
	// and to get through a slow line.
	QuickPart = 0.25
)

var (
	weight = map[bank.Difficulty]float64{bank.Easy: 0.6, bank.Medium: 1, bank.Hard: 1.4}
	kinds  = map[string]float64{"truefalse": 0.5}
)

// Worth is what an answer earned: its points, and how many of them are for speed.
type Worth struct {
	Points int
	Speed  int
}

// WorthOf is what an answer of a score to a question, given after took, earns: in a run, and in a room.
func WorthOf(q bank.Question, score float64, took time.Duration) Worth {
	h := q.Base()
	k, ok := kinds[h.Type]
	if !ok {
		k = 1
	}
	full := score * MaxPoints * weight[h.Difficulty] * k
	base := int(math.Round(full * (1 - SpeedShare)))
	points := int(math.Round(full * (1 - SpeedShare + SpeedShare*speed(took, Limit(q)))))
	return Worth{Points: points, Speed: points - base}
}

// speed is how quick an answer was, 0–1: 1 in the first QuickPart of the time, then less, to 0 at its end.
func speed(took, limit time.Duration) float64 {
	quick := time.Duration(float64(limit) * QuickPart)
	if took <= quick {
		return 1
	}
	return max(0, float64(limit-took)/float64(limit-quick))
}

// XP is what a player earns by playing: it adds up across games, and makes their level. It's for playing and for
// knowing, never for being quick or drawing harder questions, so that someone still learning a topic, or reading
// slowly, goes up as surely as anyone.
const (
	// XPAnswer is what any answer given earns (one left to run out of time, or given up on, earns nothing)…
	XPAnswer = 10
	// …and XPKnown more, times its score.
	XPKnown = 10
	// XPFinish is for a game played to its end; XPDay more for the day's questions.
	XPFinish = 50
	XPDay    = 50
)

// xp is what an answer earns: something for giving one, more for what it was worth.
func xp(gr bank.Graded) int {
	if gr.Given == nil {
		return 0
	}
	return XPAnswer + int(math.Round(XPKnown*gr.Score))
}

// finishXP is what playing a game to its end earns.
func finishXP(kind string) int {
	if kind == "day" {
		return XPFinish + XPDay
	}
	return XPFinish
}
