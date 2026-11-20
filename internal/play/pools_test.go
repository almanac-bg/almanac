package play

import (
	"context"
	"testing"
	"time"
)

// No read holds a connection of the read pool while it waits for another: the pool is about as big as the machine
// has cores (store.Open), and as many such reads at once as it has connections would wait for each other for ever.
// Played and looked at with one connection in each pool, the game never waits.
func TestReadsNeverNest(t *testing.T) {
	w := setup(t)
	w.db.Read.SetMaxOpenConns(1)
	w.db.Scan.SetMaxOpenConns(1)
	ana, bo := w.user(), w.user()
	w.befriend(ana, bo)
	ctx := t.Context()
	day, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, day.ID, repeat(w.wrong, Length)...)
	topic, err := w.g.StartTopic(ctx, bo, w.b.Categories[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	w.play(bo, topic.ID, repeat(w.right, Length)...)
	duel, err := w.g.DuelFriend(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}
	w.playSide(ana, duel, repeat(w.right, Length))
	reads := map[string]func(context.Context) error{
		"Count":        w.g.Count,
		"NewsOf":       func(ctx context.Context) error { _, err := w.g.NewsOf(ctx, bo, topic.ID); return err },
		"NotesOf":      func(ctx context.Context) error { _, err := w.g.NotesOf(ctx, ana); return err },
		"ProfileOf":    func(ctx context.Context) error { _, err := w.g.ProfileOf(ctx, "player2", ana); return err },
		"StatsOf":      func(ctx context.Context) error { _, err := w.g.StatsOf(ctx, ana); return err },
		"BoardOf":      func(ctx context.Context) error { _, err := w.g.BoardOf(ctx, w.g.Today(), ana); return err },
		"FriendsBoard": func(ctx context.Context) error { _, err := w.g.FriendsBoard(ctx, w.g.Today(), bo); return err },
		"MasteryMoves": func(ctx context.Context) error { _, err := w.g.MasteryMoves(ctx, bo, topic.ID); return err },
		"StreakOf":     func(ctx context.Context) error { _, err := w.g.StreakOf(ctx, ana); return err },
		"DuelsOf":      func(ctx context.Context) error { _, err := w.g.DuelsOf(ctx, ana); return err },
		"DuelOf":       func(ctx context.Context) error { _, err := w.g.DuelOf(ctx, bo, duel); return err },
		"DuelsWaiting": func(ctx context.Context) error { _, err := w.g.DuelsWaiting(ctx, bo); return err },
		"RarestRight":  func(ctx context.Context) error { _, err := w.g.RarestRight(ctx, ana, w.g.Today()); return err },
		"Suspects":     func(ctx context.Context) error { _, err := w.g.Suspects(ctx); return err },
	}
	for name, read := range reads {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		if err := read(ctx); err != nil {
			t.Errorf("%s: %v", name, err)
		}
		cancel()
	}
}
