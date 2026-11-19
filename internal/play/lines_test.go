package play

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

// The one who asked hears once that the other said yes to their request; not the one who said yes, nor once it's old
// news.
func TestAccepted(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy, di := w.user(), w.user(), w.user(), w.user()

	// Bo says yes to Ana: Ana hears of it, Bo doesn't.
	w.befriend(ana, bo)
	a, err := w.g.AcceptedOf(ctx, ana)
	if err != nil || a == nil || a.ID != bo || a.Line != fmt.Sprintf("friend:%d", bo) {
		t.Fatalf("Ana: %+v (%v)", a, err)
	}
	if a, _ := w.g.AcceptedOf(ctx, bo); a != nil {
		t.Fatalf("Bo said yes, he isn't told: %+v", a)
	}
	if err := w.g.Told(ctx, ana, a.Line); err != nil {
		t.Fatal(err)
	}
	if a, _ := w.g.AcceptedOf(ctx, ana); a != nil {
		t.Fatalf("told twice: %+v", a)
	}

	// Cy asks Ana by her tag, and she says yes: Cy hears of it.
	if _, err := w.g.Request(ctx, cy, "player1", false); err != nil {
		t.Fatal(err)
	}
	in, _, err := w.g.Requests(ctx, ana)
	if err != nil || len(in) != 1 {
		t.Fatalf("Ana's requests: %+v (%v)", in, err)
	}
	if _, err := w.g.Accept(ctx, ana, in[0].ID); err != nil {
		t.Fatal(err)
	}
	if a, _ := w.g.AcceptedOf(ctx, cy); a == nil || a.ID != ana {
		t.Fatalf("Cy: %+v", a)
	}
	if a, _ := w.g.AcceptedOf(ctx, ana); a != nil {
		t.Fatalf("Ana said yes to Cy: %+v", a)
	}

	// Di says yes to Bo; a week later it's old news.
	w.befriend(bo, di)
	w.wait(LinesRecent + time.Hour)
	if a, _ := w.g.AcceptedOf(ctx, bo); a != nil {
		t.Fatalf("old news: %+v", a)
	}

	if err := w.g.Told(ctx, ana, "anything"); !errors.Is(err, ErrNoLine) {
		t.Fatalf("a line that isn't one: %v", err)
	}
	// Nor one about someone not a friend, or a duel not theirs: nothing to fill the table with.
	stranger := w.user()
	for _, line := range []string{fmt.Sprintf("friend:%d", stranger), "left:999999"} {
		if err := w.g.Told(ctx, ana, line); !errors.Is(err, ErrNoLine) {
			t.Fatalf("%s: %v", line, err)
		}
	}
}
