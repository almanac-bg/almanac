package play

import (
	"slices"

	"github.com/almanac-bg/almanac/internal/bank"
)

// chapterPool is what a game of a chapter draws from: the chapter's live questions, every chapter's for MixChapter (a
// duel's).
func chapterPool(b *bank.Bank, chapter string) []bank.Question {
	if chapter == MixChapter {
		return b.Live("", "")
	}
	return b.Live(chapter, "")
}

// IsChapter is whether a chapter's games can be played, as its page has them: one of the bank's.
func (g *Game) IsChapter(id string) bool {
	return slices.ContainsFunc(g.Bank().Categories, func(c bank.Category) bool { return c.ID == id })
}
