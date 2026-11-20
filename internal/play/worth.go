package play

import (
	"math"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Points are a game's score: what each answer earned, added up within one game, to compare players who played the
// same questions (a duel, the day's), never added up across games. What a player earns by playing is XP (xp),
// and how strong they are is their rating.
//
// An answer earns
//
//	MaxPoints × difficulty × kind × score × (1 − SpeedShare + SpeedShare × speed)
//
// rounded to tens, where score is what the answer was worth (0–1, luck taken out: bank.Graded), difficulty pays more
// for harder questions, kind pays half for a true-or-not (half of guesses come out right: a guess at one is worth
// what a guess at a choice of four is), and speed is how quick it came: full in the first QuickPart of the
// question's time, then less, down to nothing at the end. Speed is at most SpeedShare of an answer, so that knowing
// counts the most and looking an answer up costs. A game whose every answer was right earns AllRight more at its end.
// Right answers in a row earn nothing more (owner, 2026-11-18, review E6): with a bonus for the row, where a miss fell
// decided close duels, more than a right answer to an easy question did. The row is still
// heard and seen (the run's climb, „3 поред“), as feel only.
//
// The numbers are big on purpose: a right answer is worth a thousand, a good game ten thousand. It's the same game
// whatever the scale, and earning a lot feels better.

const (
	// SpeedShare is the part of an answer's points that's for speed.
	SpeedShare = 0.25
	// QuickPart is the part of a question's time an answer may take and still earn all of its speed: time to read,
	// and to get through a slow line.
	QuickPart = 0.25
	// AllRight is what a game earns at its end when every answer was right.
	AllRight = 2000
)

var (
	weight = map[bank.Difficulty]float64{bank.Easy: 0.8, bank.Medium: 1, bank.Hard: 1.2}
	kinds  = map[string]float64{"truefalse": 0.5}
)

// Worth is what an answer earned: its points, and how many of them are for speed.
type Worth struct {
	Points int
	Speed  int
}

// WorthOf is what an answer of a score to a question, given after took, earns, at the question's own label.
func WorthOf(q bank.Question, score float64, took time.Duration) Worth {
	return worthAt(q, q.Base().Difficulty, score, took)
}

// worth is what an answer to a pick earns (WorthOf), at the difficulty the pick showed at (Pick.D): a question
// relabelled while it's in play (calibration moves labels, and never the version) pays the same for the same answer,
// in a run, between a duel's two players, and all day long on the day's ten. A pick from before it was kept pays
// at the question's label.
func (p Pick) worth(q bank.Question, score float64, took time.Duration) Worth {
	level := p.D
	if _, ok := weight[level]; !ok {
		level = q.Base().Difficulty
	}
	return worthAt(q, level, score, took)
}

// worthAt is what an answer earns, the question taken as of a difficulty.
func worthAt(q bank.Question, level bank.Difficulty, score float64, took time.Duration) Worth {
	h := q.Base()
	k, ok := kinds[h.Type]
	if !ok {
		k = 1
	}
	full := score * MaxPoints * weight[level] * k
	base := tens(full * (1 - SpeedShare))
	points := tens(full * (1 - SpeedShare + SpeedShare*speed(took, Limit(q))))
	return Worth{Points: points, Speed: points - base}
}

// tens rounds points to tens.
func tens(x float64) int { return 10 * int(math.Round(x/10)) }

// speed is how quick an answer was, 0–1: 1 in the first QuickPart of the time, then less, to 0 at its end.
func speed(took, limit time.Duration) float64 {
	quick := time.Duration(float64(limit) * QuickPart)
	if took <= quick {
		return 1
	}
	return max(0, float64(limit-took)/float64(limit-quick))
}

// XP is what a player earns by playing: it adds up across games, and makes their level. It's for knowing, with a
// little for playing: an answer earns XPKnown times its score and XPAnswer for being given, and a game's end earns
// XPFinish in the share of it answered right, so that tapping at random earns a fraction of what knowing does. Never
// for being quick or drawing harder questions, so that someone still learning a topic, or reading slowly, goes up as
// surely as anyone. The day's questions earn XPDay for coming, whatever the score: the day is the habit, worth about
// two other games (at 50 it was a quarter of an engaged player's XP, and a day-only player's ladder went quiet for
// months: review 2026-11-18, E8). The day's goals and achievements earn more (progress.go).
const (
	// XPAnswer is what any answer given earns (one left to run out of time, or given up on, earns nothing)…
	XPAnswer = 2
	// …and XPKnown more, times its score: a right answer earns 20 in all.
	XPKnown = 18
	// XPFinish is for a game played to its end, in the share of its questions answered right; XPDay more, all of it,
	// for the day's questions.
	XPFinish = 50
	XPDay    = 150
)

// xp is what an answer earns: a little for giving one, the rest for what it was worth.
func xp(gr bank.Graded) int {
	if gr.Given == nil {
		return 0
	}
	return XPAnswer + int(math.Round(XPKnown*gr.Score))
}

// finishXP is what playing a game to its end earns: XPFinish in the share of its questions answered right, and the
// day's XPDay.
func finishXP(kind string, rights, total int) int {
	xp := 0
	if total > 0 {
		xp = int(math.Round(float64(XPFinish*rights) / float64(total)))
	}
	if kind == "day" {
		xp += XPDay
	}
	return xp
}
