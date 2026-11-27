package play

import (
	"context"
	"database/sql"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// freshFor are the ways a game's questions are chosen (the functions in this package that choose them, or make a run
// of them), each with the game below that holds it to the rule (TestNothingPlayedAgain), or why it's a repeat by
// design. A new way fails the test until it's here.
var freshFor = map[string]string{
	"startChapter": "a chapter",
	"Draw":         "a chapter",
	"DuelFriend":   "a friend's duel",
	// By design:
	"StartDay": "by design: the day's ten are the same for everyone",
	"drawDay":  "by design: the day's ten are the same for everyone",
	"PlayDuel": "by design: a duel's second side plays the first's ten",
}

// TestNothingPlayedAgain holds the rule across every way a game starts: a player who has just played a game, starting
// any other kind (or the same again: a rematch), is dealt questions they haven't seen while the bank has them. A
// friend's duel is drawn for both its players: none of them has seen a question dealt while some are left that none
// has. The player has played most of the bank before (all but three chapters), so that a draw that didn't prefer what
// they haven't seen would deal it again almost surely. The repeats by design (freshFor) are the day (the same for
// everyone), and a duel's second side (the same ten as the first).
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
		{"a chapter", func(f *fresh) {
			s, err := f.w.g.startChapter(f.ctx(), f.ana, MixChapter)
			f.must(err)
			f.w.play(f.ana, s.ID, repeat(f.w.right, Length)...)
		}},
		{"a friend's duel", func(f *fresh) {
			id, err := f.w.g.DuelFriend(f.ctx(), f.ana, f.bo)
			f.must(err)
			f.w.playSide(f.ana, id, repeat(f.w.right, Length))
			f.w.playSide(f.bo, id, repeat(f.w.wrong, Length))
		}},
	}

	// The games held to the rule: what each deals the player, of which questions (pool), drawn for whom (players).
	// After a friend's duel, a friend's duel again is a rematch.
	type next struct {
		name string
		deal func(f *fresh) (picks []Pick, pool func(bank.Question) bool, players []int64)
	}
	nexts := []next{
		{"a chapter", func(f *fresh) ([]Pick, func(bank.Question) bool, []int64) {
			s, err := f.w.g.startChapter(f.ctx(), f.ana, MixChapter)
			f.must(err)
			return f.w.picks(s.ID), anyQuestion, []int64{f.ana}
		}},
		{"a chapter of one", func(f *fresh) ([]Pick, func(bank.Question) bool, []int64) {
			s, err := f.w.g.StartChapter(f.ctx(), f.ana, freshChapters[0])
			f.must(err)
			return f.w.picks(s.ID), func(q bank.Question) bool { return q.Base().Category == freshChapters[0] }, []int64{f.ana}
		}},
		{"a friend's duel", func(f *fresh) ([]Pick, func(bank.Question) bool, []int64) {
			id, err := f.w.g.DuelFriend(f.ctx(), f.ana, f.bo)
			f.must(err)
			return f.w.picks(f.w.playSide(f.ana, id, nil)), anyQuestion, []int64{f.ana, f.bo}
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

// freshChapters are the chapters the player hasn't played before the test's games (newFresh): the rest they have, all.
var freshChapters = []string{"geography", "history", "science"}

func anyQuestion(bank.Question) bool { return true }

// fresh is a world for TestNothingPlayedAgain, the day after the first issue (neither Ана nor Бо played it): Ана, who
// has played every question but those of freshChapters (some wrong, days ago), and her friend Бо.
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
	// Ана's past: every question but those of freshChapters, a third of them wrong, four days ago, in one long game.
	var picks []Pick
	for _, q := range w.b.Live("", "") {
		if !slices.Contains(freshChapters, q.Base().Category) {
			picks = append(picks, Pick{ID: q.Base().ID, Seed: uint64(len(picks))})
		}
	}
	var runID int64
	f.must(w.g.DB.Tx(f.ctx(), func(tx *sql.Tx) error {
		r, err := w.g.insertRun(f.ctx(), tx, f.ana, "chapter", nil, MixChapter, picks)
		if err != nil {
			return err
		}
		runID = r.id
		for n, p := range picks {
			if _, err := tx.Exec(`INSERT INTO answers (run_id, n, question_id, given, shown, score, is_right, ms, at, version)
				VALUES (?, ?, ?, '{"pick":0}', '{"pick":0}', ?, ?, 4000, ?, ?)`, r.id, n, p.ID, n%3, n%3 != 0,
				store.Ms(w.clock.now().Add(-4*24*time.Hour)), w.g.versionOf(p)); err != nil {
				return err
			}
		}
		_, err = tx.Exec(`UPDATE runs SET at = ?, finished_at = ? WHERE id = ?`, len(picks), store.Ms(w.clock.now()), r.id)
		return err
	}))
	w.g.finished(f.ctx(), f.ana, runID)
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
