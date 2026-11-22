package play

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// dayAs plays the day's ten for a player, as far as upTo questions answered (all of them for -1), each answered three
// seconds after it shows, as how says (right or wrong) for question n; it returns the run as it stands.
func (w *world) dayAs(user int64, upTo int, how func(n int) func(int64, int) json.RawMessage) State {
	w.t.Helper()
	ctx := w.t.Context()
	s, err := w.g.StartDay(ctx, user)
	if err != nil {
		w.t.Fatal(err)
	}
	for answered := 0; !s.Done && answered != upTo; answered++ {
		s = w.show(user, s.ID)
		if s.Done {
			break
		}
		w.wait(3 * time.Second)
		res, err := w.answer(user, s.ID, s.At, how(s.At)(s.ID, s.At))
		if err != nil {
			w.t.Fatalf("answer %d: %v", s.At, err)
		}
		s = res.State
	}
	return s
}

// stateOf is a player's run as it stands now.
func (w *world) stateOf(user, runID int64) State {
	w.t.Helper()
	s, err := w.g.State(w.t.Context(), user, runID)
	if err != nil {
		w.t.Fatal(err)
	}
	return s
}

// withoutQuestion is the sample bank without a question: one taken out of the bank, not retired.
func withoutQuestion(t *testing.T, drop string) *bank.Bank {
	t.Helper()
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS("../../bank/sample")); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(dir, bank.QuestionsDir, "*.json"))
	for _, f := range files {
		data, _ := os.ReadFile(f)
		var qs []map[string]any
		if err := json.Unmarshal(data, &qs); err != nil {
			t.Fatal(err)
		}
		qs = slices.DeleteFunc(qs, func(q map[string]any) bool { return q["id"] == drop })
		data, _ = json.Marshal(qs)
		if err := os.WriteFile(f, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	b, problems := bank.Load(dir)
	if b == nil {
		t.Fatal(problems)
	}
	return b
}

// A question of the day's ten found wrong in the middle of its day counts for nobody that day, whenever they played:
// who played it all before (right throughout), who missed just that one, who was on it as it was voided, and who
// came after and never saw it end with the same nine right, all right, and the same tiebreak.
func TestDayVoidKeepsResultsComparable(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.reload(w.b)
	const k = 4
	before, missed, during, after := w.user(), w.user(), w.user(), w.user()
	allRight := func(int) func(int64, int) json.RawMessage { return w.right }
	sb := w.dayAs(before, -1, allRight)
	if !sb.Done || sb.Rights != Length {
		t.Fatalf("all right before: %+v", sb)
	}
	sm := w.dayAs(missed, -1, func(n int) func(int64, int) json.RawMessage {
		if n == k {
			return w.wrong
		}
		return w.right
	})
	if sm.Rights != Length-1 {
		t.Fatalf("one missed: %+v", sm)
	}
	sd := w.dayAs(during, k, allRight)
	w.show(during, sd.ID) // question k on screen as it's found wrong
	target := w.picks(sb.ID)[k].ID

	w.reload(editedSample(t, func(id string, q map[string]any) {
		if id == target {
			q["retired"], q["retiredWhy"] = true, "wrong"
		}
	}))
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}

	sd = w.stateOf(during, sd.ID)
	if sd.At != k+1 || sd.Question != nil || !sd.Trail[k].Void {
		t.Fatalf("on the void question as it's voided: %+v", sd)
	}
	sd = w.dayAs(during, -1, allRight)
	sa := w.dayAs(after, -1, allRight)
	if w.count(`SELECT count(*) FROM answers WHERE run_id = ? AND n = ?`, sa.ID, k) != 0 {
		t.Fatal("a player after the void was shown the void question")
	}
	closeness := func(run int64) int {
		return w.count(`SELECT closeness FROM runs WHERE id = ?`, run)
	}
	want := closeness(sa.ID)
	if want != 1000 {
		t.Fatalf("the number, right on: %d", want)
	}
	for who, s := range map[string]State{
		"before": w.stateOf(before, sb.ID), "missed": w.stateOf(missed, sm.ID), "during": sd, "after": sa,
	} {
		if !s.Done || s.Void != 1 || s.Rights != Length-1 || closeness(s.ID) != want {
			t.Errorf("%s: %+v, not nine right of nine (the number %d)", who, s, closeness(s.ID))
		}
		if len(s.Trail) != Length || !s.Trail[k].Void || s.Trail[k].Right || slices.ContainsFunc(s.Trail[:k], func(m Mark) bool { return m.Void }) {
			t.Errorf("%s's trail: %+v", who, s.Trail)
		}
	}
	// The answer given before stays (what was played); the review says it's void.
	if w.count(`SELECT count(*) FROM answers WHERE run_id = ? AND n = ? AND given IS NOT NULL`, sb.ID, k) != 1 {
		t.Fatal("the answer to the void question isn't kept")
	}
	review, err := w.g.Review(ctx, before, sb.ID)
	if err != nil || len(review) != Length || !review[k].Void {
		t.Fatalf("the review: %+v %v", review, err)
	}
	// The board and the friends' board see the day so.
	board, err := w.g.FriendsBoard(ctx, sb.Day, before)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range board {
		if s.Me && (len(s.Trail) != Length || !s.Trail[k].Void) {
			t.Fatalf("the friends' board: %+v", s)
		}
	}
	// Kept up with the next bank, the day is as it was: nothing voided twice.
	w.reload(editedSample(t, func(id string, q map[string]any) {
		if id == target {
			q["retired"], q["retiredWhy"] = true, "wrong"
		}
	}))
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	if s := w.stateOf(before, sb.ID); closeness(s.ID) != want || s.Rights != Length-1 || s.Void != 1 {
		t.Fatalf("again: %+v", s)
	}
}

// The day's ten hold still for their day: a reload that relabels one (easy to hard), retires one as weak, or fixes
// nothing changes nothing of how they're dealt and paid, for those before and after; one changed in what it asks, or
// taken out of the bank, is void. More than maxVoid at once is a mistake, not a fix: none is voided.
func TestDayHoldsStill(t *testing.T) {
	cases := []struct {
		name string
		bank func(t *testing.T, w *world, ids []string) *bank.Bank
		void []int
	}{
		{"relabelled", func(t *testing.T, w *world, ids []string) *bank.Bank {
			return editedSample(t, func(id string, q map[string]any) {
				if id == ids[2] {
					q["difficulty"] = map[string]string{"easy": "hard", "medium": "easy", "hard": "easy"}[q["difficulty"].(string)]
				}
			})
		}, nil},
		{"retired as weak", func(t *testing.T, w *world, ids []string) *bank.Bank {
			return editedSample(t, func(id string, q map[string]any) {
				if id == ids[3] {
					q["retired"], q["retiredWhy"] = true, "weak"
				}
			})
		}, nil},
		{"reworded", func(t *testing.T, w *world, ids []string) *bank.Bank {
			today := time.Now().Format(time.DateOnly) // a bank's dates are the keeper's, not the game's clock
			return editedSample(t, func(id string, q map[string]any) {
				if id == ids[5] {
					q["text"], q["changed"], q["updated"] = "Отново: "+q["text"].(string), today, today
					// A change has its sources, as every one since bank.TouchedFrom must.
					q["sources"], q["checked"], q["checkedBy"] = []string{"https://example.org/"}, today, "test"
				}
			})
		}, []int{5}},
		{"taken out", func(t *testing.T, w *world, ids []string) *bank.Bank { return withoutQuestion(t, ids[7]) }, []int{7}},
		{"too many", func(t *testing.T, w *world, ids []string) *bank.Bank {
			return editedSample(t, func(id string, q map[string]any) {
				if slices.Index(ids, id) > Length-maxVoid-2 {
					q["retired"], q["retiredWhy"] = true, "stale"
				}
			})
		}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := setup(t)
			ctx := t.Context()
			w.reload(w.b)
			first, second := w.user(), w.user()
			allRight := func(int) func(int64, int) json.RawMessage { return w.right }
			s1 := w.dayAs(first, -1, allRight)
			var ids []string
			for _, p := range w.picks(s1.ID) {
				ids = append(ids, p.ID)
			}
			w.reload(c.bank(t, w, ids))
			if err := w.g.EnsureDays(ctx); err != nil {
				t.Fatal(err)
			}
			s2 := w.dayAs(second, -1, func(n int) func(int64, int) json.RawMessage {
				return func(runID int64, n int) json.RawMessage {
					// Answered as the day showed it: the version the day began with.
					d, ok := w.g.Deal(w.picks(runID)[n])
					if !ok {
						t.Fatalf("question %d can't be dealt", n)
					}
					return rightOf(t, d)
				}
			})
			s1 = w.stateOf(first, s1.ID)
			if s1.Void != len(c.void) || s2.Void != len(c.void) || s1.Rights != s2.Rights || s2.Rights != Length-len(c.void) {
				t.Fatalf("before %+v, after %+v", s1, s2)
			}
			for _, n := range c.void {
				if !s1.Trail[n].Void || !s2.Trail[n].Void {
					t.Fatalf("question %d isn't void: %+v %+v", n, s1.Trail, s2.Trail)
				}
			}
		})
	}
}

// rightOf is the right answer to a deal, as a player would give it.
func rightOf(t *testing.T, d bank.Dealt) json.RawMessage {
	t.Helper()
	reveal, _ := json.Marshal(d.Reveal(nil))
	var r map[string]any
	_ = json.Unmarshal(reveal, &r)
	for _, k := range []string{"pick", "value", "truth", "sides", "pairs", "order"} {
		if v, ok := r[k]; ok {
			out, _ := json.Marshal(map[string]any{k: v})
			return out
		}
	}
	t.Fatalf("no answer in %s", reveal)
	return nil
}

// A day with a question void is a game of the nine that count wherever it's counted: nine of nine right is all right
// (its bonus, a first ten of ten in the book), a row goes over it, a result is told out of nine (the boards, the
// friends, the games played), and an answer sent again just before the void one gets its reply again.
func TestVoidDayIsOfNine(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.reload(w.b)
	w.g.CrowdMin = 1
	const k = 4
	ana, bo, cy := w.user(), w.user(), w.user()
	w.befriend(ana, bo)
	allRight := func(int) func(int64, int) json.RawMessage { return w.right }
	sb := w.dayAs(bo, -1, allRight)
	sa := w.dayAs(ana, -1, func(n int) func(int64, int) json.RawMessage {
		if n == k {
			return w.wrong
		}
		return w.right
	})
	sc := w.dayAs(cy, k-1, allRight) // at k-1, not shown yet
	target := w.picks(sb.ID)[k].ID
	w.reload(editedSample(t, func(id string, q map[string]any) {
		if id == target {
			q["retired"], q["retiredWhy"] = true, "wrong"
		}
	}))
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}

	// ana missed only the void one: all right, as bo is.
	if s := w.stateOf(ana, sa.ID); s.Rights != Length-1 {
		t.Fatalf("ana: %+v", s)
	}

	// Results are out of nine.
	board, err := w.g.BoardOf(ctx, sb.Day, ana)
	if err != nil {
		t.Fatal(err)
	}
	if board.Of != Length-1 || board.Mine == nil || board.Mine.Of != Length-1 || len(board.Top) == 0 ||
		slices.ContainsFunc(board.Top, func(s Score) bool { return s.Of != Length-1 }) {
		t.Fatalf("the board: %+v", board)
	}
	friends, err := w.g.FriendsBoard(ctx, sb.Day, ana)
	if err != nil {
		t.Fatal(err)
	}
	if len(friends) != 2 || slices.ContainsFunc(friends, func(s Score) bool { return s.Of != Length-1 }) {
		t.Fatalf("the friends' board: %+v", friends)
	}

	// cy answers the question before the void one, and the reply is lost: sent again, it gets it again.
	w.show(cy, sc.ID)
	w.wait(3 * time.Second)
	first, err := w.answer(cy, sc.ID, k-1, w.right(sc.ID, k-1))
	if err != nil {
		t.Fatal(err)
	}
	if first.State.At != k+1 {
		t.Fatalf("past the void one: %+v", first.State)
	}
	again, err := w.answer(cy, sc.ID, k-1, w.right(sc.ID, k-1))
	if err != nil || !again.Right || again.Reveal == nil {
		t.Fatalf("sent again: %+v %v", again, err)
	}
}
