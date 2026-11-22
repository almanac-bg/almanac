package play

import (
	"context"
	"database/sql"
	"math"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Mastery is how well a player knows a topic: the game's own, never shown (DECISIONS.md, „The direction“: a player
// sees their ink and their ranks). It shapes their chapter games (topicSlots: aimRight of them right) and their duels,
// and chooses the recording they play against, the nearest to them (recordingFit). It's worked out from every
// answer they've given, each weighed by how hard its question is, so that harder questions drawn as a player gets
// better don't hold them back, and a lucky guess counts for little.
//
// The model: in each topic a player has an ability, and each question a hardness, on one scale. A player knows a
// question with the chance σ(ability − hardness), and gets it right with that chance and, of what's left, the luck of
// a guess (rightChance, by kind of question). Each answer moves the ability as far as it tells something: a hard question
// right, or an easy one wrong, moves it a lot; a guess at a true-or-not little. How sure the ability is grows with
// the answers, and fades a little with each one, so that what a player knows now counts more than what they knew a
// year ago. The same ability over all topics shapes a run of all of them, and a duel.
//
// Nothing is stored: a player's answers are gone over again whenever it's asked for and they've moved since (memo.go:
// kept in memory while they stand), against the questions' hardness as last counted, so it's always as good as the
// answers and the bank allow. Questions retired as untrue
// count for nothing.

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

// learn moves an ability by an answer, right or not, to a question of a hardness, where a guess is right with the
// chance luck. A close number is not right, here as everywhere.
func (a *ability) learn(right bool, hardness, luck float64) {
	score := 0.0
	if right {
		score = 1
	}
	a.variance += drift
	k := sigmoid(a.mean - hardness)
	p := min(max(luck+(1-luck)*k, 0.01), 0.99) // the chance of getting it right
	slope := (1 - luck) * k * (1 - k)          // how fast that chance grows with the ability
	spread := p * (1 - p)
	a.variance = 1 / (1/a.variance + slope*slope/spread)
	a.mean += max(-1, min(1, a.variance*slope*(score-p)/spread))
	a.answers++
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
// only for the first count of a server that has none kept.
func (g *Game) hardness(ctx context.Context) (*hardnesses, error) {
	return g.hard.get(ctx, g.Now(), g.Bank(), g.hardCounter())
}

// hardCounter counts the hardness, and keeps of it each question's (the topics' lists are the bank's to make).
func (g *Game) hardCounter() counter[*hardnesses] {
	return counter[*hardnesses]{db: g.DB, name: "hardness", fresh: hardnessFresh, count: g.countHardness,
		keep: func(h *hardnesses) ([]byte, error) { return gobbed(h.byID) },
		take: func(raw []byte, b *bank.Bank) (*hardnesses, error) {
			byID, err := ungobbed[map[string]float64](raw)
			if err != nil {
				return nil, err
			}
			return hardnessFor(b, byID), nil
		}}
}

// countHardness works the hardnesses out from the answers, as of now, for a bank. A question retired as untrue
// (bank.Tail.Untrue) has none: its answers say nothing of anyone's knowledge (abilities leave them out).
func (g *Game) countHardness(ctx context.Context, now time.Time, b *bank.Bank) (*hardnesses, error) {
	type tally struct {
		counted Counted
		n       int
		right   int
	}
	answered := make(map[string]*tally, len(b.Questions))
	for _, q := range b.Questions {
		if !q.Extra().Untrue() {
			answered[q.Base().ID] = &tally{counted: g.CountedOf(q)}
		}
	}
	// Summed here, not by GROUP BY: SQLite would sort every answer by its question for it, or go through them in the
	// question's index and look each one's answer up, both many times slower than reading them as they lie.
	rows, err := g.DB.Scan.QueryContext(ctx, `SELECT question_id, version, is_right, at FROM answers WHERE `+FairAnswers)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var id []byte
	var version sql.NullInt64
	var right bool
	var at int64
	for rows.Next() {
		if err := rows.Scan(&id, &version, &right, &at); err != nil {
			return nil, err
		}
		if t := answered[string(id)]; t != nil && t.counted.Counts(version, at) { // no copy of the id for a lookup
			t.n++
			if right {
				t.right++
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	byID := make(map[string]float64, len(b.Questions))
	for _, q := range b.Questions {
		head := q.Base()
		t := answered[head.ID]
		if t == nil {
			continue // untrue
		}
		known := labelKnown[head.Difficulty]
		if t.n > 0 {
			luck := rightChance[head.Type]
			seen := min(max((float64(t.right)/float64(t.n)-luck)/(1-luck), 0.02), 0.98) // above chance, as calibrate.go
			known = (float64(t.n)*seen + hardnessPrior*known) / float64(t.n+hardnessPrior)
		}
		byID[head.ID] = hardnessOf(known)
	}
	return hardnessFor(b, byID), nil
}

// hardnessFor is the hardness of each question as counted (byID), with the live questions' of a bank by topic: those
// the count didn't have (the bank changed since) by their label.
func hardnessFor(b *bank.Bank, byID map[string]float64) *hardnesses {
	h := &hardnesses{byID: byID, byTopic: map[string][]float64{}}
	for _, q := range b.Questions {
		if q.Extra().Untrue() || q.Extra().Retired {
			continue
		}
		head, v := q.Base(), h.of(q)
		h.byTopic[head.Category] = append(h.byTopic[head.Category], v)
		h.byTopic[""] = append(h.byTopic[""], v)
	}
	return h
}

type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// abilities goes over a player's answers, oldest first, up to a time (ms; 0 for all of them): their ability in each
// topic, and over all of them. The answers to a question that turned out untrue (bank.Tail.Untrue: its key was wrong,
// or stopped being right) say nothing of what a player knows, and are left out. Finished says: only those of the games
// they finished (what others see of them, ProfileOf: never a game under way, answer by answer).
// All of them, read on the read pool, are kept for the player's games as they stand (memo.go): a profile, the book's
// chapters, a game's result and a duel's draw each ask for them, and they move only as the player plays.
func (g *Game) abilities(ctx context.Context, db querier, h *hardnesses, userID, until int64, finished bool) (map[string]ability, ability, error) {
	b := g.Bank()
	if until != 0 || db != g.DB.Read {
		return g.goOver(ctx, db, h, b, userID, until, finished)
	}
	v, err := memoized(ctx, g, &g.skills, skillsKey{userID, finished}, userID, b, h, func() (skills, error) {
		topics, all, err := g.goOver(ctx, db, h, b, userID, 0, finished)
		return skills{topics, all}, err
	})
	return v.topics, v.all, err
}

// skills are a player's abilities, kept (memo.go): their games' (finished: those they finished only).
type skills struct {
	topics map[string]ability
	all    ability
}

type skillsKey struct {
	user     int64
	finished bool
}

// goOver goes over a player's answers (abilities), for a bank.
func (g *Game) goOver(ctx context.Context, db querier, h *hardnesses, b *bank.Bank, userID, until int64, finished bool) (map[string]ability, ability, error) {
	topics, all := map[string]ability{}, newAbility()
	rows, err := db.QueryContext(ctx, `SELECT a.question_id, a.is_right FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ?1 AND (?2 = 0 OR a.at <= ?2) AND (NOT ?3 OR r.finished_at IS NOT NULL)
		ORDER BY a.at, a.run_id, a.n`, userID, until, finished)
	if err != nil {
		return nil, all, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var right bool
		if err := rows.Scan(&id, &right); err != nil {
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
		luck := rightChance[head.Type]
		a.learn(right, hard, luck)
		topics[head.Category] = a
		all.learn(right, hard, luck)
	}
	return topics, all, rows.Err()
}

// ability is a player's ability in a topic ("" for all of them).
func (g *Game) ability(ctx context.Context, db querier, userID int64, category string) (float64, error) {
	h, err := g.hardness(ctx)
	if err != nil {
		return 0, err
	}
	topics, all, err := g.abilities(ctx, db, h, userID, 0, false)
	if category == "" {
		return all.mean, err
	}
	a, ok := topics[category]
	if !ok {
		a = newAbility()
	}
	return a.mean, err
}

// recordingFit is how far a recording (its picks, its right answers) is from a player: lower fits better
// (recordedRun).
type recordingFit func(b *bank.Bank, picks []Pick, rights int) (off float64)

// expectedRights is how many of these questions a player of an ability over all topics would get right: each known
// with the chance σ(ability − hardness), and, of the rest, guessed right as often as a guess of its kind is.
func expectedRights(b *bank.Bank, h *hardnesses, ability float64, picks []Pick) float64 {
	sum := 0.0
	for _, p := range picks {
		q, ok := b.Get(p.ID)
		if !ok {
			continue
		}
		luck := rightChance[q.Base().Type]
		sum += luck + (1-luck)*sigmoid(ability-h.of(q))
	}
	return sum
}

// recordingFit is the fit of a recording to a player, by their hidden ability over all topics: how far its right
// answers are from what the player would get on its ten.
func (g *Game) recordingFit(ctx context.Context, userID int64) (recordingFit, error) {
	h, err := g.hardness(ctx)
	if err != nil {
		return nil, err
	}
	ability, err := g.ability(ctx, g.DB.Read, userID, "")
	if err != nil {
		return nil, err
	}
	return func(b *bank.Bank, picks []Pick, rights int) float64 {
		return math.Abs(float64(rights) - expectedRights(b, h, ability, picks))
	}, nil
}

// topicSlots is a topic run's shape for a player's ability there: as many easy, medium and hard questions as make
// about aimRight of them right, easy to hard — easier for those still learning a topic, harder as they know it.
// There's always at least one easy and one hard question, and three medium (the order and the match are among them).
// One true-or-not, one order, one match, one split and one number, the rest choices.
func topicSlots(ability float64) []slot {
	right := map[bank.Difficulty]float64{}
	for d, known := range labelKnown {
		luck := rightChance["choice"]
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
