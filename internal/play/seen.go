package play

import (
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A live game (a duel, Роял) shows each question to everyone at the same moment, but a player's screen shows
// it later: the trip to the phone, the screen drawn, its pictures coming in. Measured from the game's moment alone, a
// phone on a slow line, or a question with pictures, would cost its player time against one on a fast line, in points
// for speed, in a duel's tie and in Роял's cuts. So a player's time on a live question runs from when their own screen
// showed it, as it says (Saw: it tells the server once the question is drawn with its pictures in), and the game keeps
// that moment for each player under its own lock. What a screen says is trusted only so far: never before the game
// showed the question, nor later than SeenLag after it (so that a screen that says it late gains SeenLag at most),
// nor after its own answer came. A screen that hasn't said, when its answer comes, is timed from the game's moment, as
// before (nothing to gain by not saying); but its time to answer runs until the latest it could have said (LiveDue),
// so that a word lost on the way never costs anyone the question.
//
// What a clue is worth (bank.Paced) still goes by the game's own moment: the clues come out on the game's clock, the
// same for everyone, and an answer is paid by the clues out when it came (bank.ClueEvery).
const (
	// SeenLag is the most a screen may show a live question after the game showed it, and still have its time run
	// from then: the trip there and back, and a slow phone drawing it.
	SeenLag = 1500 * time.Millisecond
	// PicturesFor is the longest a screen waits for a live question's pictures before it shows the question all the
	// same (web/src/game/answering.ts: picturesFor), and so the more SeenLag a question with pictures allows.
	PicturesFor = 2500 * time.Millisecond
	// LongestLag is the most SeenLag any question allows.
	LongestLag = SeenLag + PicturesFor
)

// LagOf is how long after the game showed q a player's screen may show it and still have its time run from then.
func LagOf(q bank.Question) time.Duration {
	if bank.HasPictures(q) {
		return LongestLag
	}
	return SeenLag
}

// Saw is when a player's screen showed q, a live question the game showed at shown, as it said so at said (the moment
// its word came): no earlier than shown, no later than LagOf(q) after it.
func Saw(shown, said time.Time, q bank.Question) time.Time {
	if said.Before(shown) {
		return shown
	}
	if latest := shown.Add(LagOf(q)); said.After(latest) {
		return latest
	}
	return said
}

// LiveTook is how long a player's answer to a live question took, from when their screen showed it (saw, by Saw; zero:
// it hasn't said, so from when the game showed it, shown) to when the answer came (at), never less than nothing.
func LiveTook(shown, saw, at time.Time) time.Duration {
	start := shown
	if !saw.IsZero() && saw.After(shown) && !saw.After(at) {
		start = saw
	}
	return max(0, at.Sub(start))
}

// LiveDue is when a player's time on q, a live question shown at shown, is up (an answer may still come within Grace
// of it): its Limit after their screen showed it (saw), or, while it hasn't said, after the latest it could (LagOf).
func LiveDue(shown, saw time.Time, q bank.Question) time.Time {
	if saw.IsZero() {
		saw = shown.Add(LagOf(q))
	}
	return saw.Add(Limit(q))
}
