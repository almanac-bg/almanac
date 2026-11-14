package play

import (
	"context"
	"database/sql"
	"math"
	"slices"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Mastery is how well a player knows a topic: the share of its questions they'd know, and a tier for it, Новак to
// Светило. It's worked out from every answer they've given, each weighed by how hard its question is, so that
// harder questions drawn as a player gets better don't hold them back, and a lucky guess counts for little.
//
// The model: in each topic a player has an ability, and each question a hardness, on one scale. A player knows a
// question with the chance σ(ability − hardness), and gets it right with that chance and, of what's left, the luck of
// a guess (chance, by kind of question). Each answer moves the ability as far as it tells something: a hard question
// right, or an easy one wrong, moves it a lot; a guess at a true-or-not little. How sure the ability is grows with
// the answers, and fades a little with each one, so that what a player knows now counts more than what they knew a
// year ago. The same ability over all topics shapes a run of all of them, and a duel.
//
// Nothing is stored: a player's answers are gone over again whenever it's asked for, against the questions'
// hardness as it is now, so it's always as good as the answers and the bank allow.

// MasteryTier is a band of mastery with a name: a player is in it from From percent of a topic known.
type MasteryTier struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	From int    `json:"from"`
}

// MasteryTiers from the lowest up. A player who knows as much as most do is a Познавач: the bank's mix (half easy,
// a third medium, the rest hard) makes that about 60% of a topic. Майстор takes knowing nearly all the easy and
// medium questions and half the hard ones; Светило, nearly everything.
var MasteryTiers = []MasteryTier{
	{"novice", "Новак", 0},
	{"amateur", "Любител", 35},
	{"connoisseur", "Познавач", 50},
	{"expert", "Експерт", 65},
	{"master", "Майстор", 78},
	{"luminary", "Светило", 90},
}

// MasterTier is the tier the achievements for mastering a topic ask for.
const MasterTier = 4

// MasteryFrom is how many answers in a topic it takes before its mastery is told.
const MasteryFrom = 10

const (
	// priorVariance is how unsure a player's ability is before their first answer: as far apart as players are.
	priorVariance = 1.5
	// drift is how much less sure an ability gets with each answer, so that the latest fifty or so count the most.
	drift = 0.003
	// hardnessPrior is how many answers a question's label counts as, against what its own answers say.
	hardnessPrior = 20
	// hardnessFresh is how long the questions' hardness is kept before it's worked out from the answers again.
	hardnessFresh = 10 * time.Minute
	// aimRight is the share of right answers a topic run is shaped for: enough to enjoy, few enough to learn.
	aimRight = 0.65
)

// labelKnown is the share of players who know a question of each difficulty, as its label says: the middle of the
// difficulty's band (calibrate.go).
var labelKnown = map[bank.Difficulty]float64{bank.Easy: 0.8, bank.Medium: 0.5, bank.Hard: 0.2}

func sigmoid(x float64) float64 { return 1 / (1 + math.Exp(-x)) }

// hardnessOf is the hardness of a question that a share of players know.
func hardnessOf(known float64) float64 { return math.Log((1 - known) / known) }

// ability is how well a player knows a topic (or all of them): the estimate, how unsure it is, and how many answers
// it's from.
type ability struct {
	mean, variance float64
	answers        int
}

func newAbility() ability { return ability{variance: priorVariance} }

// learn moves an ability by an answer of a score (0–1) to a question of a hardness, where a guess gets luck.
func (a *ability) learn(score, hardness, luck float64) {
	a.variance += drift
	k := sigmoid(a.mean - hardness)
	p := min(max(luck+(1-luck)*k, 0.01), 0.99) // the chance of getting it right
	slope := (1 - luck) * k * (1 - k)          // how fast that chance grows with the ability
	spread := p * (1 - p)
	a.variance = 1 / (1/a.variance + slope*slope/spread)
	a.mean += max(-1, min(1, a.variance*slope*(score-p)/spread))
	a.answers++
}

// knownOf is the share of questions of these hardnesses a player of an ability knows.
func knownOf(ability float64, hardness []float64) float64 {
	if len(hardness) == 0 {
		return 0
	}
	sum := 0.0
	for _, h := range hardness {
		sum += sigmoid(ability - h)
	}
	return sum / float64(len(hardness))
}

// Mastery is how well a player knows a topic.
type Mastery struct {
	Category string `json:"category"`
	// Answers is how many of the player's answers it's from.
	Answers int `json:"answers"`
	// Known is the share of the topic's questions the player would know, in percent.
	Known int `json:"known"`
	// Tier is where Known is in MasteryTiers (0 the lowest), and Name its name.
	Tier int    `json:"tier"`
	Name string `json:"name"`
	// Next is the next tier's name, and NextAt the percent it starts at ("" and 0 at the top).
	Next   string `json:"next,omitempty"`
	NextAt int    `json:"nextAt,omitempty"`
	// Sure is whether there are answers enough to tell (MasteryFrom): until then, Known and Tier are only a guess.
	Sure bool `json:"sure"`
}

// TierOf is the tier a percent of a topic known is in.
func TierOf(known int) int {
	t := 0
	for i, x := range MasteryTiers {
		if known >= x.From {
			t = i
		}
	}
	return t
}

func masteryOf(category string, a ability, hardness []float64) Mastery {
	known := int(math.Round(100 * knownOf(a.mean, hardness)))
	t := TierOf(known)
	m := Mastery{Category: category, Answers: a.answers, Known: known, Tier: t, Name: MasteryTiers[t].Name, Sure: a.answers >= MasteryFrom}
	if t+1 < len(MasteryTiers) {
		m.Next, m.NextAt = MasteryTiers[t+1].Name, MasteryTiers[t+1].From
	}
	return m
}

// hardnesses are every question's hardness, and the live questions' by topic ("" for all of them), as the bank and
// the answers have them now.
type hardnesses struct {
	byID    map[string]float64
	byTopic map[string][]float64
}

// hardnessCache keeps the hardnesses for a while: answers change them slowly.
type hardnessCache struct {
	mu   sync.Mutex
	bank *bank.Bank
	at   time.Time
	h    *hardnesses
}

// hardness is how hard each question is: what its label says, and, the more answers it has, what they say.
func (g *Game) hardness(ctx context.Context) (*hardnesses, error) {
	c := &g.hard
	c.mu.Lock()
	defer c.mu.Unlock()
	b, now := g.Bank(), g.Now()
	if c.h != nil && c.bank == b && now.Sub(c.at) < hardnessFresh && !now.Before(c.at) {
		return c.h, nil
	}
	type tally struct {
		n   int
		sum float64
	}
	answered := map[string]tally{}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT question_id, count(*), sum(score) FROM answers GROUP BY question_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var t tally
		if err := rows.Scan(&id, &t.n, &t.sum); err != nil {
			return nil, err
		}
		answered[id] = t
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	h := &hardnesses{byID: make(map[string]float64, len(b.Questions)), byTopic: map[string][]float64{}}
	for _, q := range b.Questions {
		head := q.Base()
		known := labelKnown[head.Difficulty]
		if t := answered[head.ID]; t.n > 0 {
			luck := chanceOf(q)
			seen := min(max((t.sum/float64(t.n)-luck)/(1-luck), 0.02), 0.98) // above chance, as calibrate.go
			known = (float64(t.n)*seen + hardnessPrior*known) / float64(t.n+hardnessPrior)
		}
		h.byID[head.ID] = hardnessOf(known)
		if !q.Extra().Retired {
			h.byTopic[head.Category] = append(h.byTopic[head.Category], h.byID[head.ID])
			h.byTopic[""] = append(h.byTopic[""], h.byID[head.ID])
		}
	}
	c.bank, c.at, c.h = b, now, h
	return h, nil
}

type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// abilities goes over a player's answers, oldest first, up to a time (ms; 0 for all of them): their ability in each
// topic, and over all of them.
func (g *Game) abilities(ctx context.Context, db querier, h *hardnesses, userID, until int64) (map[string]ability, ability, error) {
	topics, all := map[string]ability{}, newAbility()
	rows, err := db.QueryContext(ctx, `SELECT a.question_id, a.score FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ?1 AND (?2 = 0 OR a.at <= ?2) ORDER BY a.at, a.run_id, a.n`, userID, until)
	if err != nil {
		return nil, all, err
	}
	defer rows.Close()
	b := g.Bank()
	for rows.Next() {
		var id string
		var score float64
		if err := rows.Scan(&id, &score); err != nil {
			return nil, all, err
		}
		q, ok := b.Get(id)
		if !ok {
			continue // gone from the bank
		}
		head := q.Base()
		a, ok := topics[head.Category]
		if !ok {
			a = newAbility()
		}
		a.learn(score, h.byID[id], chanceOf(q))
		topics[head.Category] = a
		all.learn(score, h.byID[id], chanceOf(q))
	}
	return topics, all, rows.Err()
}

// ability is a player's ability in a topic ("" for all of them).
func (g *Game) ability(ctx context.Context, db querier, userID int64, category string) (float64, error) {
	h, err := g.hardness(ctx)
	if err != nil {
		return 0, err
	}
	topics, all, err := g.abilities(ctx, db, h, userID, 0)
	if category == "" {
		return all.mean, err
	}
	a, ok := topics[category]
	if !ok {
		a = newAbility()
	}
	return a.mean, err
}

// MasteryOf is how well a player knows each topic, in the bank's order (those not played yet too).
func (g *Game) MasteryOf(ctx context.Context, userID int64) ([]Mastery, error) {
	h, err := g.hardness(ctx)
	if err != nil {
		return nil, err
	}
	topics, _, err := g.abilities(ctx, g.DB.Read, h, userID, 0)
	if err != nil {
		return nil, err
	}
	out := []Mastery{}
	for _, c := range g.Bank().Categories {
		a, ok := topics[c.ID]
		if !ok {
			a = newAbility()
		}
		out = append(out, masteryOf(c.ID, a, h.byTopic[c.ID]))
	}
	return out, nil
}

// MasteryMove is how a game moved a player's mastery of a topic.
type MasteryMove struct {
	From Mastery `json:"from"`
	To   Mastery `json:"to"`
}

// MasteryMoves is how a player's finished run moved their mastery of each topic it had, the furthest moved first:
// from just before its first answer to just after its last.
func (g *Game) MasteryMoves(ctx context.Context, userID, runID int64) ([]MasteryMove, error) {
	r, err := scanRun(g.DB.Read.QueryRowContext(ctx, `SELECT `+runColumns+` FROM runs WHERE id = ? AND user_id = ?`, runID, userID))
	if err != nil {
		return nil, err
	}
	if !r.finished {
		return nil, ErrOutOfStep
	}
	h, err := g.hardness(ctx)
	if err != nil {
		return nil, err
	}
	var first, last int64
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT coalesce(min(at), 0), coalesce(max(at), 0) FROM answers WHERE run_id = ?`, runID).
		Scan(&first, &last); err != nil || last == 0 {
		return []MasteryMove{}, err
	}
	before, _, err := g.abilities(ctx, g.DB.Read, h, userID, first-1)
	if err != nil {
		return nil, err
	}
	after, _, err := g.abilities(ctx, g.DB.Read, h, userID, last)
	if err != nil {
		return nil, err
	}
	b := g.Bank()
	out := []MasteryMove{}
	for _, c := range b.Categories {
		played := slices.ContainsFunc(r.picks, func(p Pick) bool {
			q, ok := b.Get(p.ID)
			return ok && q.Base().Category == c.ID
		})
		to, ok := after[c.ID]
		if !played || !ok || to.answers == before[c.ID].answers {
			continue // not in the run, or nothing answered of it
		}
		from, ok := before[c.ID]
		if !ok {
			from = newAbility()
		}
		out = append(out, MasteryMove{From: masteryOf(c.ID, from, h.byTopic[c.ID]), To: masteryOf(c.ID, to, h.byTopic[c.ID])})
	}
	moved := func(m MasteryMove) int { return max(m.To.Known-m.From.Known, m.From.Known-m.To.Known) }
	slices.SortStableFunc(out, func(a, b MasteryMove) int { return moved(b) - moved(a) })
	return out, nil
}

// topicSlots is a topic run's shape for a player's ability there: as many easy, medium and hard questions as make
// about aimRight of them right, easy to hard — easier for those still learning a topic, harder as they know it.
// There's always at least one easy and one hard question, and three medium (the order and the match are among them).
// One true-or-not, one order, one match, one split and one number, the rest choices.
func topicSlots(ability float64) []slot {
	right := map[bank.Difficulty]float64{}
	for d, known := range labelKnown {
		luck := chance["choice"]
		right[d] = luck + (1-luck)*sigmoid(ability-hardnessOf(known))
	}
	easy, medium, off := 0, 0, math.Inf(1)
	for e := 1; e <= 6; e++ {
		for m := 3; m <= 6 && e+m < Length; m++ {
			share := (float64(e)*right[bank.Easy] + float64(m)*right[bank.Medium] + float64(Length-e-m)*right[bank.Hard]) / Length
			if d := math.Abs(share - aimRight); d < off-1e-9 {
				easy, medium, off = e, m, d
			}
		}
	}
	slots := make([]slot, Length)
	for i := range slots {
		d := bank.Hard
		if i < easy {
			d = bank.Easy
		} else if i < easy+medium {
			d = bank.Medium
		}
		slots[i] = slot{difficulty: d, typ: "choice"}
	}
	slots[1].typ = "truefalse"
	slots[easy+medium/2].typ = "order"
	slots[easy+medium-1].typ = "match"
	slots[Length-1].typ = "number"
	// The split takes the last choice before the number: a topic still without splits plays a choice there.
	for i := Length - 2; i >= 0; i-- {
		if slots[i].typ == "choice" {
			slots[i].typ, slots[i].alt = "split", "choice"
			break
		}
	}
	return slots
}
