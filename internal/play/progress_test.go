package play

import (
	"errors"
	"slices"
	"testing"
)

// Every animal is every player's from the first day, in any tone; nothing else is an avatar.
func TestAvatars(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	if look, _ := w.g.LookOf(ctx, ana); look.Avatar != DefaultAvatar(ana) {
		t.Fatalf("before choosing: %+v", look)
	}
	for _, shape := range Shapes {
		for _, tone := range Tones {
			if err := w.g.SetAvatar(ctx, ana, shape+"-"+tone); err != nil {
				t.Fatalf("%s in %s: %v", shape, tone, err)
			}
		}
	}
	if look, _ := w.g.LookOf(ctx, ana); look.Avatar != "lynx-natural" {
		t.Fatalf("the last chosen: %+v", look)
	}
	for _, bad := range []string{"crown-gold", "flame-gold", "fox-black", "fox", "", "fox-gold/ring"} {
		if err := w.g.SetAvatar(ctx, ana, bad); !errors.Is(err, ErrNoAvatar) {
			t.Fatalf("%q: %v", bad, err)
		}
	}
	// Every starter's animal is drawn among the shapes, first, in order: a new player's default is one a player may
	// choose.
	if !slices.Equal(Shapes[:len(Starters)], Starters) || len(Shapes) != 15 {
		t.Fatalf("shapes %v", Shapes)
	}
}

// A day's ten all right is noted once, on its own day; a topic's game all right isn't a day's ten, and a bad day
// notes nothing.
func TestPerfectNoted(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	s, _ := w.g.StartTopic(ctx, ana, "history")
	w.play(ana, s.ID, repeat(w.right, Length)...)
	w.dayGame(ana, nil, repeat(w.wrong, Length)...)
	w.g.AftersDone(ctx)
	if n, _ := w.g.NewsOf(ctx, ana, 0); len(n.Notes) != 0 {
		t.Fatalf("noted: %+v", n.Notes)
	}
	bo := w.user()
	w.dayGame(bo, nil)
	w.g.AftersDone(ctx)
	n, _ := w.g.NewsOf(ctx, bo, dayRun(t, w, bo))
	if !slices.Equal(n.Notes, []Note{{Day: w.g.Today(), Kind: NotePerfect}}) {
		t.Fatalf("a day all right: %+v", n.Notes)
	}
}
