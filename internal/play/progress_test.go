package play

import (
	"errors"
	"slices"
	"testing"
)

// Every animal is every player's from the first day, by its shape alone; nothing else is an avatar.
func TestAvatars(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	if look, _ := w.g.LookOf(ctx, ana); look.Avatar != DefaultAvatar(ana) {
		t.Fatalf("before choosing: %+v", look)
	}
	for _, shape := range Shapes {
		if err := w.g.SetAvatar(ctx, ana, shape); err != nil {
			t.Fatalf("%s: %v", shape, err)
		}
	}
	if look, _ := w.g.LookOf(ctx, ana); look.Avatar != "lynx" {
		t.Fatalf("the last chosen: %+v", look)
	}
	for _, bad := range []string{"crown", "flame", "fox-gold", "fox-natural", "", "fox/ring"} {
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
