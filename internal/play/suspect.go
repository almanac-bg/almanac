package play

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Suspects are the questions whose players' answers say the key may be wrong: most players can be wrong, but when a
// wrong option draws more of them than the answer, or most say the opposite of a true-or-not, or most typed numbers
// fall to one side beyond the tolerance (a unit, a misprint), the question is worth checking from a source. Players'
// answers test every question the game deals, every day, at no cost: the bank's upkeep reads these
// (.claude/skills/fix-questions), with the players' reports and the questions due for review.

// Suspect is a question and what its players' answers say against its key.
type Suspect struct {
	ID      string
	Answers int
	Why     string
}

// SuspectOneSide is the share of a number's typed answers beyond the tolerance on one side that makes it a suspect.
const SuspectOneSide = 0.6

// SuspectTruth is the share right below which a true-or-not is a suspect: most players say the opposite.
const SuspectTruth = 0.35

// Suspects counts the crowds now and lists the suspects, the most answered first.
func (g *Game) Suspects(ctx context.Context) ([]Suspect, error) {
	b := g.Bank()
	by, err := g.crowds.refresh(ctx, g.Now(), b, g.countCrowds)
	if err != nil {
		return nil, err
	}
	var out []Suspect
	for id, c := range by {
		q, ok := b.Get(id)
		if !ok {
			continue
		}
		if why := suspect(q, c.c); why != "" {
			out = append(out, Suspect{id, c.c.Answers, why})
		}
	}
	slices.SortFunc(out, func(a, b Suspect) int {
		if a.Answers != b.Answers {
			return b.Answers - a.Answers
		}
		return strings.Compare(a.ID, b.ID)
	})
	return out, nil
}

// suspect says what in a crowd speaks against the key, or "".
func suspect(q bank.Question, c *bank.Crowd) string {
	pct := func(v float64) string { return fmt.Sprintf("%.0f%%", 100*v) }
	switch q := q.(type) {
	case *bank.Choice, *bank.Clues:
		if len(c.Picks) < 2 {
			return ""
		}
		wrong := wrongOptions(q)
		best := 1
		for i := 2; i < len(c.Picks); i++ {
			if c.Picks[i] > c.Picks[best] {
				best = i
			}
		}
		if c.Picks[best] > c.Picks[0] && best-1 < len(wrong) {
			return fmt.Sprintf("%s picked „%s“, %s the answer", pct(c.Picks[best]), strings.Trim(wrong[best-1], "„“"), pct(c.Picks[0]))
		}
	case *bank.TrueFalse:
		if c.Right < SuspectTruth {
			return fmt.Sprintf("%s right: most say it is %s", pct(c.Right), map[bool]string{true: "false", false: "true"}[q.Answer])
		}
	case *bank.Number:
		if g := c.Guesses; g != nil {
			if g.Below >= SuspectOneSide {
				return fmt.Sprintf("%s typed less than the tolerance allows (under %v)", pct(g.Below), g.Lo)
			}
			if g.Above >= SuspectOneSide {
				return fmt.Sprintf("%s typed more than the tolerance allows (over %v)", pct(g.Above), g.Hi)
			}
		}
	}
	return ""
}

func wrongOptions(q bank.Question) []string {
	switch q := q.(type) {
	case *bank.Choice:
		return q.Wrong
	case *bank.Clues:
		return q.Wrong
	}
	return nil
}
