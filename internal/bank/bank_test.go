package bank

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

const sample = "../../bank/sample"

func loadSample(t *testing.T) *Bank {
	t.Helper()
	b, problems := Load(sample)
	if b == nil {
		t.Fatalf("the sample doesn't load: %v", problems)
	}
	return b
}

func TestSampleLoads(t *testing.T) {
	b := loadSample(t)
	if len(b.Categories) == 0 || len(b.Questions) < 100 {
		t.Fatalf("a thin sample: %d categories, %d questions", len(b.Categories), len(b.Questions))
	}
	for _, typ := range Types() {
		if len(b.Live("", typ)) == 0 {
			t.Errorf("the sample has no %s question: every type needs one to develop and test with", typ)
		}
	}
}

// The files are kept in Format's form: writing them out again changes nothing.
func TestSampleIsFormatted(t *testing.T) {
	b := loadSample(t)
	for _, c := range b.Categories {
		want, _ := os.ReadFile(filepath.Join(sample, QuestionsDir, c.ID+".json"))
		got, err := Format(b.InCategory(c.ID))
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(want) {
			t.Errorf("%s.json isn't in the bank's format: run `almanac bank fmt bank/sample`", c.ID)
		}
	}
}

func viewJSON(t *testing.T, d Dealt) string {
	t.Helper()
	b, err := json.Marshal(d.View())
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// shown is a list the view shows ("choices", "items").
func shown(t *testing.T, d Dealt, field string) []string {
	t.Helper()
	var v map[string]json.RawMessage
	_ = json.Unmarshal([]byte(viewJSON(t, d)), &v)
	var list []string
	if err := json.Unmarshal(v[field], &list); err != nil {
		t.Fatal(err)
	}
	return list
}

func grade(t *testing.T, d Dealt, answer string) Graded {
	t.Helper()
	g, err := d.Grade(json.RawMessage(answer))
	if err != nil {
		t.Fatalf("grading %s: %v", answer, err)
	}
	return g
}

func revealed(t *testing.T, d Dealt) map[string]any {
	t.Helper()
	var r map[string]any
	b, _ := json.Marshal(d.Reveal(nil))
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestDealsAreStableAndShuffled(t *testing.T) {
	b := loadSample(t)
	q := b.Live("", "choice")[0]
	if viewJSON(t, q.Deal(42)) != viewJSON(t, q.Deal(42)) {
		t.Fatal("the same seed dealt two ways")
	}
	// Over many deals the answer lands in every place, and the view never says which one it is.
	places := map[int]bool{}
	for seed := range uint64(64) {
		d := q.Deal(seed)
		places[int(revealed(t, d)["pick"].(float64))] = true
		if strings.Contains(viewJSON(t, d), `"answer"`) {
			t.Fatal("the view gives the answer away")
		}
	}
	if len(places) != ChoiceOptions {
		t.Errorf("the answer only landed in places %v", places)
	}
}

func TestChoiceGrading(t *testing.T) {
	q := &Choice{Head: Head{Type: "choice"}, Answer: "Мусала", Wrong: []string{"Вихрен", "Ботев", "Черни връх"}}
	for seed := range uint64(16) {
		d := q.Deal(seed)
		right := int(revealed(t, d)["pick"].(float64))
		for pick := range ChoiceOptions {
			g := grade(t, d, `{"pick":`+string(rune('0'+pick))+`}`)
			var given ChoiceAnswer
			_ = json.Unmarshal(g.Given, &given)
			chosen := q.options()[given.Pick]
			if was := shown(t, d, "choices")[pick]; chosen != was {
				t.Fatalf("logged %q for a pick of %q", chosen, was)
			}
			if g.Right != (pick == right) || g.Right != (chosen == "Мусала") || (g.Score == 1) != g.Right {
				t.Fatalf("pick %d (right %d) graded %+v", pick, right, g)
			}
		}
	}
	d := q.Deal(1)
	for _, bad := range []string{`{"pick":4}`, `{"pick":-1}`, `{}`, `{"pick":1,"extra":1}`, `{"pick":"1"}`, `1`} {
		if _, err := d.Grade(json.RawMessage(bad)); err == nil {
			t.Errorf("%s was graded", bad)
		}
	}
}

func TestNumberGrading(t *testing.T) {
	year := &Number{Head: Head{Type: "number"}, Answer: 1878, Step: 1, Scale: "linear", Tolerance: 20}
	d := year.Deal(0)
	for _, c := range []struct {
		guess        string
		score        float64
		right, exact bool
	}{
		{"1878", 1, true, true},
		{"1878.4", 1, true, true}, // onto the grid
		{"1868", 0.5, false, false},
		{"1882", 0.8, true, false},
		{"1700", 0, false, false},
		{"99999", 0, false, false},
	} {
		g := grade(t, d, `{"value":`+c.guess+`}`)
		if abs := g.Score - c.score; abs > 1e-9 || abs < -1e-9 || g.Right != c.right || g.Exact != c.exact {
			t.Errorf("%s graded %+v, want score %v right %v exact %v", c.guess, g, c.score, c.right, c.exact)
		}
	}
	if g := grade(t, d, `{"value":1877.6}`); string(g.Given) != `{"value":1878}` {
		t.Errorf("logged %s for a guess off the grid", g.Given)
	}

	// On a log scale a tolerance is a factor: twice too big with a tolerance of 4 is half off.
	people := &Number{Head: Head{Type: "number"}, Answer: 1000, Step: 1, Scale: "log", Tolerance: 4}
	if g := grade(t, people.Deal(0), `{"value":2000}`); g.Score < 0.499 || g.Score > 0.501 {
		t.Errorf("twice too big scored %v", g.Score)
	}
	if g := grade(t, people.Deal(0), `{"value":250}`); g.Score != 0 {
		t.Errorf("four times too small scored %v", g.Score)
	}
	for _, bad := range []string{`{}`, `{"value":"5"}`, `{"value":1,"unit":"x"}`, `{"value":1e300}`} {
		if _, err := d.Grade(json.RawMessage(bad)); err == nil {
			t.Errorf("%s was graded", bad)
		}
	}
}

func TestOrderGrading(t *testing.T) {
	q := &Order{Head: Head{Type: "order"}, Direction: "asc", Items: []OrderItem{
		{"Съединението", 1885}, {"Априлското въстание", 1876}, {"Балканската война", 1912}, {"Независимостта", 1908},
	}}
	for seed := range uint64(16) {
		d := q.Deal(seed)
		r := revealed(t, d)
		var order []int
		for _, v := range r["order"].([]any) {
			order = append(order, int(v.(float64)))
		}
		answer, _ := json.Marshal(OrderAnswer{Order: order})
		g := grade(t, d, string(answer))
		if !g.Right || g.Score != 1 || string(g.Given) != `{"order":[1,0,3,2]}` {
			t.Fatalf("the revealed order graded %+v (given %s)", g, g.Given)
		}
		// The values shown with the answer are in the order the items were shown, so they line up.
		items := shown(t, d, "items")
		for i, v := range r["values"].([]any) {
			if it := q.Items[slices.IndexFunc(q.Items, func(it OrderItem) bool { return it.Text == items[i] })]; it.Value != v.(float64) {
				t.Fatalf("%s shown with %v", it.Text, v)
			}
		}
		// Two neighbours swapped: five pairs of six the right way, one the wrong way.
		swapped := slices.Clone(order)
		swapped[1], swapped[2] = swapped[2], swapped[1]
		answer, _ = json.Marshal(OrderAnswer{Order: swapped})
		if g := grade(t, d, string(answer)); g.Right || math.Abs(g.Score-2.0/3) > 1e-9 {
			t.Fatalf("two neighbours swapped graded %+v", g)
		}
		slices.Reverse(order)
		answer, _ = json.Marshal(OrderAnswer{Order: order})
		if g := grade(t, d, string(answer)); g.Right || g.Score != 0 {
			t.Fatalf("the reverse order graded %+v", g)
		}
	}
	d := q.Deal(3)
	for _, bad := range []string{`{"order":[0,1,2]}`, `{"order":[0,1,2,2]}`, `{"order":[0,1,2,4]}`, `{}`} {
		if _, err := d.Grade(json.RawMessage(bad)); err == nil {
			t.Errorf("%s was graded", bad)
		}
	}
}

// A broken bank is refused, and each problem says where it is.
func TestLoadFindsProblems(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) {
		path := filepath.Join(dir, name)
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(CategoriesFile, `[{"id": "history", "name": "История"}]`)
	write("questions/history.json", `[
  {"id": "his-001", "type": "choice", "difficulty": "easy", "text": "Кога?", "answer": "1878", "wrong": ["1876", "1885", "1908"]},
  {"id": "his-001", "type": "choice", "difficulty": "easy", "text": "Кой?", "answer": "А", "wrong": ["Б", "В", "Г"]},
  {"id": "his-003", "type": "choice", "difficulty": "easy", "text": "Кога?", "answer": "1878", "wrong": ["1876", "1885", "1908"]},
  {"id": "his-004", "type": "riddle", "difficulty": "easy", "text": "?"},
  {"id": "his-005", "type": "choice", "difficulty": "easy", "text": "Защо?", "answer": "А", "wrong": ["Б", "В", "Г"], "typo": 1},
  {"id": "his-006", "type": "choice", "difficulty": "easy", "text": "Как?", "answer": "А", "wrong": ["Б", "а"], "fact": "Факт.", "factSource": "https://bg.wikipedia.org/"},
  {"id": "his-009", "type": "choice", "difficulty": "easy", "text": "Как ли?", "answer": "А", "wrong": ["Б", "а"]},
  {"id": "his-007", "type": "number", "difficulty": "hard", "text": "Колко?", "answer": 10.5, "step": 1, "scale": "linear", "tolerance": 5},
  {"id": "his-008", "type": "choice", "difficulty": "easy", "text": "Чие?", "answer": "А", "wrong": ["Б", "В", "Г"],
   "image": {"file": "0123456789abcdef.webp", "w": 1200, "h": 800, "alt": "Знаме", "credit": "Някой", "license": "PD", "source": "https://commons.wikimedia.org/"}},
  {"id": "his-010", "type": "choice", "difficulty": "easy", "text": "Кой цар?", "answer": "Иван Грозни", "wrong": ["Иван Грозн\u044bй", "Борис", "Петър"], "fact": "„Тел\u0451нок“ и „м\u044dр“."}
]
`)
	write("questions/sports.json", `[]`)
	b, problems := Load(dir)
	if b != nil {
		t.Fatal("a broken bank loaded")
	}
	var got []string
	for _, p := range problems {
		got = append(got, p.String())
	}
	all := strings.Join(got, "\n")
	for _, want := range []string{
		"questions/sports.json: not a category's file",
		"questions/history.json:3: his-001: the id is taken (questions/history.json:2)",
		"questions/history.json:4: his-003: the same question as his-001",
		`questions/history.json:5: his-004: unknown type "riddle"`,
		`questions/history.json:6: his-005: json: unknown field "typo"`,
		`questions/history.json:7: his-006: json: unknown field "factSource"`,
		"questions/history.json:8: his-009: a choice needs exactly 3 wrong options",
		"questions/history.json:8: his-009: two options are the same: а",
		"questions/history.json:9: his-007: the answer isn't on the step grid",
		"questions/history.json:10: his-008: missing picture 0123456789abcdef.webp",
		"questions/history.json:12: his-010: fact has \u0451, a letter Bulgarian doesn't use",
		"questions/history.json:12: his-010: option has \u044b, a letter Bulgarian doesn't use",
	} {
		if !strings.Contains(all, want) {
			t.Errorf("missing %q in:\n%s", want, all)
		}
	}
}

func TestWebpSize(t *testing.T) {
	b := loadSample(t)
	for _, q := range b.Questions {
		im := q.Extra().Image
		if im == nil {
			continue
		}
		w, h, err := webpSize(filepath.Join(sample, ImagesDir, im.File))
		if err != nil || w != im.W || h != im.H {
			t.Errorf("%s: %d×%d %v, want %d×%d", im.File, w, h, err, im.W, im.H)
		}
	}
}

func TestNewQuestionRules(t *testing.T) {
	q := func(tail Tail) Question {
		return &Choice{Head: Head{ID: "his-001", Type: "choice", Difficulty: Easy, Text: "Кой?"}, Answer: "А",
			Wrong: []string{"Б", "В", "Г"}, Tail: tail}
	}
	for _, c := range []struct {
		tail Tail
		want string
	}{
		{Tail{Added: "2026-11-01"}, ""}, // from before the rules: gone over later
		{Tail{Added: RulesFrom}, "needs a fact"},
		{Tail{Added: RulesFrom, Fact: "Факт."}, "needs updated"},
		{Tail{Added: RulesFrom, Fact: "Факт.", Updated: RulesFrom}, ""},
		{Tail{Added: "2026-11-20", Updated: "2026-11-19", Fact: "Факт."}, "updated is before added"},
		{Tail{Updated: "13.11.2026"}, "updated must be a date"},
	} {
		errs, _ := checkQuestion(q(c.tail), "2026-11-25")
		all := strings.Join(errs, "; ")
		if (c.want == "") != (all == "") || !strings.Contains(all, c.want) {
			t.Errorf("%+v: got %q, want %q", c.tail, all, c.want)
		}
	}
}

func TestBalance(t *testing.T) {
	b := loadSample(t)
	bal := b.BalanceOf()
	if bal.Total != len(b.Live("", "")) {
		t.Fatalf("counted %d of %d", bal.Total, len(b.Live("", "")))
	}
	// The full balance: each cell's gap brings it to the aim, and Off counts every question out of place.
	off := 0
	for _, c := range b.Categories {
		for _, typ := range TypeOrder {
			for _, d := range Difficulties {
				g := bal.Gaps[c.ID][typ][d]
				if bal.Cells[c.ID][typ][d]+g != Want(bal.Target, typ, d) {
					t.Errorf("%s %s %s: %d %+d is not the aim %d", c.ID, typ, d, bal.Cells[c.ID][typ][d], g, Want(bal.Target, typ, d))
				}
				off += max(g, -g)
			}
		}
	}
	if off != bal.Off || bal.Target != steady(bal.Cells) {
		t.Errorf("off %d (counted %d), target %d", bal.Off, off, bal.Target)
	}
	sum := 0.0
	for _, share := range TypeMix {
		sum += share
	}
	if math.Abs(sum-1) > 1e-9 || len(TypeMix) != len(Types()) {
		t.Fatalf("the kinds' aim adds up to %v over %d kinds (of %d)", sum, len(TypeMix), len(Types()))
	}
}

// The target is the smallest size whose aims cover every kind and every difficulty, and it's steady: a bank filled
// exactly to its aims keeps that size (the aims, rounded per cell, don't ask for a bigger one).
func TestSteadyTarget(t *testing.T) {
	filled := func(size int) map[string]map[string]map[Difficulty]int {
		kinds := map[string]map[Difficulty]int{}
		for _, k := range TypeOrder {
			kinds[k] = map[Difficulty]int{}
			for _, d := range Difficulties {
				kinds[k][d] = Want(size, k, d)
			}
		}
		return map[string]map[string]map[Difficulty]int{"a": kinds}
	}
	for _, size := range []int{25, 100, 600, 657, 660, 667, 680, 1000} {
		if got := steady(filled(size)); got > size {
			t.Errorf("filled to the aims of %d, the target is %d", size, got)
		}
		// One more of the largest cell needs a bigger size.
		cells := filled(size)
		cells["a"]["choice"][Easy]++
		if got := steady(cells); got <= size {
			t.Errorf("one more than the aims of %d still fits in %d", size, got)
		}
	}
	// The minimum: one size less doesn't fit.
	cells := filled(657)
	if got := steady(cells); got > 657 || got < 640 {
		t.Errorf("the aims of 657 make a target of %d", got)
	}
}

func TestTrueFalseGrading(t *testing.T) {
	q := &TrueFalse{Head: Head{Type: "truefalse", Text: "Китът е бозайник."}, Answer: true}
	d := q.Deal(7)
	if g := grade(t, d, `{"truth":true}`); !g.Right || g.Score != 1 {
		t.Errorf("the truth graded %+v", g)
	}
	if g := grade(t, d, `{"truth":false}`); g.Right || g.Score != 0 || string(g.Given) != `{"truth":false}` {
		t.Errorf("not the truth graded %+v", g)
	}
	for _, bad := range []string{`{}`, `{"truth":"да"}`, `{"truth":true,"x":1}`, `true`} {
		if _, err := d.Grade(json.RawMessage(bad)); err == nil {
			t.Errorf("%s was graded", bad)
		}
	}
	if p := (&TrueFalse{Head: Head{Text: "Китът е бозайник?"}}).check(); len(p) == 0 {
		t.Error("a question passed as a statement")
	}
}

func TestMatchGrading(t *testing.T) {
	q := &Match{Head: Head{Type: "match", Text: "Свържи:"}, Pairs: []MatchPair{
		{"Франция", "Париж"}, {"Италия", "Рим"}, {"Испания", "Мадрид"}, {"Гърция", "Атина"},
	}}
	for seed := range uint64(20) {
		d := q.Deal(seed).(*dealtMatch)
		var view struct{ Left, Right []string }
		_ = json.Unmarshal(mustJSON(d.View()), &view)
		// The right answer, worked out from the view the way a player would.
		capital := map[string]string{"Франция": "Париж", "Италия": "Рим", "Испания": "Мадрид", "Гърция": "Атина"}
		right := make([]int, 4)
		for i, l := range view.Left {
			right[i] = slices.Index(view.Right, capital[l])
		}
		if g := grade(t, d, string(mustJSON(MatchAnswer{Pairs: right}))); !g.Right || g.Score != 1 {
			t.Fatalf("seed %d: all right graded %+v", seed, g)
		}
		var rev struct{ Pairs []int }
		_ = json.Unmarshal(mustJSON(d.Reveal(nil)), &rev)
		if !slices.Equal(rev.Pairs, right) {
			t.Fatalf("seed %d: revealed %v, right %v", seed, rev.Pairs, right)
		}
		// Two swapped: two right, less two wrong at a third each; one left out: three of four, nothing taken.
		swapped := slices.Clone(right)
		swapped[0], swapped[1] = swapped[1], swapped[0]
		if g := grade(t, d, string(mustJSON(MatchAnswer{Pairs: swapped}))); g.Right || math.Abs(g.Score-1.0/3) > 1e-9 {
			t.Fatalf("seed %d: two swapped graded %+v", seed, g)
		}
		partial := slices.Clone(right)
		partial[3] = -1
		if g := grade(t, d, string(mustJSON(MatchAnswer{Pairs: partial}))); g.Right || g.Score != 0.75 {
			t.Fatalf("seed %d: one left out graded %+v", seed, g)
		}
	}
	d := q.Deal(1)
	for _, bad := range []string{`{"pairs":[0,0,1,2]}`, `{"pairs":[0,1,2]}`, `{"pairs":[0,1,2,4]}`, `{"pairs":[0,1,2,-2]}`, `{}`} {
		if _, err := d.Grade(json.RawMessage(bad)); err == nil {
			t.Errorf("%s was graded", bad)
		}
	}
}

// Luck earns little: an order or a match put down at random is worth next to nothing on average.
func TestLuckTakenOut(t *testing.T) {
	perms := [][]int{}
	var permute func([]int, int)
	permute = func(a []int, k int) {
		if k == len(a) {
			perms = append(perms, slices.Clone(a))
			return
		}
		for i := k; i < len(a); i++ {
			a[k], a[i] = a[i], a[k]
			permute(a, k+1)
			a[k], a[i] = a[i], a[k]
		}
	}
	permute([]int{0, 1, 2, 3}, 0)
	var order, match float64
	for _, p := range perms {
		order += orderScore(p, []int{0, 1, 2, 3})
		right := 0
		for i, v := range p {
			if i == v {
				right++
			}
		}
		match += matchScore(right, 4-right, 4, 4)
	}
	order, match = order/float64(len(perms)), match/float64(len(perms))
	if math.Abs(order-7.0/36) > 1e-9 || math.Abs(match-0.125) > 1e-9 {
		t.Errorf("at random: an order is worth %v, a match %v", order, match)
	}
	// With a decoy: the four lefts joined at random to four of five rights.
	decoy, n := 0.0, 0
	for _, p := range injections(4, 5) {
		right := 0
		for i, v := range p {
			if i == v {
				right++
			}
		}
		decoy += matchScore(right, 4-right, 4, 5)
		n++
	}
	if decoy /= float64(n); math.Abs(decoy-53.0/480) > 1e-9 {
		t.Errorf("at random: a match with a decoy is worth %v", decoy)
	}
}

// injections lists every way to give each of k things a different one of n.
func injections(k, n int) [][]int {
	if k == 0 {
		return [][]int{{}}
	}
	var out [][]int
	for _, p := range injections(k-1, n) {
		for v := range n {
			if !slices.Contains(p, v) {
				out = append(out, append(slices.Clone(p), v))
			}
		}
	}
	return out
}

func TestMatchDecoy(t *testing.T) {
	q := &Match{Head: Head{Type: "match", Text: "Свържи:"}, Pairs: []MatchPair{
		{"Австралия", "Канбера"}, {"Канада", "Отава"}, {"Турция", "Анкара"}, {"Нигерия", "Абуджа"},
	}, Decoy: "Сидни"}
	capital := map[string]string{"Австралия": "Канбера", "Канада": "Отава", "Турция": "Анкара", "Нигерия": "Абуджа"}
	for seed := range uint64(20) {
		d := q.Deal(seed)
		var view struct{ Left, Right []string }
		_ = json.Unmarshal(mustJSON(d.View()), &view)
		if len(view.Left) != 4 || len(view.Right) != 5 || !slices.Contains(view.Right, "Сидни") {
			t.Fatalf("seed %d: dealt %v / %v", seed, view.Left, view.Right)
		}
		right := make([]int, 4)
		for i, l := range view.Left {
			right[i] = slices.Index(view.Right, capital[l])
		}
		if g := grade(t, d, string(mustJSON(MatchAnswer{Pairs: right}))); !g.Right || g.Score != 1 {
			t.Fatalf("seed %d: all right graded %+v", seed, g)
		}
		var rev struct {
			Pairs []int
			Decoy *int
		}
		_ = json.Unmarshal(mustJSON(d.Reveal(nil)), &rev)
		if !slices.Equal(rev.Pairs, right) || rev.Decoy == nil || view.Right[*rev.Decoy] != "Сидни" {
			t.Fatalf("seed %d: revealed %+v", seed, rev)
		}
		// Three right and the fourth on the decoy: three quarters, less a quarter of one.
		trap := slices.Clone(right)
		trap[0] = *rev.Decoy
		g := grade(t, d, string(mustJSON(MatchAnswer{Pairs: trap})))
		if g.Right || math.Abs(g.Score-(3-0.25)/4) > 1e-9 {
			t.Fatalf("seed %d: three and the decoy graded %+v", seed, g)
		}
		// The log keeps the decoy as the place past the pairs, whatever the deal.
		var given MatchAnswer
		_ = json.Unmarshal(g.Given, &given)
		if !slices.Contains(given.Pairs, 4) {
			t.Fatalf("seed %d: logged %v", seed, given.Pairs)
		}
	}
	if p := (&Match{Pairs: q.Pairs, Decoy: "Отава"}).check(); len(p) == 0 {
		t.Error("a decoy that is one of the rights passed")
	}
	if _, err := q.Deal(1).Grade(json.RawMessage(`{"pairs":[0,1,2,5]}`)); err == nil {
		t.Error("a right past the column was graded")
	}
}

func TestSplitGrading(t *testing.T) {
	q := &Split{Head: Head{Type: "split", Text: "Бозайник ли е?"}, Groups: [2]string{"Бозайник", "Не е бозайник"},
		Items: []SplitItem{{"Делфин", 0}, {"Прилеп", 0}, {"Кит", 0}, {"Пингвин", 1}, {"Акула", 1}, {"Костенурка", 1}}}
	if p := q.check(); len(p) > 0 {
		t.Fatal(p)
	}
	group := map[string]int{"Делфин": 0, "Прилеп": 0, "Кит": 0, "Пингвин": 1, "Акула": 1, "Костенурка": 1}
	for seed := range uint64(20) {
		d := q.Deal(seed)
		var view struct{ Items []string }
		_ = json.Unmarshal(mustJSON(d.View()), &view)
		right := make([]int, len(view.Items))
		for i, it := range view.Items {
			right[i] = group[it]
		}
		if g := grade(t, d, string(mustJSON(SplitAnswer{Sides: right}))); !g.Right || g.Score != 1 {
			t.Fatalf("seed %d: all right graded %+v", seed, g)
		}
		var rev struct{ Sides []int }
		_ = json.Unmarshal(mustJSON(d.Reveal(nil)), &rev)
		if !slices.Equal(rev.Sides, right) {
			t.Fatalf("seed %d: revealed %v, right %v", seed, rev.Sides, right)
		}
		// One sent wrong: five right less one; one left where it is: five of six, nothing taken.
		wrong := slices.Clone(right)
		wrong[0] = 1 - wrong[0]
		if g := grade(t, d, string(mustJSON(SplitAnswer{Sides: wrong}))); g.Right || math.Abs(g.Score-4.0/6) > 1e-9 {
			t.Fatalf("seed %d: one wrong graded %+v", seed, g)
		}
		left := slices.Clone(right)
		left[5] = -1
		g := grade(t, d, string(mustJSON(SplitAnswer{Sides: left})))
		if g.Right || math.Abs(g.Score-5.0/6) > 1e-9 {
			t.Fatalf("seed %d: one left graded %+v", seed, g)
		}
		// The log keeps the bank's order, whatever the deal.
		var given SplitAnswer
		_ = json.Unmarshal(g.Given, &given)
		for b, it := range q.Items {
			if given.Sides[b] != -1 && given.Sides[b] != it.Group {
				t.Fatalf("seed %d: logged %v", seed, given.Sides)
			}
		}
	}
	for _, bad := range []string{`{"sides":[0,1,0,1,0]}`, `{"sides":[0,1,0,1,0,2]}`, `{}`} {
		if _, err := q.Deal(1).Grade(json.RawMessage(bad)); err == nil {
			t.Errorf("%s was graded", bad)
		}
	}
	lone := *q
	lone.Items = slices.Clone(q.Items)
	lone.Items[3].Group, lone.Items[4].Group = 0, 0
	if p := lone.check(); len(p) == 0 {
		t.Error("a split with one item in a group passed")
	}
	// Six items sent at random: worth 5/32 on average.
	sum := 0.0
	for mask := range 64 {
		right := 0
		for i := range 6 {
			if mask>>i&1 == 1 {
				right++
			}
		}
		sum += splitScore(right, 6-right, 6)
	}
	if math.Abs(sum/64-5.0/32) > 1e-9 {
		t.Errorf("at random a split is worth %v", sum/64)
	}
}

func TestClues(t *testing.T) {
	q := &Clues{Head: Head{Type: "clues", Text: "Кой е този човек?"},
		Clues:  []string{"Като млад става йеродякон.", "Създава мрежа от тайни комитети.", "Обесен е край София през 1873 г."},
		Answer: "Васил Левски", Wrong: []string{"Христо Ботев", "Георги Раковски", "Любен Каравелов"}}
	if p := q.check(); len(p) > 0 {
		t.Fatal(p)
	}
	d := q.Deal(3)
	var view struct {
		Clues   []string
		Choices []string
	}
	shown := func(since time.Duration) []string {
		_ = json.Unmarshal(mustJSON(ViewAt(d, since)), &view)
		return view.Clues
	}
	// A clue shows only once its time has come: never before, not even in what the server sends.
	for since, want := range map[time.Duration]int{0: 1, ClueEvery - time.Millisecond: 1, ClueEvery: 2, 2*ClueEvery + time.Second: 3, time.Hour: 3} {
		if got := shown(since); len(got) != want || got[0] != q.Clues[0] {
			t.Errorf("after %v: %v", since, got)
		}
	}
	if s := mustJSON(d.View()); strings.Contains(string(s), "1873") {
		t.Error("the first view gave the last clue away")
	}
	if NextStep(d, 0) != ClueEvery || NextStep(d, ClueEvery+time.Second) != ClueEvery-time.Second || NextStep(d, time.Hour) != 0 {
		t.Error("the next clue's time")
	}
	right := slices.Index(view.Choices, "Васил Левски")
	pick := string(mustJSON(ChoiceAnswer{Pick: right}))
	// A right answer is worth less with each clue it took (allowing a second for its trip); a wrong one nothing.
	for took, want := range map[time.Duration]float64{
		3 * time.Second: 1, ClueEvery + 500*time.Millisecond: 1, ClueEvery + 2*time.Second: 0.6, 25 * time.Second: 0.3, time.Hour: 0.3,
	} {
		g, err := GradeAt(d, json.RawMessage(pick), took)
		if err != nil || !g.Right || g.Score != want {
			t.Errorf("right after %v: %+v %v", took, g, err)
		}
	}
	if g, _ := GradeAt(d, mustJSON(ChoiceAnswer{Pick: (right + 1) % 4}), time.Second); g.Right || g.Score != 0 {
		t.Errorf("a wrong one: %+v", g)
	}
	var rev struct {
		Pick  int
		Clues []string
	}
	_ = json.Unmarshal(mustJSON(d.Reveal(nil)), &rev)
	if rev.Pick != right || len(rev.Clues) != 3 {
		t.Errorf("revealed %+v", rev)
	}
	// Other kinds aren't paced: their view is the same whenever.
	c := &Choice{Head: Head{Type: "choice", Text: "?"}, Answer: "а", Wrong: []string{"б", "в", "г"}}
	if dc := c.Deal(1); NextStep(dc, 0) != 0 || string(mustJSON(ViewAt(dc, time.Hour))) != string(mustJSON(dc.View())) {
		t.Error("a choice was paced")
	}
}

func TestChoiceOfPictures(t *testing.T) {
	pic := func(file, alt string) Image {
		return Image{File: file, W: 1200, H: 720, Alt: alt, Credit: "неизвестен автор", License: "PD",
			Source: "https://commons.wikimedia.org/wiki/File:Flag.svg"}
	}
	q := &Choice{Head: Head{Type: "choice", Difficulty: Medium, Text: "Кое е знамето на Литва?"}, Answer: "Литва",
		Wrong: []string{"Боливия", "Унгария", "Габон"},
		Pictures: []Image{
			pic("0000000000000001.webp", "Три ивици: жълта, зелена, червена"),
			pic("0000000000000002.webp", "Три ивици: червена, жълта, зелена"),
			pic("0000000000000003.webp", "Три ивици: червена, бяла, зелена"),
			pic("0000000000000004.webp", "Три ивици: зелена, жълта, синя"),
		}}
	if p := q.check(); len(p) > 0 {
		t.Fatal(p)
	}
	for seed := range uint64(10) {
		d := q.Deal(seed)
		var view struct {
			Pictures []ImageView
			Choices  []string
		}
		_ = json.Unmarshal(mustJSON(d.View()), &view)
		// The pictures only: no option's name shows before the answer.
		pics := string(mustJSON(view.Pictures))
		for _, name := range q.options() {
			if strings.Contains(pics, name) || view.Choices != nil {
				t.Fatalf("seed %d: the view names %s: %s", seed, name, pics)
			}
		}
		var rev struct {
			Pick    int
			Names   []string
			Credits []ImageCredit
		}
		_ = json.Unmarshal(mustJSON(d.Reveal(nil)), &rev)
		if len(view.Pictures) != 4 || rev.Names[rev.Pick] != "Литва" || len(rev.Credits) != 4 ||
			!strings.Contains(view.Pictures[rev.Pick].Src, "0000000000000001") {
			t.Fatalf("seed %d: view %+v, reveal %+v", seed, view, rev)
		}
	}
	if !HasPictures(q) {
		t.Error("a choice of pictures has none")
	}
	three := *q
	three.Pictures = q.Pictures[:3]
	if p := three.check(); len(p) == 0 {
		t.Error("a choice with three pictures passed")
	}
	both := *q
	both.Image = &q.Pictures[0]
	if p := both.check(); len(p) == 0 {
		t.Error("a choice of pictures with a picture over it passed")
	}
}

func TestAnswerTextIsBulgarian(t *testing.T) {
	for _, c := range []struct {
		q    Question
		want string
	}{
		{&Number{Answer: 40075, Step: 1, Unit: "км"}, "40 075 км"},
		{&Number{Answer: 6.5, Step: 0.1, Unit: "млн."}, "6,5 млн."},
		{&Number{Answer: -273.15, Step: 0.01}, "-273,15"},
		{&Number{Answer: 1876, Step: 1}, "1876"},
		{&Match{Pairs: []MatchPair{{Left: "Франция", Right: "Париж"}}, Decoy: "Сидни"}, "Франция — Париж"},
	} {
		if got := AnswerText(c.q); got != c.want {
			t.Errorf("%T: %q, want %q", c.q, got, c.want)
		}
	}
	o := &Order{Unit: "млн. км²", Items: []OrderItem{{Text: "Азия", Value: 44.6}, {Text: "Европа", Value: 10.18}}, Direction: "desc"}
	if got := AnswerText(o); !strings.Contains(got, "Азия (44,6 млн. км²)") {
		t.Errorf("order: %q", got)
	}
}
