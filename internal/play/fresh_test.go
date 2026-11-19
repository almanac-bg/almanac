package play

import (
	"context"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"math/rand/v2"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// freshFor are the ways a game's questions are chosen (the functions in this package that choose them, or make a run
// of them), each with the game below that holds it to the rule (TestNothingPlayedAgain), or why it's a repeat by
// design. A new way fails the test until it's here.
var freshFor = map[string]string{
	"StartTopic":    "a topic",
	"Draw":          "a topic",
	"StartLive":     "a live duel",
	"StartRecorded": "a recording",
	"RecordRoom":    "a room",
	"DrawRoom":      "a room",
	"StartRoyal":    "Роял",
	"EnterRoyal":    "Роял",
	"DrawRoyal":     "Роял",
	"DealRoyal":     "Роял",
	"drawRoyal":     "Роял",
	// By design:
	"StartDay":      "by design: the day's ten are the same for everyone",
	"drawDay":       "by design: the day's ten are the same for everyone",
	"StartMistakes": "by design: Втори шанс asks again what the player missed",
}

// TestNothingPlayedAgain holds the rule across every way a game starts: a player who has just played a game, starting
// any other kind (or the same again: a rematch), is dealt questions they haven't seen while the bank has them. Live
// duels, rooms and Роял are drawn for all their players: none of them has seen a question dealt while some are left
// that none has. A recording is a whole game, someone else's: one with at most RecordingSeen of its questions seen
// while there's such a game. The player has played most of the bank before (all but three topics), so that a draw
// that didn't prefer what they haven't seen would deal it again almost surely. Repeats by design (freshFor) are the
// day (the same for everyone) and Втори шанс (what they missed).
func TestNothingPlayedAgain(t *testing.T) {
	t.Run("every way is here", func(t *testing.T) {
		ways := choosers(t)
		for _, name := range ways {
			if freshFor[name] == "" {
				t.Errorf("%s chooses a game's questions: add it to freshFor and TestNothingPlayedAgain (a game that "+
					"holds it to the rule, or why it's a repeat by design)", name)
			}
		}
		for name := range freshFor {
			if !slices.Contains(ways, name) {
				t.Errorf("freshFor names %s, which chooses no game's questions now", name)
			}
		}
	})

	befores := []struct {
		name string
		play func(f *fresh)
	}{
		{"the day", func(f *fresh) {
			s, err := f.w.g.StartDay(f.ctx(), f.ana)
			f.must(err)
			f.w.play(f.ana, s.ID, repeat(f.w.right, Length)...)
		}},
		{"a topic", func(f *fresh) {
			s, err := f.w.g.StartTopic(f.ctx(), f.ana, "")
			f.must(err)
			f.w.play(f.ana, s.ID, repeat(f.w.right, Length)...)
		}},
		{"a live duel", func(f *fresh) {
			l, err := f.w.g.StartLive(f.ctx(), f.ana, f.bo)
			f.must(err)
			f.w.play(f.ana, l.Runs[0], repeat(f.w.right, Length)...)
			f.w.play(f.bo, l.Runs[1], repeat(f.w.wrong, Length)...)
		}},
		{"a recording", func(f *fresh) {
			l, err := f.w.g.StartRecorded(f.ctx(), f.ana)
			f.must(err)
			f.w.play(f.ana, l.Runs[0], repeat(f.w.right, Length)...)
		}},
		{"a room", func(f *fresh) {
			picks := f.room()
			p := RoomPlay{Game: "game", Picks: picks, Length: len(picks), Players: 2}
			for n := range picks {
				p.Answers = append(p.Answers, RoomAnswer{N: n, Given: json.RawMessage(`{"pick":0}`),
					Shown: json.RawMessage(`{"pick":0}`), Right: true, Points: 500, Ms: 3000, At: f.w.now})
			}
			_, err := f.w.g.RecordRoom(f.ctx(), f.ana, p)
			f.must(err)
			f.w.g.AftersDone(f.ctx())
		}},
		{"Роял", func(f *fresh) {
			id, runs := f.royal()
			for n := range RoyalLength {
				if n > 0 {
					_, err := f.w.g.ShowRoyal(f.ctx(), n, id)
					f.must(err)
				}
				for _, u := range []int64{f.ana, f.bo} {
					f.w.wait(2 * time.Second)
					_, err := f.w.g.AnswerRoyal(f.ctx(), u, runs[u], n, f.w.right(runs[u], n), f.w.now, time.Time{},
						f.w.dealt(runs[u], n))
					f.must(err)
				}
				_, err := f.w.g.RevealRoyal(f.ctx(), id)
				f.must(err)
			}
			_, err := f.w.g.SettleRoyal(f.ctx(), id)
			f.must(err)
		}},
		{"Втори шанс", func(f *fresh) {
			s, err := f.w.g.StartMistakes(f.ctx(), f.ana)
			f.must(err)
			f.w.play(f.ana, s.ID, repeat(f.w.right, len(f.w.picks(s.ID)))...)
		}},
	}

	// The games held to the rule: what each deals the player, of which questions (pool), drawn for whom (players).
	// After a live duel, a live duel again is a rematch (live.Hub.Rematch: StartLive). A recording is checked apart.
	type next struct {
		name string
		deal func(f *fresh) (picks []Pick, pool func(bank.Question) bool, players []int64)
	}
	nexts := []next{
		{"a topic", func(f *fresh) ([]Pick, func(bank.Question) bool, []int64) {
			s, err := f.w.g.StartTopic(f.ctx(), f.ana, "")
			f.must(err)
			return f.w.picks(s.ID), anyQuestion, []int64{f.ana}
		}},
		{"a topic of one", func(f *fresh) ([]Pick, func(bank.Question) bool, []int64) {
			s, err := f.w.g.StartTopic(f.ctx(), f.ana, freshTopics[0])
			f.must(err)
			return f.w.picks(s.ID), func(q bank.Question) bool { return q.Base().Category == freshTopics[0] }, []int64{f.ana}
		}},
		{"a live duel", func(f *fresh) ([]Pick, func(bank.Question) bool, []int64) {
			l, err := f.w.g.StartLive(f.ctx(), f.ana, f.bo)
			f.must(err)
			return l.Picks, anyQuestion, []int64{f.ana, f.bo}
		}},
		{"a recording", nil},
		{"a room", func(f *fresh) ([]Pick, func(bank.Question) bool, []int64) {
			return f.room(), anyQuestion, []int64{f.ana, f.bo}
		}},
		{"Роял", func(f *fresh) ([]Pick, func(bank.Question) bool, []int64) {
			_, runs := f.royal()
			return f.w.picks(runs[f.ana]), func(q bank.Question) bool {
				return q.Base().Type == "choice" || q.Base().Type == "truefalse"
			}, []int64{f.ana, f.bo}
		}},
	}
	for name, game := range freshFor {
		if !strings.HasPrefix(game, "by design") && !slices.ContainsFunc(nexts, func(n next) bool { return n.name == game }) {
			t.Errorf("freshFor holds %s to the rule by %q, a game the test doesn't start", name, game)
		}
	}

	for _, before := range befores {
		for _, next := range nexts {
			t.Run(before.name+", then "+next.name, func(t *testing.T) {
				t.Parallel()
				f := newFresh(t)
				before.play(f)
				f.w.wait(time.Minute)
				barred, err := f.w.g.DayQuestions(f.ctx())
				f.must(err)
				if next.deal == nil { // a recording: whole games, someone else's
					seenNow := f.seen(f.ana)
					best := f.recordingsSeen(seenNow, barred)
					l, err := f.w.g.StartRecorded(f.ctx(), f.ana)
					f.must(err)
					n := count(l.Picks, seenNow)
					if best <= RecordingSeen && n > RecordingSeen {
						t.Fatalf("a recording with %d of its questions played already, while one with %d is there", n, best)
					}
					return
				}
				f.seen(f.ana)
				f.seen(f.bo)
				picks, pool, players := next.deal(f)
				// What none of its players has seen, of what the game may deal.
				left := 0
				for _, q := range f.w.b.Live("", "") {
					if pool(q) && !barred[q.Base().ID] && !slices.ContainsFunc(players, func(u int64) bool {
						return f.seenBy[u][q.Base().ID]
					}) {
						left++
					}
				}
				again := 0
				for _, p := range picks {
					if slices.ContainsFunc(players, func(u int64) bool { return f.seenBy[u][p.ID] }) {
						again++
					}
				}
				if want := max(0, len(picks)-left); again > want {
					t.Fatalf("%d of %d questions played already by its players (%d left that none has seen)",
						again, len(picks), left)
				}
				if len(picks) == 0 {
					t.Fatal("no questions")
				}
			})
		}
	}
}

// freshTopics are the topics the player hasn't played before the test's games (newFresh): the rest they have, all.
var freshTopics = []string{"geography", "history", "science"}

func anyQuestion(bank.Question) bool { return true }

// fresh is a world for TestNothingPlayedAgain, the day after the first issue (neither Ана nor Бо played it): Ана, who has played every question but those of freshTopics (some wrong, days ago: a Втори шанс
// waits), and her friend Бо; two others' games of one topic each, in two of freshTopics, to play against as
// recordings.
type fresh struct {
	t       *testing.T
	w       *world
	ana, bo int64
	seenBy  map[int64]map[string]bool // read by seen
}

func newFresh(t *testing.T) *fresh {
	w := setup(t)
	f := &fresh{t: t, w: w, ana: w.user(), bo: w.user(), seenBy: map[int64]map[string]bool{}}
	w.befriend(f.ana, f.bo)
	if _, err := w.g.StartDay(f.ctx(), w.user()); err != nil { // the first issue, drawn
		t.Fatal(err)
	}
	w.wait(25 * time.Hour)
	for _, topic := range freshTopics[1:] {
		u := w.user()
		s, err := w.g.StartTopic(f.ctx(), u, topic)
		f.must(err)
		w.play(u, s.ID, append(repeat(w.right, 6), repeat(w.wrong, Length-6)...)...)
		w.wait(time.Minute)
	}
	// Ана's past: every other question, a third of them wrong, four days ago (kept as a room's game).
	var past RoomPlay
	for _, q := range w.b.Live("", "") {
		if slices.Contains(freshTopics, q.Base().Category) {
			continue
		}
		n := len(past.Picks)
		past.Picks = append(past.Picks, Pick{ID: q.Base().ID, Seed: uint64(n)})
		past.Answers = append(past.Answers, RoomAnswer{N: n, Given: json.RawMessage(`{"pick":0}`),
			Shown: json.RawMessage(`{"pick":0}`), Right: n%3 != 0, Ms: 4000, At: w.now.Add(-4 * 24 * time.Hour)})
	}
	past.Length, past.Players = len(past.Picks), 1
	_, err := w.g.RecordRoom(f.ctx(), f.ana, past)
	f.must(err)
	w.g.AftersDone(f.ctx())
	return f
}

func (f *fresh) ctx() context.Context { return f.t.Context() }

func (f *fresh) must(err error) {
	f.t.Helper()
	if err != nil {
		f.t.Fatal(err)
	}
}

// seen are the questions a player has answered, in any game, as of now (kept in seenBy).
func (f *fresh) seen(u int64) map[string]bool {
	f.t.Helper()
	out := map[string]bool{}
	rows, err := f.w.db.Read.Query(`SELECT DISTINCT a.question_id FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ?`, u)
	f.must(err)
	defer rows.Close()
	for rows.Next() {
		var id string
		f.must(rows.Scan(&id))
		out[id] = true
	}
	f.seenBy[u] = out
	return out
}

// room draws a room's game for Ана and Бо, as a room does (room.Room.start).
func (f *fresh) room() []Pick {
	barred, seen, err := f.w.g.RoomPast(f.ctx(), []int64{f.ana, f.bo})
	f.must(err)
	return DrawRoom(f.w.b, nil, Length, MixMixed, barred, seen, rand.New(rand.NewPCG(1, 2)))
}

// royal opens an evening's Роял for Бо (its first in), Ана comes too, and its games begin, as the hub does them
// (royal.Hub.Join, begin): the tournament, and each one's run.
func (f *fresh) royal() (int64, map[int64]int64) {
	start := time.Date(2026, 11, 13, 21, 0, 0, 0, Bulgaria)
	picks, err := f.w.g.DrawRoyal(f.ctx(), []int64{f.bo})
	f.must(err)
	id, err := f.w.g.NewRoyal(f.ctx(), start, picks)
	f.must(err)
	for _, u := range []int64{f.bo, f.ana} {
		f.must(f.w.g.JoinRoyal(f.ctx(), id, u))
	}
	_, err = f.w.g.DealRoyal(f.ctx(), []int64{id}, []int64{f.bo, f.ana})
	f.must(err)
	runs, _, err := f.w.g.StartRoyal(f.ctx(), id, []int64{f.bo, f.ana})
	f.must(err)
	return id, runs
}

// recordingsSeen is, of the games others have finished that a recording may be (none with a question barred now, none
// still played against), the fewest questions of one the player has seen.
func (f *fresh) recordingsSeen(seen, barred map[string]bool) int {
	rows, err := f.w.db.Read.Query(`SELECT r.questions FROM runs r WHERE r.kind IN ('topic', 'duel')
		AND r.finished_at IS NOT NULL AND r.user_id <> ? AND json_array_length(r.questions) = ?
		AND NOT EXISTS (SELECT 1 FROM duels d WHERE d.ended_at IS NULL
			AND (d.a_run = r.id OR d.b_run = r.id))`, f.ana, Length)
	f.must(err)
	defer rows.Close()
	best := Length + 1
	for rows.Next() {
		var raw string
		f.must(rows.Scan(&raw))
		var picks []Pick
		f.must(json.Unmarshal([]byte(raw), &picks))
		if slices.ContainsFunc(picks, func(p Pick) bool { return barred[p.ID] }) {
			continue
		}
		best = min(best, count(picks, seen))
	}
	f.must(rows.Err())
	return best
}

func count(picks []Pick, seen map[string]bool) int {
	n := 0
	for _, p := range picks {
		if seen[p.ID] {
			n++
		}
	}
	return n
}

// choosers are the functions of this package (but its tests) that choose a game's questions: those that make a run
// of them (insertRun), choose them (choose), or hand them out (exported, with []Pick among what they return).
func choosers(t *testing.T) []string {
	t.Helper()
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	fset := token.NewFileSet()
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		file, err := parser.ParseFile(fset, name, src, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range file.Decls {
			fn, ok := d.(*ast.FuncDecl)
			if !ok || fn.Body == nil || fn.Name.Name == "choose" || fn.Name.Name == "insertRun" {
				continue
			}
			found := false
			if fn.Name.IsExported() && fn.Type.Results != nil {
				for _, r := range fn.Type.Results.List {
					if a, ok := r.Type.(*ast.ArrayType); ok && fmt.Sprint(a.Elt) == "Pick" {
						found = true
					}
				}
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				switch fun := call.Fun.(type) {
				case *ast.Ident:
					found = found || fun.Name == "choose"
				case *ast.SelectorExpr:
					found = found || fun.Sel.Name == "insertRun"
				}
				return true
			})
			if found && !slices.Contains(out, fn.Name.Name) {
				out = append(out, fn.Name.Name)
			}
		}
	}
	return out
}
