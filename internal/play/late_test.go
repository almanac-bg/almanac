package play

import (
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The clock is a base for the kind and a slow reader's time to read the question, never under the kind's floor: 20 s
// for a true-or-not, 35 s for a choice or a number, 60 s for an order, a match, a split or clues; and never over
// LongestLimit.
func TestLimitByLength(t *testing.T) {
	short := bank.Head{Text: "Кратко?"}
	for typ, floor := range map[string]time.Duration{
		"truefalse": 20 * time.Second, "choice": 35 * time.Second, "number": 35 * time.Second,
		"order": 60 * time.Second, "match": 60 * time.Second, "split": 60 * time.Second, "clues": 60 * time.Second,
	} {
		h := short
		h.Type = typ
		var q bank.Question
		switch typ {
		case "truefalse":
			q = &bank.TrueFalse{Head: h}
		case "number":
			q = &bank.Number{Head: h}
		case "order":
			q = &bank.Order{Head: h}
		case "match":
			q = &bank.Match{Head: h}
		case "split":
			q = &bank.Split{Head: h}
		case "clues":
			q = &bank.Clues{Head: h}
		default:
			q = &bank.Choice{Head: h}
		}
		if got := Limit(q); got != floor {
			t.Errorf("a short %s: %v, want its floor %v", typ, got, floor)
		}
	}
	// A long choice: its base and its reading, past the floor.
	long := &bank.Choice{Head: bank.Head{Type: "choice", Text: strings.Repeat("дума ", 50) + "?"},
		Answer: strings.Repeat("а", 40), Wrong: []string{strings.Repeat("б", 40), strings.Repeat("в", 40), strings.Repeat("г", 40)}}
	read := float64(bank.Reading(long)) / SlowReading
	if want := (limits["choice"].base + time.Duration(read*float64(time.Second))).Round(time.Second); Limit(long) != want ||
		want <= 35*time.Second {
		t.Errorf("a long choice (%d letters): %v, want %v, past its floor", bank.Reading(long), Limit(long), want)
	}
	// However long, never over LongestLimit.
	longer := &bank.TrueFalse{Head: bank.Head{Type: "truefalse", Text: strings.Repeat("дума ", 400)}}
	if Limit(longer) != LongestLimit {
		t.Errorf("a statement of 1600 letters: %v, want %v", Limit(longer), LongestLimit)
	}
	// A picture is looked at: a choice of pictures reads them.
	pics := &bank.Choice{Head: bank.Head{Type: "choice", Text: "Кое е?"}, Pictures: make([]bank.Image, 4)}
	if bank.Reading(pics) != 4*bank.PictureReading+len([]rune("Коее")) {
		t.Errorf("a choice of four pictures reads %d", bank.Reading(pics))
	}
}

// An answer the screen timed within the question's limit is taken while it reaches the server within LateGrace of
// the limit's end, and kept for /admin's count; one the screen didn't time so counts within Grace only; none after
// LateGrace.
func TestLateAnswers(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	s, _ := w.g.StartDay(ctx, u)
	at := func(n int, after time.Duration, inTime bool) Result {
		t.Helper()
		if _, err := w.g.Show(ctx, u, s.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := w.g.Start(ctx, u, s.ID, n); err != nil {
			t.Fatal(err)
		}
		w.wait(Limit(w.question(s.ID, n)) + after)
		res, err := w.g.AnswerTimed(ctx, u, s.ID, n, w.right(s.ID, n), inTime)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	if res := at(0, 10*time.Second, true); res.TimedOut || !res.Right {
		t.Fatalf("timed in time, 10 s late: %+v", res)
	}
	if res := at(1, 10*time.Second, false); !res.TimedOut || res.Right {
		t.Fatalf("not timed in time, 10 s late: %+v", res)
	}
	if res := at(2, LateGrace+time.Second, true); !res.TimedOut || res.Right {
		t.Fatalf("timed in time, past LateGrace: %+v", res)
	}
	if res := at(3, Grace/2, false); res.TimedOut || !res.Right {
		t.Fatalf("within Grace: %+v", res)
	}
	if res := at(4, Grace/2, true); res.TimedOut || !res.Right {
		t.Fatalf("timed in time, within Grace: %+v", res)
	}
	// Only the one taken past Grace is counted, by player.
	late, err := w.g.LateAnswerers(ctx, 10)
	if err != nil || len(late) != 1 || late[0].Late != 1 || late[0].Answers != 5 || late[0].MostMs != 10_000 {
		t.Fatalf("the late answers: %+v %v", late, err)
	}
	// Let go of after LateKept.
	w.wait(LateKept + time.Hour)
	if _, err := w.g.JudgeNets(ctx); err != nil {
		t.Fatal(err)
	}
	if late, err := w.g.LateAnswerers(ctx, 10); err != nil || len(late) != 0 {
		t.Fatalf("a month on: %+v %v", late, err)
	}
}

// /admin counts the answers run out of time by kind, what the clock's floors are set by: a time run out counts, an
// answer or a give-up doesn't.
func TestTimedOutByKind(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	s, _ := w.g.StartDay(ctx, u)
	w.show(u, s.ID)
	w.wait(3 * time.Second)
	if _, err := w.answer(u, s.ID, 0, w.right(s.ID, 0)); err != nil {
		t.Fatal(err)
	}
	w.show(u, s.ID)
	w.wait(time.Second + 300*time.Millisecond)
	if _, err := w.g.Answer(ctx, u, s.ID, 1, nil); err != nil { // given up
		t.Fatal(err)
	}
	w.show(u, s.ID)
	w.wait(Limit(w.question(s.ID, 2)) + time.Minute) // run out
	if _, err := w.g.State(ctx, u, s.ID); err != nil {
		t.Fatal(err)
	}
	list, err := w.g.TimedOutSince(ctx, w.g.Today())
	if err != nil {
		t.Fatal(err)
	}
	n, of := 0, 0
	for _, k := range list {
		n, of = n+k.N, of+k.Of
	}
	if n != 1 || of != 3 {
		t.Fatalf("run out %d of %d: %+v", n, of, list)
	}
}
