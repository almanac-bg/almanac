package play

import (
	"errors"
	"testing"
)

// A game is of one of the bank's chapters, a chapter's: „Микс“ (every chapter at once) and „България“ are no longer
// ways to play (owner, 2026-11-22), though a duel still draws from every chapter.
func TestOnlyChaptersPlay(t *testing.T) {
	w := setup(t)
	u := w.user()
	for _, chapter := range []string{MixChapter, "bulgaria", "nosuch"} {
		if w.g.IsChapter(chapter) {
			t.Errorf("%s is a chapter", chapter)
		}
		if _, err := w.g.StartChapter(t.Context(), u, chapter); !errors.Is(err, ErrNoChapter) {
			t.Errorf("a game of %s: %v, want ErrNoChapter", chapter, err)
		}
	}
	if s, err := w.g.StartChapter(t.Context(), u, "history"); err != nil || s.Chapter != "history" {
		t.Fatalf("a chapter's game: %+v %v", s, err)
	}
}
