package bank

import (
	"encoding/json"
	"fmt"
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

// ofType are a bank's questions of a kind, not retired, of a kind Off too (Live leaves those out): what a play already
// dealt one still shows.
func ofType(b *Bank, typ string) []Question {
	var out []Question
	for _, q := range b.Questions {
		if q.Base().Type == typ && !q.Extra().Retired {
			out = append(out, q)
		}
	}
	return out
}

// allOn deals every kind for the rest of a test, those Off too: a test of what the rules make of a kind while it's
// dealt. Not in a parallel test: Off is the package's.
func allOn(t *testing.T) {
	off := Off
	Off = map[string]string{}
	t.Cleanup(func() { Off = off })
}

func TestSampleLoads(t *testing.T) {
	b := loadSample(t)
	if len(b.Categories) == 0 || len(b.Questions) < 100 {
		t.Fatalf("a thin sample: %d categories, %d questions", len(b.Categories), len(b.Questions))
	}
	for _, typ := range Types() {
		if len(ofType(b, typ)) == 0 {
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

// A question's sources and its keepers' notes stay in the bank: no player is dealt them, every kind alike. Its fact
// comes with its answer only: in the reveal, never in what shows while it's asked (its view, a paced one's at every
// step, its pictures before its time), so it can't give the answer away.
func TestKeepersFieldsStayInTheBank(t *testing.T) {
	b := loadSample(t)
	const fact = "fact-with-the-answer"
	for _, typ := range Types() {
		q := ofType(b, typ)[0]
		tail := q.Extra()
		was := tail.Fact
		tail.Sources, tail.Checked, tail.CheckedBy = []string{"https://example.org/source"}, "2026-11-17", "keepers-only"
		tail.Fact = fact
		d := q.Deal(1)
		asked := []any{d.View(), PicturesView(d)}
		if p, ok := d.(Paced); ok {
			for _, s := range p.Steps() {
				asked = append(asked, ViewAt(d, s))
			}
		}
		view, _ := json.Marshal(asked)
		reveal, _ := json.Marshal(d.Reveal(nil))
		for _, s := range []string{"example.org", "keepers-only", "2026-11-17"} {
			if strings.Contains(string(view)+string(reveal), s) {
				t.Errorf("%s: a player is dealt %s", typ, s)
			}
		}
		if strings.Contains(string(view), fact) {
			t.Errorf("%s: the fact shows while the question is asked: %s", typ, view)
		}
		if !strings.Contains(string(reveal), fact) {
			t.Errorf("%s: the reveal has no fact: %s", typ, reveal)
		}
		tail.Sources, tail.Checked, tail.CheckedBy, tail.Fact = nil, "", "", was
	}
}

// The line of a question's day shows only with its answer, and only when it's dealt on that day („На този ден“):
// every kind alike.
func TestDaysLineOnlyOnItsDay(t *testing.T) {
	b := loadSample(t)
	const line = "На 16 декември 1982 г. умира Колин Чапман."
	for _, typ := range Types() {
		q := ofType(b, typ)[0]
		tail := q.Extra()
		on, day := tail.On, tail.Day
		tail.On, tail.Day = []string{"12-16"}, line
		d := q.Deal(1)
		view, _ := json.Marshal(d.View())
		if strings.Contains(string(view), "Чапман") {
			t.Errorf("%s: the day's line shows before the answer", typ)
		}
		for when, want := range map[string]bool{"2026-12-16": true, "2027-12-16": true, "2026-12-17": false, "": false} {
			reveal, _ := json.Marshal(RevealOn(d, nil, when))
			if got := strings.Contains(string(reveal), `"day":"`+line+`"`); got != want {
				t.Errorf("%s dealt for %q: the day's line shows %v, want %v: %s", typ, when, got, want, reveal)
			}
		}
		if reveal, _ := json.Marshal(d.Reveal(nil)); strings.Contains(string(reveal), "Чапман") {
			t.Errorf("%s: a plain reveal has the day's line", typ)
		}
		tail.On, tail.Day = on, day
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

// An order deals all four of its items, never in their right order, and is right or not: no „близо“.
func TestOrderGrading(t *testing.T) {
	q := &Order{Head: Head{Type: "order"}, Direction: "asc", Items: []OrderItem{
		{"Съединението", 1885}, {"Априлското въстание", 1876}, {"Балканската война", 1912}, {"Независимостта", 1908},
	}}
	year := func(text string) float64 {
		return q.Items[slices.IndexFunc(q.Items, func(it OrderItem) bool { return it.Text == text })].Value
	}
	deals := map[string]bool{} // the arrangements dealt
	for seed := range uint64(400) {
		d := q.Deal(seed)
		items := shown(t, d, "items")
		if len(items) != OrderItems {
			t.Fatalf("seed %d dealt %d items", seed, len(items))
		}
		deals[strings.Join(items, "|")] = true
		r := revealed(t, d)
		var order []int
		for _, v := range r["order"].([]any) {
			order = append(order, int(v.(float64)))
		}
		answer, _ := json.Marshal(OrderAnswer{Order: order})
		g := grade(t, d, string(answer))
		if !g.Right || g.Score != 1 {
			t.Fatalf("seed %d: the revealed order graded %+v", seed, g)
		}
		// The log keeps the bank's items, in the order given: the years rise.
		var given OrderAnswer
		_ = json.Unmarshal(g.Given, &given)
		for i := 1; i < len(given.Order); i++ {
			if q.Items[given.Order[i-1]].Value >= q.Items[given.Order[i]].Value {
				t.Fatalf("seed %d: logged %v", seed, given.Order)
			}
		}
		// The values shown with the answer are in the order the items were shown, so they line up.
		for i, v := range r["values"].([]any) {
			if year(items[i]) != v.(float64) {
				t.Fatalf("%s shown with %v", items[i], v)
			}
		}
		// Every other order is wrong, and worth nothing: an order is never „близо“, not even with one pair swapped.
		swapped := slices.Clone(order)
		swapped[0], swapped[1] = swapped[1], swapped[0]
		for _, other := range [][]int{swapped, {3, 2, 1, 0}, {0, 1, 2, 3}, {1, 0, 3, 2}} {
			if slices.Equal(other, order) {
				continue
			}
			answer, _ := json.Marshal(OrderAnswer{Order: other})
			if g := grade(t, d, string(answer)); g.Right || g.Score != 0 {
				t.Fatalf("seed %d: %v graded %+v", seed, other, g)
			}
		}
		// Left as dealt, it's never right: the deal is never in order already.
		if slices.Equal(order, []int{0, 1, 2, 3}) {
			t.Fatalf("seed %d dealt the right order", seed)
		}
	}
	// Every arrangement but the right one comes up: 23 of 24.
	if len(deals) != 23 {
		t.Errorf("400 seeds dealt %d arrangements", len(deals))
	}
	d := q.Deal(3)
	for _, bad := range []string{`{"order":[0,1]}`, `{"order":[0,1,2]}`, `{"order":[0,1,2,3,4]}`, `{"order":[0,1,1,2]}`, `{"order":[0,1,2,4]}`, `{}`} {
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
		// Since SourcesFrom: where it was checked, when and by what.
		{Tail{Added: SourcesFrom, Fact: "Факт.", Updated: SourcesFrom}, "needs its sources"},
		{Tail{Added: SourcesFrom, Fact: "Факт.", Updated: SourcesFrom, Sources: []string{"https://bg.wikipedia.org/wiki/А"}},
			"needs checked and checkedBy"},
		{Tail{Added: SourcesFrom, Fact: "Факт.", Updated: SourcesFrom, Sources: []string{"https://bg.wikipedia.org/wiki/А"},
			Checked: SourcesFrom, CheckedBy: "new-questions fable-5.2"}, ""},
		// Since TouchedFrom, a change needs them too.
		{Tail{Added: "2026-11-01", Fact: "Факт.", Updated: TouchedFrom}, "a question changed since"},
		{Tail{Added: "2026-11-01", Fact: "Факт.", Updated: TouchedFrom, Sources: []string{"https://bg.wikipedia.org/wiki/А"},
			Checked: TouchedFrom, CheckedBy: "fix-questions fable-5.2"}, ""},
		{Tail{Added: "2026-11-01", Fact: "Факт.", Updated: "2026-11-16"}, ""},
		// Since ShortFactsFrom, a new question's fact shows whole on a phone.
		{Tail{Added: ShortFactsFrom, Updated: ShortFactsFrom, Fact: strings.Repeat("Дума ", 30) + "край.", Sources: []string{"https://bg.wikipedia.org/wiki/А"},
			Checked: ShortFactsFrom, CheckedBy: "p"}, "fact is over 140"},
		{Tail{Added: "2026-11-01", Fact: strings.Repeat("Дума ", 30) + "край."}, ""},
		{Tail{Sources: []string{"bg.wikipedia.org/wiki/А"}}, "a source is a page's address"},
		{Tail{Checked: "2026-11-20"}, "checked and checkedBy go together"},
		{Tail{Added: "2026-11-01", Changed: "2026-11-05", Updated: "2026-11-03"}, "changed is between added and updated"},
		{Tail{Added: "2026-11-01", Changed: "2026-10-30"}, "changed is between added and updated"},
		{Tail{Retired: true, RetiredWhy: "old"}, "retiredWhy is one of"},
		{Tail{RetiredWhy: "wrong"}, "for a retired question"},
		{Tail{Retired: true, RetiredWhy: "wrong", ReplacedBy: "his-002"}, ""},
		// The day's line: with on, one short line.
		{Tail{On: []string{"12-16"}, Day: "На 16 декември 1982 г. умира Колин Чапман."}, ""},
		{Tail{Day: "На 16 декември 1982 г. умира Колин Чапман."}, "it goes with on"},
		{Tail{On: []string{"12-16"}, Day: "На 16 декември 1982 г. " + strings.Repeat("умира ", 15) + "Колин Чапман."}, "day is over 100"},
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
	// Each kind's gap brings it to its share of its category, and Off adds up what's to write.
	off := 0
	for _, c := range b.Categories {
		size := len(b.Live(c.ID, ""))
		for _, typ := range TypeOrder {
			g := bal.Gaps[c.ID][typ]
			if bal.Types[c.ID][typ]+g != Want(size, typ) {
				t.Errorf("%s %s: %d %+d is not the aim %d", c.ID, typ, bal.Types[c.ID][typ], g, Want(size, typ))
			}
			off += max(g, 0)
		}
	}
	if off != bal.Off {
		t.Errorf("off %d, counted %d", bal.Off, off)
	}
	sum := 0.0
	for _, share := range TypeMix {
		sum += share
	}
	dealt := slices.DeleteFunc(Types(), func(k string) bool { return !KindOn(k) })
	if math.Abs(sum-1) > 1e-9 || len(TypeMix) != len(dealt) || len(TypeOrder) != len(dealt) {
		t.Fatalf("the kinds' aim adds up to %v over %d kinds (%d in the reports, of %d dealt)", sum, len(TypeMix),
			len(TypeOrder), len(dealt))
	}
	// With every kind on, the aim is the owner's, every kind in it.
	if len(typeAim) != len(Types()) {
		t.Fatalf("the aim has %d kinds of %d", len(typeAim), len(Types()))
	}
	if _, ok := TypeMix["clues"]; ok {
		t.Error("clues are off (bank.Off), yet the bank aims for them")
	}
}

// „Подсказки“ are off (the owner, 2026-11-23): their questions stay in the bank as they are, but nothing deals them
// (Live), and no new one is written: bank add refuses one, and so does the check of a question added since.
func TestCluesOff(t *testing.T) {
	if KindOn("clues") || !KindOn("split") || !KindOn("match") || !KindOn("order") {
		t.Fatal("the kinds dealt aren't choice, true-or-not, number, order, match and split")
	}
	b := loadSample(t)
	if len(ofType(b, "clues")) == 0 {
		t.Fatal("the sample has no clues to keep")
	}
	if n := len(b.Live("", "clues")); n != 0 {
		t.Errorf("%d clues are live", n)
	}
	if slices.ContainsFunc(b.Live("", ""), func(q Question) bool { return q.Base().Type == "clues" }) {
		t.Error("clues among the live questions")
	}
	if Playable(ofType(b, "clues")[0]) {
		t.Error("a clues question is playable")
	}

	// A question added since the day clues went off is an error; one from before loads as it is.
	clues := func(added string) *Clues {
		return &Clues{Head: Head{ID: "gen-900", Type: "clues", Difficulty: Medium, Text: "Кой е този човек?"},
			Clues: []string{"Първо.", "Второ.", "Трето."}, Answer: "А", Wrong: []string{"Б", "В", "Г"},
			Tail: Tail{Fact: "Факт.", Added: added, Updated: added}}
	}
	off := func(errs []string) bool {
		return slices.ContainsFunc(errs, func(e string) bool { return strings.Contains(e, "no new clues question") })
	}
	if errs, _ := checkQuestion(clues(Off["clues"]), "2026-12-01"); !off(errs) {
		t.Errorf("a clues question added on the day they went off: %v", errs)
	}
	if errs, _ := checkQuestion(clues("2026-11-14"), "2026-12-01"); off(errs) {
		t.Errorf("an old clues question refused: %v", errs)
	}

	// bank add refuses a new clues question, and a change of a question into one.
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	batch := t.TempDir()
	q := ofType(b, "clues")[0]
	_, last := lastID(b.InCategory(q.Base().Category))
	prefix, _, _ := splitID(q.Base().ID)
	fresh := clues(time.Now().Format(time.DateOnly))
	fresh.ID, fresh.Category = fmt.Sprintf("%s-%d", prefix, last+1), q.Base().Category
	data, _ := Format([]Question{fresh})
	if err := os.WriteFile(filepath.Join(batch, q.Base().Category+".json"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Add(dir, batch, "test", true); err == nil || !strings.Contains(err.Error(), "no new clues question") {
		t.Errorf("bank add took a new clues question: %v", err)
	}
	choice := ofType(b, "choice")[0]
	into := clues("2026-11-14")
	into.ID, into.Category = choice.Base().ID, choice.Base().Category
	data, _ = Format([]Question{into})
	batch = t.TempDir()
	if err := os.WriteFile(filepath.Join(batch, into.Category+".json"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Add(dir, batch, "test", true); err == nil || !strings.Contains(err.Error(), "no new clues question") {
		t.Errorf("bank add turned a choice into clues: %v", err)
	}
}

// The categories are about the same size: within SizeSlack of the mean, not exactly.
func TestUneven(t *testing.T) {
	b := &Bank{Categories: []Category{{"a", "А"}, {"b", "Б"}, {"c", "В"}}, byID: map[string]Question{}}
	add := func(cat string, n int) {
		for range n {
			q := &TrueFalse{Head: Head{Category: cat}}
			b.Questions = append(b.Questions, q)
		}
	}
	add("a", 100)
	add("b", 101)
	add("c", 99)
	if off, mean := b.Uneven(); len(off) != 0 || mean != 100 {
		t.Errorf("100, 101, 99: off %v (mean %v)", off, mean)
	}
	add("a", 5)
	add("c", 2)
	if off, _ := b.Uneven(); len(off) != 1 || off[0].Category != "a" {
		t.Errorf("105, 101, 101 (mean 102.3, 2.05 either way): off %v", off)
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

// A match is right or not: every pair joined right, or nothing: no „близо“ (the number's alone), no part of a score.
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
		// Two swapped, or one left out: not right, and worth nothing.
		swapped := slices.Clone(right)
		swapped[0], swapped[1] = swapped[1], swapped[0]
		if g := grade(t, d, string(mustJSON(MatchAnswer{Pairs: swapped}))); g.Right || g.Score != 0 {
			t.Fatalf("seed %d: two swapped graded %+v", seed, g)
		}
		partial := slices.Clone(right)
		partial[3] = -1
		if g := grade(t, d, string(mustJSON(MatchAnswer{Pairs: partial}))); g.Right || g.Score != 0 {
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
		// Three right and the fourth on the decoy: not right, and worth nothing.
		trap := slices.Clone(right)
		trap[0] = *rev.Decoy
		g := grade(t, d, string(mustJSON(MatchAnswer{Pairs: trap})))
		if g.Right || g.Score != 0 {
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

// A split is right or not: every item in its group, or nothing.
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
		// One sent wrong, or one left where it is: not right, and worth nothing.
		wrong := slices.Clone(right)
		wrong[0] = 1 - wrong[0]
		if g := grade(t, d, string(mustJSON(SplitAnswer{Sides: wrong}))); g.Right || g.Score != 0 {
			t.Fatalf("seed %d: one wrong graded %+v", seed, g)
		}
		left := slices.Clone(right)
		left[5] = -1
		g := grade(t, d, string(mustJSON(SplitAnswer{Sides: left})))
		if g.Right || g.Score != 0 {
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
	// A right answer is worth less with each clue it took; a wrong one nothing.
	for took, want := range map[time.Duration]float64{
		3 * time.Second: 1, ClueEvery + 2*time.Second: 0.6, 25 * time.Second: 0.3, time.Hour: 0.3,
	} {
		g, err := GradeAt(d, json.RawMessage(pick), took)
		if err != nil || !g.Right || g.Score != want {
			t.Errorf("right after %v: %+v %v", took, g, err)
		}
	}
	// What's shown and what's paid agree to the millisecond: an answer that came once the next clue was sent is worth
	// that clue's, never the one before (a script that read it at once and answered in its trip's second was paid
	// the first's: review 2026-11-18, S27).
	worth := []float64{1, 0.6, 0.3}
	for _, since := range []time.Duration{ClueEvery - time.Millisecond, ClueEvery, ClueEvery + 500*time.Millisecond,
		ClueEvery + 999*time.Millisecond, 2*ClueEvery - time.Millisecond, 2 * ClueEvery, 2*ClueEvery + 900*time.Millisecond} {
		g, _ := GradeAt(d, json.RawMessage(pick), since)
		if out := len(shown(since)); g.Score != worth[out-1] {
			t.Errorf("after %v: %d clues shown, paid %v", since, out, g.Score)
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
		{&Number{Answer: -273.15, Step: 0.01}, "−273,15"},
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

// An answer of parts is a line each for the book's entry (a short headword over them, not one of six lines); an
// answer of one word or number has none.
func TestAnswerLines(t *testing.T) {
	o := &Order{Unit: "млн. км²", Items: []OrderItem{{Text: "Европа", Value: 10.18}, {Text: "Азия", Value: 44.6}}, Direction: "desc"}
	s := &Split{Groups: [2]string{"Шекспир", "Молиер"}, Items: []SplitItem{{"Просперо", 0}, {"Тартюф", 1}, {"Миранда", 0}}}
	m := &Match{Pairs: []MatchPair{{Left: "Франция", Right: "Париж"}, {Left: "Италия", Right: "Рим"}}, Decoy: "Сидни"}
	for _, c := range []struct {
		q    Question
		want []string
	}{
		{o, []string{"Азия (44,6 млн. км²)", "Европа (10,18 млн. км²)"}},
		{s, []string{"Шекспир: Просперо, Миранда", "Молиер: Тартюф"}},
		{m, []string{"Франция — Париж", "Италия — Рим"}},
		{&Number{Answer: 1876, Step: 1}, nil},
		{&TrueFalse{Answer: true}, nil},
	} {
		if got := AnswerLines(c.q); !slices.Equal(got, c.want) {
			t.Errorf("%T: %q, want %q", c.q, got, c.want)
		}
		if c.want != nil && AnswerText(c.q) == "" {
			t.Errorf("%T: no answer text", c.q)
		}
	}
}

// A line carries no control character: a substitution that left U+0001 where a year's digit was read as a fact of
// „през 194 г.“ until a checker saw it.
func TestLineControlCharacters(t *testing.T) {
	for _, s := range []string{"Още през 194\x01 г.", "Ред\nдруг ред", "Табулация\tтук"} {
		if got := checkLine("fact", s, 200); len(got) != 1 || !strings.Contains(got[0], "control character") {
			t.Errorf("checkLine(%q) = %v", s, got)
		}
	}
	if got := checkLine("fact", "Още през 1941 г. — „Пулицър“…", 200); len(got) != 0 {
		t.Errorf("a clean line: %v", got)
	}
}

// A server's Load leaves the bank's rules to Check (`bank check`, their one gate): a bank only a rule finds fault with
// loads and plays, with its waivers read for what they lift (Estimate); Check refuses it, at the question and the
// rule. The sample passes both.
func TestLoadLeavesTheRulesToCheck(t *testing.T) {
	if b, problems := Check(sample); b == nil {
		t.Fatalf("the sample fails its rules: %v", problems)
	}
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	write := func(path, data string) {
		if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(dir, QuestionsDir, "technology.json")
	data, _ := os.ReadFile(file)
	const text = "с въгленов микрофон." // tec-965's fact; added since StrictFrom, so what it breaks is an error
	broken := strings.Replace(string(data), text, strings.TrimSuffix(text, "."), 1)
	if broken == string(data) {
		t.Fatalf("no %q in the sample", text)
	}
	write(file, broken)
	write(filepath.Join(dir, WaiversFile), `[{"id": "tec-965", "rule": "countable", "why": "известен сбор"}]`)
	b, problems := Load(dir)
	if b == nil {
		t.Fatalf("Load refused a bank only a rule finds fault with: %v", problems)
	}
	if slices.ContainsFunc(problems, func(p Problem) bool { return p.Rule == "fact" }) {
		t.Errorf("Load ran the rules: %v", problems)
	}
	if !b.waived[[2]string{"tec-965", "countable"}] {
		t.Error("Load didn't read the waivers")
	}
	checked, problems := Check(dir)
	if checked != nil || !slices.ContainsFunc(problems, func(p Problem) bool {
		return !p.Warning && p.Rule == "fact" && p.ID == "tec-965" && p.File == filepath.Join(QuestionsDir, "technology.json") && p.Line > 0
	}) {
		t.Fatalf("Check passed a question that breaks a rule, or didn't place it: %v", problems)
	}
}
