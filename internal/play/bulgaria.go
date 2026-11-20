package play

import (
	"slices"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The topic „България“: the questions about Bulgaria (bank.Tail.BG) from every topic, as a topic of its own beside
// the bank's. They are the ones a player here is proudest to know and the one thing a quiz from elsewhere can't give,
// and in the topics they are scattered ten ways. It plays as a topic does (StartTopic, Draw) and is kept as one
// (runs.category = BulgariaTopic), with two differences:
//
//   - it has no mastery of its own: each of its questions counts toward its own topic's (mastery.go reads a question's
//     topic from the bank), and its games are shaped by how well the player knows all the topics, as „Микс“'s are
//     (MixTopic); a mastery of it would count every Bulgarian answer twice, and a title for it would be a second title
//     for the same answers;
//   - it is open only while the bank has a game's worth of Bulgarian questions that no day holds (BulgariaOpen): the
//     days take at least BGFloor each, so it opens once the bank has more than the days ahead spend.

// BulgariaTopic is the topic of Bulgaria's questions from every topic.
const BulgariaTopic = "bulgaria"

// topicPool is what a topic's games draw from: the topic's live questions, every topic's for MixTopic, and for
// BulgariaTopic the live questions about Bulgaria from every topic.
func topicPool(b *bank.Bank, topic string) []bank.Question {
	switch topic {
	case MixTopic:
		return b.Live("", "")
	case BulgariaTopic:
		var out []bank.Question
		for _, q := range b.Live("", "") {
			if q.Extra().BG {
				out = append(out, q)
			}
		}
		return out
	}
	return b.Live(topic, "")
}

// bulgariaLeft is how many live questions about Bulgaria no day holds (barred: the days', nil for none).
func bulgariaLeft(b *bank.Bank, barred map[string]bool) int {
	n := 0
	for _, q := range b.Questions {
		if t := q.Extra(); t.BG && !t.Retired && !barred[q.Base().ID] {
			n++
		}
	}
	return n
}

// BulgariaOpen is whether the topic „България“ has a game's worth of questions no day holds: its tile shows only then.
// Until the days are drawn for this day and bank (KeepDays, within a minute of a new day or bank), it counts them all.
func (g *Game) BulgariaOpen() bool {
	b := g.Bank()
	g.daysAhead.mu.Lock()
	var barred map[string]bool
	if g.daysAhead.day == g.Today() && g.daysAhead.bank == b {
		barred = g.daysAhead.bars.all
	}
	g.daysAhead.mu.Unlock()
	return bulgariaLeft(b, barred) >= Length
}

// IsTopic is whether a topic's games can be played, as its page has them: one of the bank's, „Микс“, or „България“
// while it's open (BulgariaOpen).
func (g *Game) IsTopic(id string) bool {
	switch id {
	case MixTopic:
		return true
	case BulgariaTopic:
		return g.BulgariaOpen()
	}
	return slices.ContainsFunc(g.Bank().Categories, func(c bank.Category) bool { return c.ID == id })
}
