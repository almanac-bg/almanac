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
