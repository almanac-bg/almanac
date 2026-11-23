package bank

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Related: the questions a person must read beside a question to see that it is new. One question gives another away,
// or tells the same thing, in words no rule can match: a fact that says „Франция помага на американците“ answers a
// true-or-not that France fought on Britain's side; a fact about Amelia Earhart „пет години след Чарлз Линдберг“ answers
// who flew the Atlantic first. A checker who greps the bank for a few words finds some of them; the audit of a sample
// of the bank (24 Nov 2026) found two in three of its faults were these. So the checkers read, for each question, the
// questions most like it, ranked here: every word a player sees of it (its text, options, items, pairs, clues, fact and
// day's line), as stems, each shared stem weighing by how rare it is (inverse document frequency; a stem in more than
// RelatedCommon questions says nothing of a subject and counts for nothing). Tried on the faults the audit found: the
// question that gave one away was among its ten most related in three cases of four.

// RelatedCommon is how many questions a stem may be in and still bring two together.
const RelatedCommon = 300

// Neighbour is a question related to another: how much they share, and what.
type Neighbour struct {
	ID     string   `json:"id"`
	Score  float64  `json:"score"`
	Shared []string `json:"shared"`
}

// seen is every word a player sees of a question, the fact and the day's line too.
func seen(q Question) string {
	return strings.Join(append(q.words(), q.Extra().Fact, q.Extra().Day), " ")
}

// Related is, for each of the questions ids names (every live one, for none), the n live questions most related to it,
// the most related first.
func (b *Bank) Related(ids []string, n int) (map[string][]Neighbour, error) {
	var live []Question
	for _, q := range b.Questions {
		if !q.Extra().Retired {
			live = append(live, q)
		}
	}
	sets := make([]map[string]bool, len(live))
	df := map[string]int{}
	at := map[string]int{}
	for i, q := range live {
		sets[i] = stemSet(seen(q))
		for s := range sets[i] {
			df[s]++
		}
		at[q.Base().ID] = i
	}
	posting := map[string][]int{}
	for i, set := range sets {
		for s := range set {
			if df[s] <= RelatedCommon {
				posting[s] = append(posting[s], i)
			}
		}
	}
	all := float64(len(live))
	if len(ids) == 0 {
		for _, q := range live {
			ids = append(ids, q.Base().ID)
		}
	}
	out := map[string][]Neighbour{}
	for _, id := range ids {
		i, ok := at[id]
		if !ok {
			return nil, fmt.Errorf("%s: no live question of that id", id)
		}
		score := map[int]float64{}
		shared := map[int][]string{}
		for s := range sets[i] {
			if df[s] > RelatedCommon {
				continue
			}
			w := math.Log((all + 1) / float64(df[s]+1))
			for _, j := range posting[s] {
				if j != i {
					score[j] += w
					shared[j] = append(shared[j], s)
				}
			}
		}
		var ns []Neighbour
		for j, sc := range score {
			slices.Sort(shared[j])
			ns = append(ns, Neighbour{ID: live[j].Base().ID, Score: math.Round(sc*10) / 10, Shared: shared[j]})
		}
		slices.SortFunc(ns, func(a, b Neighbour) int {
			if a.Score != b.Score {
				if a.Score > b.Score {
					return -1
				}
				return 1
			}
			return strings.Compare(a.ID, b.ID)
		})
		out[id] = ns[:min(n, len(ns))]
	}
	return out, nil
}

// WithBatch is the bank as a batch (bank add's from) would leave it, for reading only: its questions in place of the
// bank's of the same id, its new ones at the end, its retirements left as they are; and the ids of its questions. It
// checks nothing: bank add does.
func (b *Bank) WithBatch(from string) (*Bank, []string, error) {
	qs := slices.Clone(b.Questions)
	var ids []string
	for _, c := range b.Categories {
		data, err := os.ReadFile(filepath.Join(from, c.ID+".json"))
		if errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return nil, nil, err
		}
		var bad []string
		items, err := decodeFile(data, c.ID, func(line int, id, msg string) {
			bad = append(bad, fmt.Sprintf("%s.json:%d: %s: %s", c.ID, line, id, msg))
		})
		if err == nil && len(bad) > 0 {
			err = errors.New(strings.Join(bad, "; "))
		}
		if err != nil {
			return nil, nil, fmt.Errorf("%s.json: %w", c.ID, err)
		}
		for _, item := range items {
			q := item.q
			q.Base().Category = c.ID
			id := q.Base().ID
			ids = append(ids, id)
			if i := slices.IndexFunc(qs, func(o Question) bool { return o.Base().ID == id }); i >= 0 {
				qs[i] = q
			} else {
				qs = append(qs, q)
			}
		}
	}
	return Of(b.Categories, qs), ids, nil
}
