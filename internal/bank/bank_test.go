package bank

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
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
	b, _ := json.Marshal(d.Reveal())
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
	year := &Number{Head: Head{Type: "number"}, Answer: 1878, Min: 1000, Max: 2026, Step: 1, Scale: "linear", Tolerance: 20}
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
		{"99999", 0, false, false}, // into the range first
	} {
		g := grade(t, d, `{"value":`+c.guess+`}`)
		if abs := g.Score - c.score; abs > 1e-9 || abs < -1e-9 || g.Right != c.right || g.Exact != c.exact {
			t.Errorf("%s graded %+v, want score %v right %v exact %v", c.guess, g, c.score, c.right, c.exact)
		}
	}
	if g := grade(t, d, `{"value":99999}`); string(g.Given) != `{"value":2026}` {
		t.Errorf("logged %s for a guess past the range", g.Given)
	}

	// On a log scale a tolerance is a factor: twice too big with a tolerance of 4 is half off.
	people := &Number{Head: Head{Type: "number"}, Answer: 1000, Min: 1, Max: 1e6, Step: 1, Scale: "log", Tolerance: 4}
	if g := grade(t, people.Deal(0), `{"value":2000}`); g.Score < 0.499 || g.Score > 0.501 {
		t.Errorf("twice too big scored %v", g.Score)
	}
	if g := grade(t, people.Deal(0), `{"value":250}`); g.Score != 0 {
		t.Errorf("four times too small scored %v", g.Score)
	}
	for _, bad := range []string{`{}`, `{"value":"5"}`, `{"value":1,"unit":"x"}`} {
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
	write(CategoriesFile, `[{"id": "history", "name": "История", "icon": "🏛️", "color": "#f59e0b"}]`)
	write("questions/history.json", `[
  {"id": "his-001", "type": "choice", "difficulty": "easy", "text": "Кога?", "answer": "1878", "wrong": ["1876", "1885", "1908"]},
  {"id": "his-001", "type": "choice", "difficulty": "easy", "text": "Кой?", "answer": "А", "wrong": ["Б", "В", "Г"]},
  {"id": "his-003", "type": "choice", "difficulty": "easy", "text": "Кога?", "answer": "1878", "wrong": ["1876", "1885", "1908"]},
  {"id": "his-004", "type": "riddle", "difficulty": "easy", "text": "?"},
  {"id": "his-005", "type": "choice", "difficulty": "easy", "text": "Защо?", "answer": "А", "wrong": ["Б", "В", "Г"], "typo": 1},
  {"id": "his-006", "type": "choice", "difficulty": "easy", "text": "Как?", "answer": "А", "wrong": ["Б", "а"], "fact": "Факт.", "factSource": "https://bg.wikipedia.org/"},
  {"id": "his-009", "type": "choice", "difficulty": "easy", "text": "Как ли?", "answer": "А", "wrong": ["Б", "а"]},
  {"id": "his-007", "type": "number", "difficulty": "hard", "text": "Колко?", "answer": 10.5, "min": 0, "max": 20, "step": 1, "scale": "linear", "tolerance": 5},
  {"id": "his-008", "type": "choice", "difficulty": "easy", "text": "Чие?", "answer": "А", "wrong": ["Б", "В", "Г"],
   "image": {"file": "0123456789abcdef.webp", "w": 1200, "h": 800, "alt": "Знаме", "credit": "Някой", "license": "PD", "source": "https://commons.wikimedia.org/"}}
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
