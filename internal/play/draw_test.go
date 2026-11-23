package play

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The day's picture place keeps a picture when its difficulty has none left: the nearest difficulty with one comes
// before a question without.
func TestPictureBeforeDifficulty(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	s := daySlots[1]
	if s.picture != withPicture || s.difficulty != bank.Easy {
		t.Fatalf("the day's second place is %+v", s)
	}
	used := map[string]bool{}
	for _, q := range b.Live("", "") {
		if matches(q, s, true, true) {
			used[q.Base().ID] = true // every easy picture spent
		}
	}
	if len(used) == 0 {
		t.Fatal("the sample has no easy picture")
	}
	allowed := func(bank.Question) bool { return true }
	for seed := range uint64(20) {
		q := choose(b.Live("", ""), s, allowed, marked(used), nil, rand.New(rand.NewPCG(seed, 1)))
		if q == nil || !bank.HasPictures(q) || q.Base().Difficulty == bank.Easy || q.Base().Type != "choice" {
			t.Fatalf("seed %d: %+v instead of a medium or hard picture", seed, q)
		}
	}
	// The runway counts that place's fresh questions: none left of it.
	for _, r := range DayRunway(b, Used{IDs: used}, "2026-11-16") {
		if r.Place == "easy choice with a picture" && r.Days != 0 {
			t.Fatalf("runway %+v with every easy picture spent", r)
		}
	}
	if r := DayRunway(b, Used{}, "2026-11-16"); r[1].Place != "easy choice with a picture" || r[1].Days != len(used) {
		t.Fatalf("runway %+v, %d easy pictures", r, len(used))
	}
}

// dayNumber is a day's number question, which is among its hard ones.
func dayNumber(t *testing.T, b *bank.Bank, picks []Pick) bank.Question {
	t.Helper()
	for i, p := range picks {
		if q, _ := b.Get(p.ID); q != nil && q.Base().Type == "number" {
			if daySlots[i].difficulty != bank.Hard {
				t.Fatalf("the day's number is in place %d, not among the hard ones", i)
			}
			return q
		}
	}
	t.Fatal("the day has no number")
	return nil
}

// A run goes easy to hard, a plain choice first, but where its special questions sit changes from run to run, within
// their difficulty; and a day's shape, drawn once, is the same for everyone.
func TestShapesDiffer(t *testing.T) {
	where := func(slots []slot, typ string) int {
		return slices.IndexFunc(slots, func(s slot) bool { return s.typ == typ })
	}
	for _, shape := range [][]slot{daySlots, chapterSlots(0), chapterSlots(2)} {
		seen := map[string]map[int]bool{}
		for seed := range uint64(40) {
			slots := inBands(slices.Clone(shape), rand.New(rand.NewPCG(seed, 5)))
			if slots[0] != shape[0] || slots[0].typ != "choice" || slots[0].picture == withPicture {
				t.Fatalf("seed %d: the first question is %+v", seed, slots[0])
			}
			for i := range slots {
				if slots[i].difficulty != shape[i].difficulty {
					t.Fatalf("seed %d: place %d is %s, not %s", seed, i, slots[i].difficulty, shape[i].difficulty)
				}
			}
			for _, typ := range []string{"truefalse", "order", "match", puzzle, "number"} {
				if where(shape, typ) < 0 {
					continue // the day's one puzzle stands for the order and the match
				}
				if seen[typ] == nil {
					seen[typ] = map[int]bool{}
				}
				seen[typ][where(slots, typ)] = true
			}
		}
		for typ, at := range seen {
			if len(at) < 2 {
				t.Errorf("the %s is always in place %v", typ, at)
			}
		}
	}
}

// A day has one puzzle (an order, a match or a split), the three in turn so that over many days each comes about as
// often, and two pictures, an easy one and a medium one; once the medium pictures are spent, a plain medium choice
// takes that place, and the day isn't short for it.
func TestOnePuzzleTwoPicturesADay(t *testing.T) {
	b := dayRulesBank(t)
	used := map[string]bool{}
	drawn := map[string][]Pick{}
	kinds := map[string]int{}
	const days = 30
	for n := range days {
		day := DayShift("2026-03-01", n)
		picks, short := drawDay(b, day, used, nil, recentSubjects(b, drawn, day), rand.New(rand.NewPCG(uint64(n), 3)))
		if len(short) > 0 || len(picks) != Length {
			t.Fatalf("%s: %d picks, short %v", day, len(picks), short)
		}
		drawn[day] = picks
		puzzles, pictures := 0, map[bank.Difficulty]int{}
		for _, p := range picks {
			q, _ := b.Get(p.ID)
			if k := q.Base().Type; slices.Contains(puzzleKinds, k) {
				puzzles++
				kinds[k]++
				used[p.ID] = true // the small bank's puzzles and pictures spent; its plain choices dealt again
			}
			if bank.HasPictures(q) {
				pictures[q.Base().Difficulty]++
				used[p.ID] = true
			}
		}
		if puzzles != 1 || pictures[bank.Easy] != 1 || pictures[bank.Medium] != 1 || len(pictures) != 2 {
			t.Fatalf("%s: %d puzzles, pictures %v: one puzzle and an easy and a medium picture a day", day, puzzles, pictures)
		}
	}
	for _, k := range puzzleKinds {
		if kinds[k] < days/len(puzzleKinds)-1 {
			t.Errorf("puzzles over %d days %v: the %s comes too rarely", days, kinds, k)
		}
	}
	// No medium picture left: a plain medium choice in its place, never short.
	for _, q := range b.Live("", "choice") {
		if q.Base().Difficulty == bank.Medium && bank.HasPictures(q) {
			used[q.Base().ID] = true
		}
	}
	picks, short := drawDay(b, "2026-04-01", used, nil, nil, rand.New(rand.NewPCG(1, 3)))
	if len(short) > 0 || len(picks) != Length {
		t.Fatalf("no medium picture left: %d picks, short %v", len(picks), short)
	}
	choices := 0
	for _, p := range picks {
		q, _ := b.Get(p.ID)
		choices += b2i(q.Base().Difficulty == bank.Medium && q.Base().Type == "choice")
	}
	if choices != 3 {
		t.Fatalf("no medium picture left: %d medium choices, not 3", choices)
	}
}

// A day takes the question that belongs to its date, at least BGFloor about Bulgaria where the bank has them, and an
// estimate for its number; every place still fits just so, and the chapters stay one each.
func TestDayOfItsDate(t *testing.T) {
	b := biggerSample(t, 20)
	day := "2026-03-03"
	var dated bank.Question
	for _, q := range b.Live("history", "choice") {
		if q.Base().Difficulty == bank.Medium && !bank.HasPictures(q) {
			dated = q
			break
		}
	}
	dated.Extra().On = []string{"03-03"}
	for i, q := range b.Live("", "") {
		if i%4 == 0 {
			q.Extra().BG = true
		}
	}
	for seed := range uint64(30) {
		picks, short := drawDay(b, day, map[string]bool{}, nil, nil, rand.New(rand.NewPCG(seed, 7)))
		if len(short) > 0 || len(picks) != Length {
			t.Fatalf("seed %d: %d picks, short %v", seed, len(picks), short)
		}
		found, bg, chapters := false, 0, map[string]bool{}
		for _, p := range picks {
			q, _ := b.Get(p.ID)
			found = found || p.ID == dated.Base().ID
			bg += b2i(q.Extra().BG)
			chapters[q.Base().Category] = true
		}
		if n := dayNumber(t, b, picks); !b.Estimate(n) {
			t.Fatalf("seed %d: the day's number is %s, not an estimate", seed, n.Base().ID)
		}
		if !found || bg < BGFloor || len(chapters) != Length {
			t.Fatalf("seed %d: dated %v, %d about Bulgaria, %d chapters", seed, found, bg, len(chapters))
		}
	}
	// Any other day keeps it for its own: never drawn before (or after) its date.
	for seed := range uint64(30) {
		for _, day := range []string{"2026-03-02", "2026-03-04"} {
			picks, _ := drawDay(b, day, map[string]bool{}, nil, nil, rand.New(rand.NewPCG(seed, 7)))
			if len(picks) != Length || slices.ContainsFunc(picks, func(p Pick) bool { return p.ID == dated.Base().ID }) {
				t.Fatalf("seed %d, %s: %d picks, or the 3 March question spent", seed, day, len(picks))
			}
		}
	}
}

// Of two questions for a date, a day takes the one of that year's date only first: an every year's comes back the
// next year, the other would have lost its date for good.
func TestDayTakesItsYearsDateFirst(t *testing.T) {
	b := biggerSample(t, 20)
	day := "2027-05-02"
	var yearly, once bank.Question
	for _, q := range b.Live("history", "choice") {
		if q.Base().Difficulty != bank.Medium || bank.HasPictures(q) {
			continue
		}
		if yearly == nil {
			yearly = q
		} else if bank.Subjects(q)[0] != bank.Subjects(yearly)[0] {
			once = q
			break
		}
	}
	yearly.Extra().On = []string{"05-02"}
	once.Extra().On = []string{"2027-05-02", "2028-04-16"}
	for seed := range uint64(30) {
		picks, _ := drawDay(b, day, map[string]bool{}, nil, nil, rand.New(rand.NewPCG(seed, 7)))
		if !slices.ContainsFunc(picks, func(p Pick) bool { return p.ID == once.Base().ID }) {
			t.Fatalf("seed %d: Великден's question passed over for the every year's", seed)
		}
	}
}

// A day names each subject once: no two of its questions share an answer or a quoted title, though the bank has each
// answer many times over (every sample question copied twenty times), with the question of its date and the
// Bulgarian ones swapped in, day after day.
func TestOneSubjectADay(t *testing.T) {
	b := biggerSample(t, 20)
	for i, q := range b.Live("", "") {
		if i%4 == 0 {
			q.Extra().BG = true
		}
	}
	dated, _ := b.Get("his-015") // the treaty of San Stefano, 3 March 1878
	dated.Extra().On = []string{"03-03"}
	used := map[string]bool{}
	days := 0
	for d := range 40 {
		day := time.Date(2026, 3, 1+d, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)
		picks, short := drawDay(b, day, used, nil, nil, rand.New(rand.NewPCG(uint64(d), 11)))
		if len(short) > 0 {
			break
		}
		days++
		named := map[string]string{}
		for _, p := range picks {
			used[p.ID] = true
			q, _ := b.Get(p.ID)
			for _, k := range bank.Subjects(q) {
				if other, ok := named[k]; ok {
					t.Fatalf("%s: %s and %s both name %q", day, other, p.ID, k)
				}
				named[k] = p.ID
			}
		}
		if day == "2026-03-03" && named["санстефанският"] != "his-015" {
			t.Fatalf("3 March without its question: %v", picks)
		}
	}
	if days < 15 { // the sample has one hard number, so 21 days at most
		t.Fatalf("only %d days drawn exactly", days)
	}
}

// A day wishes away the subjects of the week before it (recentSubjects): in a bank whose questions keep coming back to
// the same subjects (a hundred of them, each asked again and again), and has others for every place, nobody meets an
// answer or a title twice in a week. And every day ends on its hard number.
func TestNoSubjectTwiceInAWeek(t *testing.T) {
	b := recurringBank(t, 60)
	used := map[string]bool{}
	drawn := map[string][]Pick{}
	for d := range 60 {
		day := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, d).Format(time.DateOnly)
		recent := recentSubjects(b, drawn, day)
		picks, short := drawDay(b, day, used, nil, recent, rand.New(rand.NewPCG(uint64(d), 13)))
		if len(short) > 0 || len(picks) != Length {
			t.Fatalf("%s: %d questions, short %v", day, len(picks), short)
		}
		drawn[day] = picks
		if last, _ := b.Get(picks[len(picks)-1].ID); last.Base().Type != "number" {
			t.Fatalf("%s ends on a %s", day, last.Base().Type)
		}
		for _, p := range picks {
			used[p.ID] = true
			q, _ := b.Get(p.ID)
			for _, k := range bank.Subjects(q) {
				if recent[k] {
					t.Errorf("%s: %s names %q, which the week before named", day, p.ID, k)
				}
			}
		}
	}
	// Without the wish, the same bank brings subjects back within the week: the test tells.
	used, drawn = map[string]bool{}, map[string][]Pick{}
	again := 0
	for d := range 60 {
		day := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, d).Format(time.DateOnly)
		recent := recentSubjects(b, drawn, day)
		picks, _ := drawDay(b, day, used, nil, nil, rand.New(rand.NewPCG(uint64(d), 13)))
		drawn[day] = picks
		for _, p := range picks {
			used[p.ID] = true
			q, _ := b.Get(p.ID)
			again += len(slices.DeleteFunc(slices.Clone(bank.Subjects(q)), func(k string) bool { return !recent[k] }))
		}
	}
	if again == 0 {
		t.Fatal("the bank brings no subject back within a week even without the wish: it tests nothing")
	}
}

// recurringBank is a bank of ten chapters with n questions for every place of a day in each, about 100 subjects
// between them all (answers and quoted titles), each asked again every few dozen questions.
func recurringBank(t *testing.T, n int) *bank.Bank {
	t.Helper()
	var categories []bank.Category
	var questions []bank.Question
	k := 0
	add := func(category string, q map[string]any) {
		k++
		q["id"] = fmt.Sprintf("%s-%d", category, k)
		q["bg"] = k%3 == 0
		data, _ := json.Marshal(q)
		decoded, err := bank.Decode(data, category)
		if err != nil {
			t.Fatal(err)
		}
		questions = append(questions, decoded)
	}
	subject := func() string { return fmt.Sprintf("Предмет %d", (k*37)%100) }
	picture := map[string]any{"file": "p.webp", "w": 600, "h": 400, "alt": "Снимка", "credit": "Някой", "license": "PD",
		"source": "https://commons.wikimedia.org/p"}
	for c := range 10 {
		category := string(rune('a'+c)) + "chapter"
		categories = append(categories, bank.Category{ID: category, Name: fmt.Sprintf("Тема %d", c+1)})
		for i := range n {
			text := func(what string) string { return fmt.Sprintf("%s %d „%s“?", what, i, subject()) }
			wrong := []string{"Едно", "Друго", "Трето"}
			add(category, map[string]any{"type": "choice", "difficulty": "easy", "text": text("Кое"), "answer": subject(), "wrong": wrong})
			add(category, map[string]any{"type": "choice", "difficulty": "easy", "text": text("Кое на снимката"),
				"answer": subject(), "wrong": wrong, "image": picture})
			add(category, map[string]any{"type": "truefalse", "difficulty": "easy", "text": strings.TrimSuffix(text("Вярно е"), "?") + ".", "answer": true})
			add(category, map[string]any{"type": "choice", "difficulty": "medium", "text": text("Кое"), "answer": subject(), "wrong": wrong})
			add(category, map[string]any{"type": "order", "difficulty": "medium", "text": text("Подреди"), "direction": "asc",
				"items": []any{map[string]any{"text": "А", "value": 1}, map[string]any{"text": "Б", "value": 2},
					map[string]any{"text": "В", "value": 3}, map[string]any{"text": "Г", "value": 4}}})
			add(category, map[string]any{"type": "match", "difficulty": "medium", "text": text("Свържи"),
				"pairs": []any{map[string]any{"left": "1", "right": "А"}, map[string]any{"left": "2", "right": "Б"},
					map[string]any{"left": "3", "right": "В"}, map[string]any{"left": "4", "right": "Г"}}})
			add(category, map[string]any{"type": "split", "difficulty": "medium", "text": text("Раздели"), "groups": []string{"Ляво", "Дясно"},
				"items": []any{map[string]any{"text": "А", "group": 0}, map[string]any{"text": "Б", "group": 1},
					map[string]any{"text": "В", "group": 0}, map[string]any{"text": "Г", "group": 1}}})
			add(category, map[string]any{"type": "clues", "difficulty": "medium", "text": text("Кой е"),
				"clues": []string{"Първо.", "Второ.", "Трето."}, "answer": subject(), "wrong": wrong})
			add(category, map[string]any{"type": "choice", "difficulty": "hard", "text": text("Кое"), "answer": subject(), "wrong": wrong})
			add(category, map[string]any{"type": "choice", "difficulty": "hard", "text": text("Кое още"), "answer": subject(), "wrong": wrong})
			add(category, map[string]any{"type": "number", "difficulty": "hard", "text": text("Колко метра е"),
				"answer": 100 + k, "unit": "м", "step": 1, "scale": "linear", "tolerance": 30})
		}
	}
	return bank.Of(categories, questions)
}

// A chapter's game and a duel deal, of the questions as fresh to their players and as fitting, one somebody has met
// already before one nobody has: the untouched are the days' to come (ahead.go), so a player who plays the chapters
// most doesn't meet the issues ahead there and lose their ink for it.
func TestOtherGamesDealWhatWasMet(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	// An untouched medium choice without a picture, with others like it that somebody has met.
	plain := slot{bank.Medium, "choice", eitherWay, ""}
	var like []bank.Question
	for _, q := range b.Live("", "") {
		if matches(q, plain, true, false) && !bank.HasPictures(q) {
			like = append(like, q)
		}
	}
	if len(like) < 3 {
		t.Fatalf("the sample has %d medium choices without a picture", len(like))
	}
	untouched := like[0].Base().ID
	met := map[string]bool{}
	for _, q := range b.Live("", "") {
		if id := q.Base().ID; id != untouched {
			met[id] = true
		}
	}
	dealt := func(met map[string]bool) int {
		n := 0
		for seed := range uint64(300) {
			for _, p := range Draw(b, MixChapter, 0, nil, nil, met, rand.New(rand.NewPCG(seed, 9))) {
				if p.ID == untouched {
					n++
				}
			}
		}
		return n
	}
	if n := dealt(nil); n == 0 {
		t.Fatalf("with nothing met, %s is never dealt in 300 games: the test shows nothing", untouched)
	}
	if n := dealt(met); n != 0 {
		t.Errorf("%s, untouched, was dealt %d times while others like it had been met", untouched, n)
	}
}

// What a slot wishes for still comes before a question somebody has met: an estimate for the number, met or not,
// before a met number that isn't one.
func TestMetAfterTheWish(t *testing.T) {
	estimate := func(q bank.Question) bool { return strings.HasPrefix(q.Base().ID, "e") }
	met := map[string]bool{"n1": true}
	prefer := metFirst([]func(bank.Question) bool{estimate}, met)
	if len(prefer) != 3 {
		t.Fatalf("%d wishes, want the estimate met, the estimate, then met", len(prefer))
	}
	if metFirst(nil, nil) != nil || len(metFirst(nil, met)) != 1 {
		t.Error("with no wishes, met alone; with nothing met, the wishes as they were")
	}
}
