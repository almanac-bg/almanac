package play

import (
	"encoding/json"
	"errors"
	"math/rand/v2"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A room's game has its length, its mix's difficulties easy to hard, and the other types spread through it.
func TestRoomSlots(t *testing.T) {
	order := map[bank.Difficulty]int{bank.Easy: 0, bank.Medium: 1, bank.Hard: 2}
	for _, n := range RoomLengths {
		for _, mix := range []Mix{MixEasy, MixMixed, MixHard} {
			slots := roomSlots(n, mix)
			if len(slots) != n {
				t.Fatalf("%d %s: %d slots", n, mix, len(slots))
			}
			types := map[string]int{}
			for i, s := range slots {
				types[s.typ]++
				if (mix == MixEasy && s.difficulty == bank.Hard) || (mix == MixHard && s.difficulty == bank.Easy) {
					t.Errorf("%d %s: a %s question", n, mix, s.difficulty)
				}
				if i > 0 && order[s.difficulty] < order[slots[i-1].difficulty] {
					t.Errorf("%d %s: not easy to hard", n, mix)
				}
			}
			if types["choice"] != n-n/2 || types["truefalse"] == 0 || (n >= 10 && types["number"] != n/10) {
				t.Errorf("%d %s: %v", n, mix, types)
			}
		}
	}
	// Mixed is a topic's game for most players.
	mixed, topic := roomSlots(Length, MixMixed), topicSlots(0)
	for i := range topic {
		if mixed[i].difficulty != topic[i].difficulty {
			t.Fatalf("mixed: %v, a topic's game: %v", mixed, topic)
		}
	}
	if _, _, err := RoomGame(12, MixEasy); !errors.Is(err, ErrRoomGame) {
		t.Fatal("twelve questions")
	}
	if n, mix, err := RoomGame(0, ""); err != nil || n != Length || mix != MixMixed {
		t.Fatalf("the defaults: %d %s %v", n, mix, err)
	}
}

func TestDrawRoom(t *testing.T) {
	w := setup(t)
	r := rand.New(rand.NewPCG(1, 2))
	barred := map[string]bool{}
	for _, mix := range []Mix{MixEasy, MixHard} {
		picks := DrawRoom(w.b, "", 20, mix, barred, nil, r)
		if len(picks) != 20 {
			t.Fatalf("%s: %d questions", mix, len(picks))
		}
		for _, p := range picks {
			q, _ := w.b.Get(p.ID)
			if d := q.Base().Difficulty; (mix == MixEasy && d == bank.Hard) || (mix == MixHard && d == bank.Easy) {
				t.Fatalf("%s: %s is %s", mix, p.ID, d)
			}
			if barred[p.ID] {
				t.Fatalf("%s dealt again", p.ID)
			}
			barred[p.ID] = true
		}
	}
	// A small topic runs out: the game is shorter, never easier than its mix.
	for range 10 {
		for _, p := range DrawRoom(w.b, "history", 20, MixHard, barred, nil, r) {
			q, _ := w.b.Get(p.ID)
			if barred[p.ID] || q.Base().Difficulty == bank.Easy {
				t.Fatalf("%s: dealt again, or easy", p.ID)
			}
			barred[p.ID] = true
		}
	}
}

// A player's game in a room is kept as a run of its own: it earns XP and counts for goals and achievements, its
// answers are seen, and it's on no board of the day.
func TestRecordRoom(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u, late := w.user(), w.user()
	picks := DrawRoom(w.b, "", 10, MixMixed, nil, nil, rand.New(rand.NewPCG(3, 4)))
	right := func(n int) RoomAnswer {
		q, _ := w.b.Get(picks[n].ID)
		d := q.Deal(picks[n].Seed)
		raw, _ := json.Marshal(d.Reveal(nil))
		var rv map[string]any
		_ = json.Unmarshal(raw, &rv)
		a := map[string]any{}
		for _, k := range []string{"pick", "value", "order", "truth", "pairs", "sides", "answer"} {
			if v, ok := rv[k]; ok {
				a[k] = v
			}
		}
		given, _ := json.Marshal(a)
		g, err := bank.GradeAt(d, given, 4_000_000_000)
		if err != nil {
			t.Fatalf("%s: %v", picks[n].ID, err)
		}
		return RoomAnswer{N: n, Given: given, Shown: g.Shown, Score: g.Score, Right: g.Right, Points: 500, Ms: 4000, At: w.now}
	}
	var all []RoomAnswer
	rights := 0
	for n := range picks {
		a := right(n)
		if a.Right {
			rights++
		}
		all = append(all, a)
	}
	run, err := w.g.RecordRoom(ctx, u, RoomPlay{Picks: picks, Points: 5000, Answers: all, Players: 2})
	if err != nil {
		t.Fatal(err)
	}
	var kind string
	var xp, points, got int
	_ = w.db.Read.QueryRow(`SELECT kind, xp, points, rights FROM runs WHERE id = ? AND finished_at IS NOT NULL`, run).
		Scan(&kind, &xp, &points, &got)
	if kind != "room" || points != 5000 || got != rights || xp != rights*(XPAnswer+XPKnown)+(len(picks)-rights)*XPAnswer+
		finishXP("room", rights, len(picks)) {
		t.Fatalf("the run: %s, %d XP, %d points, %d right of %d", kind, xp, points, got, rights)
	}
	seen := map[string]bool{}
	if err := seenBy(ctx, w.db.Read, u, seen); err != nil || len(seen) != len(picks) {
		t.Fatalf("seen: %d %v", len(seen), err)
	}
	if b, _ := w.g.BoardOf(ctx, w.g.Today(), u); b.Players != 0 || b.Place != 0 {
		t.Fatalf("on the day's board: %+v", b)
	}
	news, err := w.g.NewsOf(ctx, u, run)
	if err != nil || news.Earned < xp {
		t.Fatalf("the news: %+v %v", news, err)
	}
	tally, _ := w.g.tallyOf(ctx, u, w.g.Today())
	if tally.right != rights || tally.eight != 1 {
		t.Fatalf("the day's goals counted %d right answers of %d, %d games of 8 or more", tally.right, rights, tally.eight)
	}
	var players int
	_ = w.db.Read.QueryRow(`SELECT players FROM runs WHERE id = ?`, run).Scan(&players)
	if players != 2 {
		t.Fatalf("kept with %d players", players)
	}

	// One who came in for the last question alone: a game of ten with one answer, no game without a mistake.
	lr, err := w.g.RecordRoom(ctx, late, RoomPlay{Picks: picks, Points: 500, Answers: []RoomAnswer{right(9)}})
	if err != nil {
		t.Fatal(err)
	}
	_ = w.db.Read.QueryRow(`SELECT xp FROM runs WHERE id = ?`, lr).Scan(&xp)
	if xp != XPAnswer+XPKnown+finishXP("room", 1, len(picks)) {
		t.Fatalf("a late comer's XP: %d", xp)
	}
	var perfect bool
	_ = w.db.Read.QueryRow(`SELECT rights = json_array_length(questions) FROM runs WHERE id = ?`, lr).Scan(&perfect)
	if perfect {
		t.Fatal("one answer of ten counts as a perfect game")
	}
}

// A room's game is kept once for each player, by its id: kept again (its end played twice, over a crash), it's the
// run it was kept as, and earns nothing more. A game cut short earns by the questions it was dealt (review 2026-11-18,
// A14 and S19).
func TestRecordRoomOnce(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u, v := w.user(), w.user()
	picks := DrawRoom(w.b, "", 5, MixMixed, nil, nil, rand.New(rand.NewPCG(5, 6)))
	cut := RoomPlay{Game: "G1", Picks: picks[:1], Length: 5, Points: 100,
		Answers: []RoomAnswer{{N: 0, Given: json.RawMessage(`{"pick":0}`), Shown: json.RawMessage(`{"pick":0}`), Score: 1,
			Right: true, Points: 100, Ms: 3000, At: w.now}}}
	first, err := w.g.RecordRoom(ctx, u, cut)
	if err != nil {
		t.Fatal(err)
	}
	again, err := w.g.RecordRoom(ctx, u, cut)
	if err != nil || again != first {
		t.Fatalf("kept again: run %d (first %d), %v", again, first, err)
	}
	other, err := w.g.RecordRoom(ctx, v, cut) // another player of the same game
	if err != nil || other == first {
		t.Fatalf("another player's game: run %d, %v", other, err)
	}
	var runs, xp int
	_ = w.db.Read.QueryRow(`SELECT count(*), sum(xp) FROM runs WHERE user_id = ? AND kind = 'room'`, u).Scan(&runs, &xp)
	if runs != 1 || xp != XPAnswer+XPKnown+finishXP("room", 1, 5) {
		t.Fatalf("%d runs, %d XP", runs, xp)
	}
	if _, err := w.g.RecordRoom(ctx, u, RoomPlay{Picks: picks[:1], Answers: cut.Answers}); err != nil {
		t.Fatal(err)
	}
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM runs WHERE user_id = ? AND kind = 'room'`, u).Scan(&runs)
	if runs != 2 {
		t.Fatalf("a game with no id is kept as a new one each time: %d runs", runs)
	}
}

// A room's game played alone earns its XP, but counts for no goal of the day and not towards „Сто игри“; with someone
// else it counts, and towards „Сто игри“ only with ten questions or more (review 2026-11-18, E10).
func TestRoomAlone(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	all := func(picks []Pick) []RoomAnswer {
		var out []RoomAnswer
		for n, p := range picks {
			q, _ := w.b.Get(p.ID)
			d := q.Deal(p.Seed)
			raw, _ := json.Marshal(d.Reveal(nil))
			var rv map[string]any
			_ = json.Unmarshal(raw, &rv)
			a := map[string]any{}
			for _, k := range []string{"pick", "value", "order", "truth", "pairs", "sides", "answer"} {
				if v, ok := rv[k]; ok {
					a[k] = v
				}
			}
			given, _ := json.Marshal(a)
			g, err := bank.GradeAt(d, given, 4_000_000_000)
			if err != nil {
				t.Fatal(err)
			}
			out = append(out, RoomAnswer{N: n, Given: given, Shown: g.Shown, Score: g.Score, Right: g.Right, Ms: 4000,
				At: w.now})
		}
		return out
	}
	games := func(u int64) int {
		m, err := w.g.measure(ctx, u)
		if err != nil {
			t.Fatal(err)
		}
		return m["games100"]
	}
	ten := DrawRoom(w.b, "", 10, MixEasy, nil, nil, rand.New(rand.NewPCG(7, 8)))
	five := DrawRoom(w.b, "", 5, MixEasy, nil, nil, rand.New(rand.NewPCG(9, 10)))

	alone := w.user()
	run, err := w.g.RecordRoom(ctx, alone, RoomPlay{Game: "A", Picks: ten, Length: 10, Answers: all(ten), Players: 1})
	if err != nil {
		t.Fatal(err)
	}
	var xp int
	_ = w.db.Read.QueryRow(`SELECT xp FROM runs WHERE id = ?`, run).Scan(&xp)
	if tl, _ := w.g.tallyOf(ctx, alone, w.g.Today()); xp == 0 || tl.right != 0 || tl.eight != 0 || games(alone) != 0 {
		t.Fatalf("a room alone: %d XP, tally %+v, %d games", xp, tl, games(alone))
	}

	two := w.user()
	for _, p := range []RoomPlay{
		{Game: "B", Picks: ten, Length: 10, Answers: all(ten), Players: 2},
		{Game: "C", Picks: five, Length: 5, Answers: all(five), Players: 2},
	} {
		if _, err := w.g.RecordRoom(ctx, two, p); err != nil {
			t.Fatal(err)
		}
	}
	if tl, _ := w.g.tallyOf(ctx, two, w.g.Today()); tl.eight != 1 || tl.right != 15 || games(two) != 1 {
		t.Fatalf("rooms of two: tally %+v, %d games", tl, games(two))
	}
}
