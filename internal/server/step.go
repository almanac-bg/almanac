package server

import (
	"context"
	"fmt"
	"log/slog"
)

// The nearest step in a player's book, as the reminders' last word names it (remind.go, lastReminder): the chapter
// nearest its next rank, how much ink it still takes, and the rank („Днешният брой те чака · История: още 1 до
// Тетрадка“). The ranks are play's (ink per chapter, DECISIONS.md, the direction): Server.nearestStep asks play for the
// step, and until it's set, or when a player has none, the word is the day's issue alone. Never a question's text.

// Step is a player's nearest step in their book.
type Step struct {
	// Chapter is the chapter's name, as players read it („История“).
	Chapter string
	// Left is the ink the chapter still takes to reach Rank (1 or more).
	Left int
	// Rank is the rank it reaches („Тетрадка“).
	Rank string
}

// stepOf is a player's nearest step, from play (play.StepOf), its chapter by name: Server.nearestStep.
func (s *Server) stepOf(ctx context.Context, userID int64) (Step, bool, error) {
	st, err := s.game.StepOf(ctx, userID)
	if err != nil || st == nil {
		return Step{}, false, err
	}
	return Step{Chapter: s.chapterName(st.Chapter), Left: st.Left, Rank: st.Next}, true, nil
}

// chapterName is a chapter's name as the bank has it (its id, if the bank has no such).
func (s *Server) chapterName(id string) string {
	for _, c := range s.bank.Load().Categories {
		if c.ID == id {
			return c.Name
		}
	}
	return id
}

// stepWords is the reminders' last word to a player: the day's issue, and their nearest step if they have one.
func (s *Server) stepWords(ctx context.Context, userID int64) string {
	const issue = "Днешният брой те чака"
	if s.nearestStep == nil {
		return issue
	}
	st, ok, err := s.nearestStep(ctx, userID)
	if err != nil {
		slog.Error("the nearest step", "err", err)
		return issue
	}
	if !ok || st.Chapter == "" || st.Rank == "" || st.Left < 1 {
		return issue
	}
	return fmt.Sprintf("%s · %s: още %d до %s", issue, st.Chapter, st.Left, st.Rank)
}
