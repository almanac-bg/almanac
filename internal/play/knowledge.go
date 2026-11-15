package play

import (
	"context"
	"encoding/json"
	"log/slog"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The boards of knowledge rank players by their share of right answers, over every answer they've given: counted for
// each viewer, they'd go over every answer anyone has ever given, each time. So every player's answers are counted
// once in a while for all of them (knowCache), in each topic and over all, in the background once there's a count to
// show meanwhile; and the viewer's own are counted exactly whenever they look, and set in, so that a player who has
// just played sees their share and place as they are now.

// knowFresh is how long a count of everyone's answers stands before the next one: shares over a hundred answers and
// more move slowly.
var knowFresh = 5 * time.Minute

// knowCache keeps the last count of everyone's answers.
type knowCache struct {
	counting sync.Mutex // held while a count runs
	snap     atomic.Pointer[knowSnap]
}

// knowSnap is a count of everyone's answers: when, of which bank, and in each topic ("" for all of them) the players
// with any answers there, best first.
type knowSnap struct {
	at   time.Time
	bank *bank.Bank
	by   map[string][]known
}

// known is a player's answers in a topic: how many, and how many right.
type known struct {
	id     int64
	n, ok  int
	viewer bool
}

// ahead says whether a player is ahead of another on a board of knowledge: a bigger share right, then more answers,
// then the earlier player.
func (k known) ahead(o known) bool {
	if l, r := int64(k.ok)*int64(o.n), int64(o.ok)*int64(k.n); l != r {
		return l > r
	}
	if k.n != o.n {
		return k.n > o.n
	}
	return k.id < o.id
}

// KnowledgeBoard is the best share of right answers, over every topic ("") or in one, among those with enough
// answers there (KnowAll, KnowTopic): who knows the most, whatever the speed. A time-out counts as wrong. Games played
// at a script's speed count for their player alone (fairFor): the count leaves them out, and the viewer's own,
// counted exactly, has them.
func (g *Game) KnowledgeBoard(ctx context.Context, viewer int64, friends bool, topic string) (Ranking, error) {
	b := g.Bank()
	least := KnowAll
	if topic != "" {
		if !slices.ContainsFunc(b.Categories, func(c bank.Category) bool { return c.ID == topic }) {
			return Ranking{}, ErrNoTopic
		}
		least = KnowTopic
	}
	s, err := g.knowledge(ctx)
	if err != nil {
		return Ranking{}, err
	}
	everyone := s.by[topic]
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
	if mine.n >= least {
		list = append(list, mine)
	}
	for _, k := range everyone {
		if k.n >= least && k.id != viewer && (!friends || among[k.id]) {
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
	placed := mine.n < least // the viewer isn't on it: nothing of theirs to find
	for i, k := range list {
		if i >= BoardSize && placed {
			break
		}
		if i < BoardSize || k.viewer {
			// The share in whole percent, rounded half up.
			out = append(out, ranked{id: k.id, place: i + 1, value: (200*k.ok + k.n) / (2 * k.n), answers: k.n})
		}
		placed = placed || k.viewer
	}
	return g.rankingOf(ctx, viewer, out, false)
}

// knownBy counts a player's own answers in a topic ("" for all), every one of theirs.
func (g *Game) knownBy(ctx context.Context, userID int64, topic string) (known, error) {
	k := known{id: userID, viewer: true}
	b := g.Bank()
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id, a.is_right FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ?`, userID)
	if err != nil {
		return k, err
	}
	defer rows.Close()
	var id []byte
	var right bool
	for rows.Next() {
		if err := rows.Scan(&id, &right); err != nil {
			return k, err
		}
		if topic != "" {
			if q, ok := b.Get(string(id)); !ok || q.Base().Category != topic {
				continue
			}
		}
		k.n++
		if right {
			k.ok++
		}
	}
	return k, rows.Err()
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

// knowledge is the last count of everyone's answers: counted again in the background once it's knowFresh old, and
// waited for only when there's none of this bank yet.
func (g *Game) knowledge(ctx context.Context) (*knowSnap, error) {
	c := &g.known
	b, now := g.Bank(), g.Now()
	s := c.snap.Load()
	if s != nil && s.bank == b {
		if (now.Sub(s.at) >= knowFresh || now.Before(s.at)) && c.counting.TryLock() {
			go func() {
				defer c.counting.Unlock()
				ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Minute)
				defer cancel()
				if err := g.countKnowledge(ctx, now, b); err != nil {
					slog.Warn("counting the boards of knowledge", "err", err)
				}
			}()
		}
		return s, nil
	}
	c.counting.Lock()
	defer c.counting.Unlock()
	if s := c.snap.Load(); s != nil && s.bank == b { // counted while this one waited
		return s, nil
	}
	if err := g.countKnowledge(ctx, now, b); err != nil {
		return nil, err
	}
	return c.snap.Load(), nil
}

// countKnowledge counts everyone's fair answers (not of a script's games), as of now, for a bank. Summed here, as
// they lie, not by GROUP BY: SQLite would sort them all for it, many times slower. Each run's answers are read after
// it (CROSS JOIN keeps that order): left to choose, SQLite goes through the answers by their question's index and
// looks each one's run up, thirty times slower.
func (g *Game) countKnowledge(ctx context.Context, now time.Time, b *bank.Bank) error {
	topics := map[string]int{} // a topic's place in a player's tallies; 0 is all of them
	for i, c := range b.Categories {
		topics[c.ID] = i + 1
	}
	tallies := map[int64][]known{}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT r.user_id, a.question_id, a.is_right FROM runs r
		CROSS JOIN answers a ON a.run_id = r.id WHERE NOT r.scripted`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var user int64
	var id []byte
	var right bool
	for rows.Next() {
		if err := rows.Scan(&user, &id, &right); err != nil {
			return err
		}
		t := tallies[user]
		if t == nil {
			t = make([]known, len(b.Categories)+1)
			tallies[user] = t
		}
		ok := 0
		if right {
			ok = 1
		}
		t[0].n, t[0].ok = t[0].n+1, t[0].ok+ok
		if q, found := b.Get(string(id)); found {
			if i := topics[q.Base().Category]; i > 0 {
				t[i].n, t[i].ok = t[i].n+1, t[i].ok+ok
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	by := make(map[string][]known, len(b.Categories)+1)
	for user, t := range tallies {
		for topic, i := range topics {
			if t[i].n > 0 {
				by[topic] = append(by[topic], known{id: user, n: t[i].n, ok: t[i].ok})
			}
		}
		by[""] = append(by[""], known{id: user, n: t[0].n, ok: t[0].ok})
	}
	for _, list := range by {
		slices.SortFunc(list, func(a, b known) int {
			if a.ahead(b) {
				return -1
			}
			return 1
		})
	}
	g.known.snap.Store(&knowSnap{at: now, bank: b, by: by})
	return nil
}

// ranked is a player's place on a board, before their name and look are read.
type ranked struct {
	id                    int64
	place, value, answers int
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
		r.Value, r.Answers, r.Me = x.value, x.answers, x.id == viewer
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
