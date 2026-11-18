package play

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// What a screen says of when it showed a live question is trusted only so far: not before the game showed it, not
// more than LagOf after (more with pictures), and never after the answer it times (review 2026-11-18, M1).
func TestSaw(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	words, _ := b.Get("geo-960")
	shown := time.Date(2026, 11, 18, 21, 0, 0, 0, Bulgaria)
	for _, c := range []struct {
		said, want time.Duration
	}{
		{-time.Second, 0},
		{0, 0},
		{time.Second, time.Second},
		{SeenLag, SeenLag},
		{10 * time.Second, SeenLag},
	} {
		if got := Saw(shown, shown.Add(c.said), words).Sub(shown); got != c.want {
			t.Errorf("said %v after: %v, want %v", c.said, got, c.want)
		}
	}
	if LagOf(words) != SeenLag || LongestLag != SeenLag+PicturesFor {
		t.Errorf("a question's lag: %v", LagOf(words))
	}
	if flag, _ := b.Get("geo-901"); !bank.HasPictures(flag) || LagOf(flag) != LongestLag {
		t.Errorf("a question with a picture: %v", LagOf(flag))
	}

	saw := shown.Add(time.Second)
	if got := LiveTook(shown, saw, shown.Add(3*time.Second)); got != 2*time.Second {
		t.Errorf("from the screen: %v", got)
	}
	if got := LiveTook(shown, time.Time{}, shown.Add(3*time.Second)); got != 3*time.Second {
		t.Errorf("not said: from the game's moment: %v", got)
	}
	if got := LiveTook(shown, shown.Add(4*time.Second), shown.Add(3*time.Second)); got != 3*time.Second {
		t.Errorf("said after the answer: from the game's moment: %v", got)
	}
	limit := Limit(words)
	if got := LiveDue(shown, saw, words).Sub(shown); got != time.Second+limit {
		t.Errorf("due, said: %v", got)
	}
	if got := LiveDue(shown, time.Time{}, words).Sub(shown); got != SeenLag+limit {
		t.Errorf("due, not said: %v", got)
	}
}

// A live game's answer counts the player's time from when their screen showed the question (paying for speed, and
// kept for a duel's tie and Роял's cuts), and runs to their own time's end; what a clue is worth goes by the game's
// clock, the clues out when the answer came.
func TestAnswerLiveFromTheScreen(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	run := w.runOf(ana, "duel", "lit-964", "geo-960", "geo-960")
	pick := func(n int) json.RawMessage {
		raw, _ := json.Marshal(w.dealt(run, n).Reveal(nil))
		var rv struct {
			Pick  *int  `json:"pick"`
			Truth *bool `json:"truth"`
		}
		_ = json.Unmarshal(raw, &rv)
		if rv.Truth != nil {
			return json.RawMessage(fmt.Sprintf(`{"truth":%v}`, *rv.Truth))
		}
		return json.RawMessage(fmt.Sprintf(`{"pick":%d}`, *rv.Pick))
	}
	ms := func(n int) int64 {
		var ms int64
		_ = w.db.Read.QueryRow(`SELECT ms FROM answers WHERE run_id = ? AND n = ?`, run, n).Scan(&ms)
		return ms
	}
	show := func(n int) time.Time {
		if err := w.g.ShowLive(ctx, ana, run, n, w.now, w.dealt(run, n)); err != nil {
			t.Fatal(err)
		}
		return w.now
	}

	// Clues: the screen showed it a second and a half late; the answer comes eleven seconds after the game showed
	// it, the second clue out: paid as the second clue's, its time nine and a half seconds.
	shown := show(0)
	w.wait(11 * time.Second)
	res, err := w.g.AnswerLive(ctx, ana, run, 0, pick(0), w.now, shown.Add(SeenLag), w.dealt(run, 0))
	if err != nil || !res.Right || res.Score != bank.ClueWorth[1] || ms(0) != 9500 {
		t.Fatalf("a clue's answer: %+v %v, %d ms", res, err, ms(0))
	}

	// True or false, shown on the screen a second and a half late: an answer past the game's Limit and Grace, but
	// within the player's own, counts.
	shown = show(1)
	limit := Limit(w.dealt(run, 1).Question())
	w.wait(SeenLag + limit + Grace - 100*time.Millisecond)
	res, err = w.g.AnswerLive(ctx, ana, run, 1, pick(1), w.now, shown.Add(SeenLag), w.dealt(run, 1))
	if err != nil || !res.Right || res.TimedOut || ms(1) != limit.Milliseconds() {
		t.Fatalf("an answer in the player's own time: %+v %v, %d ms", res, err, ms(1))
	}
	// Past it, too late.
	shown = show(2)
	w.wait(time.Second + limit + Grace + 100*time.Millisecond)
	res, err = w.g.AnswerLive(ctx, ana, run, 2, pick(2), w.now, shown.Add(time.Second), w.dealt(run, 2))
	if err != nil || !res.TimedOut || res.Right {
		t.Fatalf("an answer past the player's own time: %+v %v", res, err)
	}
}
