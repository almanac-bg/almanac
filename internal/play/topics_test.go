package play

import (
	"errors"
	"testing"
)

// A game is of one of the bank's topics, a chapter's: „Микс“ (every topic at once) and „България“ are no longer ways
// to play (owner, 2026-11-22), though a duel still draws from every topic.
func TestOnlyChaptersPlay(t *testing.T) {
	w := setup(t)
	u := w.user()
	for _, topic := range []string{MixTopic, "bulgaria", "nosuch"} {
		if w.g.IsTopic(topic) {
			t.Errorf("%s is a topic", topic)
		}
		if _, err := w.g.StartTopic(t.Context(), u, topic); !errors.Is(err, ErrNoTopic) {
			t.Errorf("a game of %s: %v, want ErrNoTopic", topic, err)
		}
	}
	if s, err := w.g.StartTopic(t.Context(), u, "history"); err != nil || s.Category != "history" {
		t.Fatalf("a chapter's game: %+v %v", s, err)
	}
}
