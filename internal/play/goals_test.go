package play

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"
)

// setGoals gives a player their goals for today, as if drawn.
func (w *world) setGoals(user int64, ids ...string) {
	w.t.Helper()
	for n, id := range ids {
		if _, err := w.db.Write.Exec(`INSERT INTO day_goals (user_id, day, n, goal) VALUES (?, ?, ?, ?)`,
			user, w.g.Today(), n, id); err != nil {
			w.t.Fatal(err)
		}
	}
}

// goalsOf are a player's goals for today, by id.
func (w *world) goalsOf(user int64) map[string]DayGoal {
	w.t.Helper()
	goals, err := w.g.GoalsOf(w.t.Context(), user)
	if err != nil {
		w.t.Fatal(err)
	}
	out := map[string]DayGoal{}
	for _, d := range goals {
		out[d.ID] = d
	}
	return out
}

func TestGoalDraws(t *testing.T) {
	w := setup(t)
	seen := map[string]bool{}
	for seed := range uint64(3000) {
		friends := seed%2 == 0
		yesterday := drawGoals(seed+1_000_000, w.b, friends, nil)
		ids := drawGoals(seed, w.b, friends, yesterday)
		if len(ids) != GoalsPerDay || ids[0] != "day" || !slices.Equal(ids, drawGoals(seed, w.b, friends, yesterday)) {
			t.Fatalf("seed %d: %v", seed, ids)
		}
		before := map[string]bool{}
		for _, id := range yesterday[1:] {
			_, k, _, _ := goalOf(w.b, id)
			before[k.family] = true
		}
		families := map[string]bool{}
		for n, id := range ids[1:] {
			goal, k, _, ok := goalOf(w.b, id)
			switch {
			case !ok || k.tier != n+1 || strings.Contains(goal.Name, "{}") || strings.Contains(goal.Href, "{}"):
				t.Fatalf("seed %d: goal %q is %+v (tier %d)", seed, id, goal, k.tier)
			case families[k.family] || before[k.family]:
				t.Fatalf("seed %d: %v after %v, a family twice", seed, ids, yesterday)
			case k.friends && !friends:
				t.Fatalf("seed %d: %q for a player without friends", seed, id)
			}
			families[k.family] = true
			seen[k.id] = true
		}
	}
	for _, k := range goalKinds[1:] {
		if !seen[k.id] {
			t.Errorf("never drawn: %s", k.id)
		}
	}
	// A goal about something gone (a topic out of the bank, a kind no more) is no goal: it's left out, not shown blank.
	for _, id := range []string{"topic:nothing", "topic", "duel:x", "xp400"} {
		if _, _, _, ok := goalOf(w.b, id); ok {
			t.Errorf("%q is a goal", id)
		}
	}
}

func TestGoals(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	goals, err := w.g.GoalsOf(ctx, ana)
	if err != nil || len(goals) != GoalsPerDay || goals[0].ID != "day" || goals[0].Done {
		t.Fatalf("a new player's goals: %+v %v", goals, err)
	}
	for i, d := range goals {
		if d.XP != GoalXP[i] || d.Progress != 0 {
			t.Fatalf("goal %d: %+v", i, d)
		}
	}
	// Kept as drawn all day, even once a friend is made (who could change the draw).
	vi := w.user()
	w.befriend(ana, vi)
	w.wait(time.Hour)
	if again, _ := w.g.GoalsOf(ctx, ana); again[1].ID != goals[1].ID || again[2].ID != goals[2].ID {
		t.Fatal("the day's goals changed within the day")
	}

	// The day's questions: that goal is done without looking, its XP is the player's, and it's told once.
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	var games int
	_ = w.db.Read.QueryRow(`SELECT sum(xp) FROM runs WHERE user_id = ?`, ana).Scan(&games)
	n, err := w.g.NewsOf(ctx, ana, 0)
	sum := 0
	for _, d := range n.Goals {
		sum += d.XP
	}
	for _, a := range n.Achievements {
		sum += a.XP
	}
	if err != nil || !slices.Contains(n.Goals, DoneGoal{Name: "Изиграй въпросите на деня", XP: GoalXP[0]}) ||
		n.XP != games+sum {
		t.Fatalf("the news of a goal: %+v %v (games' XP %d)", n, err, games)
	}
	if again, _ := w.g.NewsOf(ctx, ana, 0); len(again.Goals) != 0 || again.XP != n.XP {
		t.Fatalf("a goal told twice: %+v", again)
	}
	if look, _ := w.g.LookOf(ctx, ana); look.Level != n.Level {
		t.Fatalf("the level others see: %d, not %d", look.Level, n.Level)
	}

	// The next day's are of other families; only the last two days are kept.
	families := map[string]bool{}
	for _, d := range goals[1:] {
		_, k, _, _ := goalOf(w.b, d.ID)
		families[k.family] = true
	}
	w.wait(24 * time.Hour)
	for _, d := range w.goalsOf(ana) {
		if _, k, _, _ := goalOf(w.b, d.ID); families[k.family] || d.Done {
			t.Fatalf("the next day's goal %+v, after %v", d, goals)
		}
	}
	w.wait(24 * time.Hour)
	w.goalsOf(ana)
	var kept int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM day_goals WHERE user_id = ?`, ana).Scan(&kept)
	if kept != 2*GoalsPerDay {
		t.Fatalf("%d goals kept", kept)
	}
}

func TestGoalMeasures(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	cat := w.b.Categories[2]

	// A topic's game, all right: right answers in that topic, and a game without a mistake.
	ana := w.user()
	w.setGoals(ana, "day", "know:"+cat.ID, "perfect")
	s, _ := w.g.StartTopic(ctx, ana, cat.ID)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	g := w.goalsOf(ana)
	if d := g["know:"+cat.ID]; !d.Done || d.Progress != 5 || d.Name != "Отговори вярно на 5 въпроса по тема „"+cat.Name+"“" ||
		d.Href != "/play/"+cat.ID || !g["perfect"].Done || g["day"].Done {
		t.Fatalf("after a perfect topic: %+v", g)
	}

	// A row is counted within one game, from the last mistake; a game by topic counts for that topic.
	vi := w.user()
	w.setGoals(vi, "day", "row5", "topics3")
	s, _ = w.g.StartTopic(ctx, vi, cat.ID)
	w.play(vi, s.ID, w.right, w.right, w.right, w.right, w.wrong, w.right, w.right, w.right, w.right, w.wrong)
	if g := w.goalsOf(vi); g["row5"].Progress != 4 || g["topics3"].Progress != 1 {
		t.Fatalf("a row of four: %+v", g)
	}
	s, _ = w.g.StartTopic(ctx, vi, "") // all topics: no topic of its own
	w.play(vi, s.ID, append([]func(int64, int) json.RawMessage{w.right, w.wrong}, repeat(w.right, Length-2)...)...)
	if g := w.goalsOf(vi); !g["row5"].Done || g["topics3"].Progress != 1 {
		t.Fatalf("a row of eight: %+v", g)
	}

	// A type of question, an exact number, and quick answers (each here takes 3 seconds).
	cy := w.user()
	s, _ = w.g.StartTopic(ctx, cy, cat.ID)
	types := map[string]int{}
	for _, p := range w.picks(s.ID) {
		q, _ := w.b.Get(p.ID)
		types[q.Base().Type]++
	}
	most := "number"
	for _, ty := range goalTypes {
		if types[ty.id] > types[most] {
			most = ty.id
		}
	}
	w.setGoals(cy, "day", "type:"+most, "fast12")
	w.play(cy, s.ID, repeat(w.right, Length)...)
	if g := w.goalsOf(cy); g["type:"+most].Progress != min(types[most], 3) || g["fast12"].Progress != Length {
		t.Fatalf("types %v: %+v", types, g)
	}
	// Every number answered right on the dot is exact.
	if tl, err := w.g.tallyOf(ctx, cy, w.g.Today()); err != nil || tl.exact != types["number"] {
		t.Fatalf("exact numbers: %+v of %d (%v)", tl, types["number"], err)
	}
}

func TestGoalsOfOthers(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, vi, cy := w.user(), w.user(), w.user()
	w.befriend(ana, vi)

	// Арена: played and won, kept and told as it ends.
	w.setGoals(ana, "day", "arena", "arenaWin")
	w.setGoals(cy, "day", "arena", "arenaWin")
	w.setGoals(vi, "day", "friendDuel", "duelWin")
	if _, err := w.g.SettleArena(ctx, []ArenaPlace{{ana, 1, 3000, 3}, {vi, 2, 2000, 2}, {cy, 3, 0, 0}}); err != nil {
		t.Fatal(err)
	}
	if n, _ := w.g.NewsOf(ctx, ana, 0); len(n.Goals) != 2 || n.Goals[1].XP != GoalXP[2] {
		t.Fatalf("Ana's arena goals: %+v", n.Goals)
	}
	if g := w.goalsOf(cy); !g["arena"].Done || g["arenaWin"].Done {
		t.Fatalf("Cy's arena goals: %+v", g)
	}

	// A friend's challenge: played by both; the one who wins has won a duel the day it ends.
	s, id, err := w.g.ChallengeFriend(ctx, vi, ana)
	if err != nil {
		t.Fatal(err)
	}
	w.play(vi, s.ID, repeat(w.right, Length)...)
	if g := w.goalsOf(vi); !g["friendDuel"].Done || g["duelWin"].Done {
		t.Fatalf("Vi before Ana played: %+v", g)
	}
	as, err := w.g.PlayDuel(ctx, ana, id)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, as.ID, repeat(w.wrong, Length)...)
	if n, _ := w.g.NewsOf(ctx, vi, 0); !slices.Contains(n.Goals, DoneGoal{Name: "Спечели дуел", XP: GoalXP[2]}) {
		t.Fatalf("Vi's duel won: %+v", n.Goals)
	}
}
