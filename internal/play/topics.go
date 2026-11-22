package play

import (
	"slices"

	"github.com/almanac-bg/almanac/internal/bank"
)

// topicPool is what a game of a topic draws from: the topic's live questions, every topic's for MixTopic (a duel's).
func topicPool(b *bank.Bank, topic string) []bank.Question {
	if topic == MixTopic {
		return b.Live("", "")
	}
	return b.Live(topic, "")
}

// IsTopic is whether a topic's games can be played, as its page has them: one of the bank's.
func (g *Game) IsTopic(id string) bool {
	return slices.ContainsFunc(g.Bank().Categories, func(c bank.Category) bool { return c.ID == id })
}
