package play

import (
	"cmp"
	"context"
	"encoding/json"
	"math"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The boards of knowledge rank players by their mastery (mastery.go): the share of a topic's questions they'd know,
// or over all topics the share of all of them, by the ability their every answer makes, each weighed by how hard its
// question is and with luck taken out. Not by their share of right answers: a topic's games are drawn so that each
// player gets about two in three right (aimRight), so the share says which games someone plays, not how much they
// know. Only players whose mark is sure are on them, with enough answers there (KnowAll, KnowTopic; never fewer than
// MasteryFrom).
//
// Counted for each viewer, they'd go over every answer anyone has ever given, each time. So every player's answers
// are gone over once in a while for all of them (snapshot.go), in each topic and over all, in the background once
// there's a count to show meanwhile (over a bank reloaded too); and the viewer's own are gone over exactly whenever
// they look, and set in, so that a player who has just played sees their mastery and place as they are now.

// knowFresh is how long a count of everyone's answers stands before the next one: masteries over a hundred answers
// and more move slowly.
var knowFresh = 5 * time.Minute

// knowledge is a count of everyone's answers: in each topic ("" for all of them) the players with any answers there,
// best first.
type knowledge map[string][]known

// known is a player's mastery in a topic: of how many answers, and the share of its questions they'd know (0–1).
type known struct {
	id      int64
	answers int
	share   float64
	viewer  bool
}

// knownFrom is a player's mastery in a topic from their ability there, and the hardness of its questions.
func knownFrom(id int64, a ability, hardness []float64) known {
	return known{id: id, answers: a.answers, share: knownOf(a.mean, hardness)}
}

// percent is the share known in whole percent, as Mastery has it.
func (k known) percent() int { return int(math.Round(100 * k.share)) }

// ahead says whether a player is ahead of another on a board of knowledge: more known, then more answers, then the
// earlier player.
func (k known) ahead(o known) bool {
	if k.share != o.share {
		return k.share > o.share
	}
	if k.answers != o.answers {
		return k.answers > o.answers
	}
	return k.id < o.id
}

// KnowledgeBoard is the best mastery, over every topic ("") or in one, among those with a sure mark there (KnowAll,
// KnowTopic answers): who knows the most, whatever the speed. A time-out counts as wrong. Games played at a script's
// speed count for their player alone (fairFor): the count leaves them out, and the viewer's own, gone over exactly,
// has them.
func (g *Game) KnowledgeBoard(ctx context.Context, viewer int64, friends bool, topic string) (Ranking, error) {
	b := g.Bank()
	least := KnowAll
	if topic != "" {
		if !slices.ContainsFunc(b.Categories, func(c bank.Category) bool { return c.ID == topic }) {
			return Ranking{}, ErrNoTopic
		}
		least = KnowTopic
	}
	least = max(least, MasteryFrom)
	s, err := g.knowledge(ctx)
	if err != nil {
		return Ranking{}, err
	}
	everyone := s[topic]
	var mine known
	var among map[int64]bool
	if viewer != 0 {
		if mine, err = g.knownBy(ctx, viewer, topic); err != nil {
			return Ranking{}, err
		}
		if friends {
			if among, err = g.friendsOf(ctx, viewer); err != nil {
				return Ranking{}, err
			}
		}
	}
	list := make([]known, 0, min(len(everyone), 4*BoardSize))
	if mine.answers >= least {
		list = append(list, mine)
	}
	for _, k := range everyone {
		if k.answers >= least && k.id != viewer && (!friends || among[k.id]) {
			list = append(list, k)
		}
	}
	if len(list) > 0 && list[0].viewer { // set in where they belong
		at := 1
		for at < len(list) && list[at].ahead(mine) {
			at++
		}
		copy(list[:at-1], list[1:at])
		list[at-1] = mine
	}
	out := make([]ranked, 0, BoardSize+1)
	placed := mine.answers < least // the viewer isn't on it: nothing of theirs to find
	for i, k := range list {
		if i >= BoardSize && placed {
			break
		}
		if i < BoardSize || k.viewer {
			p := k.percent()
			out = append(out, ranked{id: k.id, place: i + 1, value: p, answers: k.answers, tier: MasteryTiers[TierOf(p)].Name})
		}
		placed = placed || k.viewer
	}
	return g.rankingOf(ctx, viewer, out, false)
}

// knownBy is a player's own mastery in a topic ("" for all), from every answer of theirs.
func (g *Game) knownBy(ctx context.Context, userID int64, topic string) (known, error) {
	h, err := g.hardness(ctx)
	if err != nil {
		return known{}, err
	}
	topics, all, err := g.abilities(ctx, g.DB.Read, h, userID, 0)
	if err != nil {
		return known{}, err
	}
	a := all
	if topic != "" {
		if a = topics[topic]; a.answers == 0 {
			a = newAbility()
		}
	}
	k := knownFrom(userID, a, h.byTopic[topic])
	k.viewer = true
	return k, nil
}

// friendsOf is a player's friends.
func (g *Game) friendsOf(ctx context.Context, userID int64) (map[int64]bool, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT friend_id FROM friends WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// knowledge is the last count of everyone's answers (snapshot.go): counted again in the background once it's knowFresh
// old, or the bank has changed, and waited for only before the server's first.
func (g *Game) knowledge(ctx context.Context) (knowledge, error) {
	return g.known.get(ctx, g.Now(), g.Bank(), knowFresh, g.countKnowledge)
}

// given is an answer as a count of knowledge goes over it: when, in which run and place (its order among a player's,
// as abilities has it), to which question, and its score.
type given struct {
	at, run int64
	n       int
	q       bank.Question
	score   float64
}

// countKnowledge goes over everyone's fair answers (not of a script's games; not to questions retired as untrue), as
// of now, for a bank: each player's in the order they gave them, into their mastery in each topic and over all, as
// abilities does for one. The runs come by player (INDEXED BY runs_user: in the index's order, nothing sorted), each
// run's answers after it (CROSS JOIN keeps that order: left to choose, SQLite goes through the answers by their
// question's index and looks each one's run up, thirty times slower), so one player's answers are held at a time, put
// in order here, and let go.
func (g *Game) countKnowledge(ctx context.Context, now time.Time, b *bank.Bank) (knowledge, error) {
	h, err := g.hardness(ctx)
	if err != nil {
		return nil, err
	}
	by := make(knowledge, len(b.Categories)+1)
	fold := func(user int64, list []given) {
		if len(list) == 0 {
			return
		}
		slices.SortFunc(list, func(x, y given) int {
			return cmp.Or(cmp.Compare(x.at, y.at), cmp.Compare(x.run, y.run), cmp.Compare(x.n, y.n))
		})
		topics, all := map[string]ability{}, newAbility()
		for _, a := range list {
			head := a.q.Base()
			hard, luck := h.of(a.q), chanceOf(a.q)
			t, ok := topics[head.Category]
			if !ok {
				t = newAbility()
			}
			t.learn(a.score, hard, luck)
			topics[head.Category] = t
			all.learn(a.score, hard, luck)
		}
		for topic, a := range topics {
			by[topic] = append(by[topic], knownFrom(user, a, h.byTopic[topic]))
		}
		by[""] = append(by[""], knownFrom(user, all, h.byTopic[""]))
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT r.user_id, r.id, a.n, a.at, a.question_id, a.score
		FROM runs r INDEXED BY runs_user CROSS JOIN answers a ON a.run_id = r.id WHERE NOT r.scripted`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var user, last int64 = 0, -1
	var list []given
	var id []byte
	for rows.Next() {
		var a given
		if err := rows.Scan(&user, &a.run, &a.n, &a.at, &id, &a.score); err != nil {
			return nil, err
		}
		if user != last {
			fold(last, list)
			list, last = list[:0], user
		}
		var found bool
		if a.q, found = b.Get(string(id)); found && !a.q.Extra().Untrue() { // gone from the bank, or untrue: not in a mastery
			list = append(list, a)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	fold(last, list)
	for _, list := range by {
		slices.SortFunc(list, func(a, b known) int {
			if a.ahead(b) {
				return -1
			}
			return 1
		})
	}
	return by, nil
}

// ranked is a player's place on a board, before their name and look are read: on a board of knowledge, with their
// mastery's tier.
type ranked struct {
	id                    int64
	place, value, answers int
	tier                  string
}

// rankingOf reads who the players on a board are (names and looks) and makes it the board: the best (BoardSize, in
// order), and the viewer's place if they're on it.
func (g *Game) rankingOf(ctx context.Context, viewer int64, list []ranked, divisions bool) (Ranking, error) {
	out := Ranking{Top: []Ranked{}}
	if len(list) == 0 {
		return out, nil
	}
	ids := make([]int64, len(list))
	for i, r := range list {
		ids[i] = r.id
	}
	raw, _ := json.Marshal(ids)
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.id, u.name, u.tag, `+lookColumns+`
		FROM users u WHERE u.id IN (SELECT value FROM json_each(?))`, string(raw))
	if err != nil {
		return out, err
	}
	defer rows.Close()
	who := make(map[int64]Ranked, len(list))
	for rows.Next() {
		var id int64
		var r Ranked
		var avatar, title string
		var xp int
		if err := rows.Scan(&id, &r.Name, &r.Tag, &avatar, &title, &xp); err != nil {
			return out, err
		}
		r.Look = g.lookOf(id, avatar, title, xp)
		who[id] = r
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	for _, x := range list {
		r, ok := who[x.id]
		if !ok { // gone since it was counted
			continue
		}
		r.Value, r.Answers, r.Tier, r.Me = x.value, x.answers, x.tier, x.id == viewer
		if divisions {
			d, _ := DivisionOf(r.Value)
			r.Division = &d
		}
		if r.Me {
			out.Place, out.Mine = x.place, &r
		}
		if x.place <= BoardSize {
			out.Top = append(out.Top, r)
		}
	}
	return out, nil
}
