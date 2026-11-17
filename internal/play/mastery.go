package play

import (
	"context"
	"database/sql"
	"math"
	"slices"
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
// hardness as last counted, so it's always as good as the answers and the bank allow. Questions retired as untrue
// count for nothing.

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

// MasteryFirst is how many answers in a topic it takes for a first estimate of its mastery, told as a share of the
// topic and no more; MasteryFrom, before it's sure and told with its tier. A game of a topic is ten of its questions:
// one game makes a first estimate, three a mark that won't call a player „Експерт“ on a lucky draw of easy ones.
const (
	MasteryFirst = 10
	MasteryFrom  = 30
)

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
	// Sure is whether there are answers enough to tell (MasteryFrom): until then, Known and Tier are only a guess, and
	// the tier isn't told. First is whether there are enough for a first estimate (MasteryFirst) but not yet for that:
	// Known is told as one, without a tier.
	Sure  bool `json:"sure"`
	First bool `json:"first,omitempty"`
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
	m := Mastery{Category: category, Answers: a.answers, Known: known, Tier: t, Name: MasteryTiers[t].Name,
		Sure: a.answers >= MasteryFrom, First: a.answers >= MasteryFirst && a.answers < MasteryFrom}
	if t+1 < len(MasteryTiers) {
		m.Next, m.NextAt = MasteryTiers[t+1].Name, MasteryTiers[t+1].From
	}
	return m
}

// hardnesses are every question's hardness, and the live questions' by topic ("" for all of them), as the bank and
// the answers had them when they were counted.
type hardnesses struct {
	byID    map[string]float64
	byTopic map[string][]float64
}

// of is a question's hardness: as counted, or, for one the count didn't have (the bank changed since), what its label
// says.
func (h *hardnesses) of(q bank.Question) float64 {
	if v, ok := h.byID[q.Base().ID]; ok {
		return v
	}
	return hardnessOf(labelKnown[q.Base().Difficulty])
}

// hardness is how hard each question is: what its label says, and, the more answers it has, what they say (people's:
// FairAnswers; to it as it is now: versions.go). Answers change it slowly, and working it out goes over every answer
// anyone has given, so it's kept (snapshot.go) and counted again every hardnessFresh in the background: a game waits
// only for the server's first count.
func (g *Game) hardness(ctx context.Context) (*hardnesses, error) {
	return g.hard.get(ctx, g.Now(), g.Bank(), hardnessFresh, g.countHardness)
}

// countHardness works the hardnesses out from the answers, as of now, for a bank. A question retired as untrue
// (bank.Tail.Untrue) has none: its answers say nothing of anyone's knowledge (abilities leave them out).
func (g *Game) countHardness(ctx context.Context, now time.Time, b *bank.Bank) (*hardnesses, error) {
	type tally struct {
		counted Counted
		n       int
		sum     float64
	}
	answered := make(map[string]*tally, len(b.Questions))
	for _, q := range b.Questions {
		if !q.Extra().Untrue() {
			answered[q.Base().ID] = &tally{counted: g.CountedOf(q)}
		}
	}
	// Summed here, not by GROUP BY: SQLite would sort every answer by its question for it, or go through them in the
	// question's index and look each one's score up, both many times slower than reading them as they lie.
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT question_id, version, score, at FROM answers WHERE `+FairAnswers)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var id []byte
	var version sql.NullInt64
	var score float64
	var at int64
	for rows.Next() {
		if err := rows.Scan(&id, &version, &score, &at); err != nil {
			return nil, err
		}
		if t := answered[string(id)]; t != nil && t.counted.Counts(version, at) { // no copy of the id for a lookup
			t.n++
			t.sum += score
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	h := &hardnesses{byID: make(map[string]float64, len(b.Questions)), byTopic: map[string][]float64{}}
	for _, q := range b.Questions {
		head := q.Base()
		t := answered[head.ID]
		if t == nil {
			continue // untrue
		}
		known := labelKnown[head.Difficulty]
		if t.n > 0 {
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
	return h, nil
}

type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// abilities goes over a player's answers, oldest first, up to a time (ms; 0 for all of them): their ability in each
// topic, and over all of them. The answers to a question that turned out untrue (bank.Tail.Untrue: its key was wrong,
// or stopped being right) say nothing of what a player knows, and are left out.
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
		if !ok || q.Extra().Untrue() {
			continue // gone from the bank, or untrue
		}
		head := q.Base()
		a, ok := topics[head.Category]
		if !ok {
			a = newAbility()
		}
		hard := h.of(q)
		a.learn(score, hard, chanceOf(q))
		topics[head.Category] = a
		all.learn(score, hard, chanceOf(q))
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
