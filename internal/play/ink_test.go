package play

import (
	"encoding/json"
	"maps"
	"os"
	"strings"
	"testing"
	"time"
)

// The browser tests write a player's book by the rule the server does (e2e/play.ts, playedFair, after they've made
// their quick games a person's): the same text, so that it can't drift.
func TestE2EFactsRule(t *testing.T) {
	src, err := os.ReadFile("../../e2e/play.ts")
	if err != nil {
		t.Fatal(err)
	}
	_, after, ok := strings.Cut(string(src), "const factsRule = `")
	rule, _, ok2 := strings.Cut(after, "`;")
	if !ok || !ok2 {
		t.Fatal("e2e/play.ts has no factsRule")
	}
	if got, want := strings.Join(strings.Fields(rule), " "), strings.Join(strings.Fields(factsRule), " "); got != want {
		t.Fatalf("e2e/play.ts's rule:\n%s\nthe server's:\n%s", got, want)
	}
}

// book is a player's book as kept: by question, ink (true) or pencil (false).
func (w *world) book(user int64) map[string]bool {
	w.t.Helper()
	rows, err := w.db.Read.Query(`SELECT question_id, ink FROM facts WHERE user_id = ?`, user)
	if err != nil {
		w.t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		var ink bool
		if err := rows.Scan(&id, &ink); err != nil {
			w.t.Fatal(err)
		}
		out[id] = ink
	}
	return out
}

// met makes a player one who met a question long before (a wrong answer, in a game of their own).
func (w *world) met(user int64, id string) {
	w.t.Helper()
	res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at, finished_at) VALUES (?, 'topic', '[]', 0, 0)`, user)
	if err != nil {
		w.t.Fatal(err)
	}
	run, _ := res.LastInsertId()
	if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, given, score, is_right, ms, at)
		VALUES (?, 0, ?, '{}', 0, 0, 3000, 0)`, run, id); err != nil {
		w.t.Fatal(err)
	}
}

// The day's issue writes in ink each right answer to a question the player meets there first; a wrong one is in the
// book in grey, as met; a question met before (even answered wrong) is grey; any other game writes grey, right or not;
// and a fact is written once: grey never turns to ink. The book's ink, by chapter, and a game's news say the same, the
// news with the issue's right answers met before („1 вече срещан“).
func TestInkAndGrey(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	s, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	picks := w.picks(s.ID)
	w.met(ana, picks[1].ID) // met long before its issue
	answers := repeat(w.right, Length)
	answers[2] = w.wrong
	w.play(ana, s.ID, answers...)
	book := w.book(ana)
	for n, p := range picks {
		ink, written := book[p.ID]
		switch n {
		case 1:
			if !written || ink {
				t.Errorf("met before its issue, right in it: written %v, ink %v; want grey", written, ink)
			}
		case 2:
			if !written || ink {
				t.Errorf("wrong in the issue: written %v, ink %v; want grey", written, ink)
			}
		default:
			if !ink {
				t.Errorf("question %d, right in its issue: written %v, ink %v", n+1, written, ink)
			}
		}
	}
	news, err := w.g.NewsOf(ctx, ana, s.ID)
	if err != nil || news.Ink != w.inkShown(picks, 0, 3, 4, 5, 6, 7, 8, 9) ||
		news.MetBefore != w.inkShown(picks, 1) {
		t.Fatalf("the day's news: %+v %v", news, err)
	}
	ink, err := w.g.InkOf(ctx, ana)
	if err != nil || ink[MixTopic] != news.Ink {
		t.Fatalf("the book's ink: %v %v, want %d", ink, err, news.Ink)
	}

	// Another game: grey only, right or wrong; and the issue's wrong one, right now, stays grey.
	topic, err := w.g.StartTopic(ctx, ana, "history")
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, topic.ID, append(repeat(w.right, Length/2), repeat(w.wrong, Length/2)...)...)
	book = w.book(ana)
	for _, p := range w.picks(topic.ID) {
		if ink, written := book[p.ID]; !written || ink {
			t.Errorf("a topic's answer: written %v, ink %v", written, ink)
		}
	}
	if n, _ := w.g.NewsOf(ctx, ana, topic.ID); n.Ink != 0 || n.MetBefore != 0 {
		t.Fatalf("a topic's news: %+v", n)
	}
	if again, _ := w.g.InkOf(ctx, ana); !maps.Equal(again, ink) {
		t.Fatalf("a topic's game moved the ink: %v, was %v", again, ink)
	}
	w.consistent(ana)
}

// inkShown is how many of these picks' questions the book shows (a fact, so): those its ink counts.
func (w *world) inkShown(picks []Pick, of ...int) int {
	n := 0
	for _, i := range of {
		if q, ok := w.b.Get(picks[i].ID); ok && writtenShows(q) {
			n++
		}
	}
	return n
}

// consistent checks that the book as written answer by answer is the book the whole rule writes (factsRule).
func (w *world) consistent(user int64) {
	w.t.Helper()
	asPlayed := w.book(user)
	w.rewrite(user)
	if byRule := w.book(user); !maps.Equal(asPlayed, byRule) {
		w.t.Fatalf("the book as played:\n%v\nby the rule:\n%v", asPlayed, byRule)
	}
}

// A day played at a script's speed writes nothing, not even what it wrote before it was found to be one; a question
// that counts for nobody writes nothing either.
func TestScriptWritesNothing(t *testing.T) {
	w := setup(t)
	gal := w.user()
	run := w.dayGame(gal, scriptPace)
	if !w.scripted(run) {
		t.Fatal("not a script's")
	}
	if b := w.book(gal); len(b) != 0 {
		t.Fatalf("a script's day wrote %v", b)
	}
	w.consistent(gal)
}

// The book as the answers write it, one by one, is the book the whole rule writes from them, through days, topics and
// a duel; and a guest's book brought to an account is written again with it: ink once at most.
func TestFactsAsTheRule(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	for day := range 3 {
		mixed := make([]func(int64, int) json.RawMessage, Length)
		for n := range mixed {
			mixed[n] = w.right
			if (n+day)%3 == 0 {
				mixed[n] = w.wrong
			}
		}
		w.dayGame(ana, nil, mixed...)
		w.game(ana, nil, mixed...)
		w.wait(24 * time.Hour)
	}
	w.consistent(ana)
	// A guest who played today's issue too, and a topic's game, brought to Ana's account: her ink stays hers, the
	// guest's topic comes as pencil, and nothing else is lost.
	w.dayGame(ana, nil)
	before := w.book(ana)
	w.since(ana, 30*24*time.Hour)
	w.dayGame(bo, nil)
	topic := w.game(bo, nil)
	w.fold(bo, ana)
	after := w.book(ana)
	for id, ink := range before {
		if after[id] != ink {
			t.Errorf("%s: %v before the guest came, %v after", id, ink, after[id])
		}
	}
	for _, p := range w.picks(topic) {
		if ink, written := after[p.ID]; !written || ink && !before[p.ID] {
			t.Errorf("the guest's topic, %s: written %v, ink %v", p.ID, written, ink)
		}
	}
	w.consistent(ana)
	if _, err := w.g.AlmanacOf(ctx, ana, AlmanacQuery{Limit: AlmanacPage}); err != nil {
		t.Fatal(err)
	}

	// A guest who signs in mid-issue to an account that was there already (its day a ShadowGuest, fair.go) goes on
	// writing ink for the rest of it, as answer by answer and by the rule (review 2026-11-20: it wrote nothing).
	w.wait(24 * time.Hour)
	cy, guest := w.user(), w.user()
	w.since(cy, 30*24*time.Hour)
	s, err := w.g.StartDay(ctx, guest)
	if err != nil {
		t.Fatal(err)
	}
	w.playOn(guest, s.ID, 0, repeat(w.right, 4)...)
	w.fold(guest, cy)
	if w.shadow(s.ID) != ShadowGuest {
		t.Fatalf("the guest's day brought to the account: shadow %d", w.shadow(s.ID))
	}
	w.playOn(cy, s.ID, 4, repeat(w.right, Length-4)...)
	book := w.book(cy)
	for n, p := range w.picks(s.ID) {
		if !book[p.ID] {
			t.Errorf("question %d of the issue, right, signed in at the fifth: ink %v", n+1, book[p.ID])
		}
	}
	w.consistent(cy)
}

// The issue played a second time in one browser (SecondPlay) writes pencil only, as the answers then and by the
// whole rule; a topic's game is no second play of anything.
func TestSecondPlayWritesGrey(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	s, err := w.g.StartDay(SecondPlay(ctx, ana), ana)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, repeat(w.right, Length)...)
	book := w.book(ana)
	if len(book) == 0 {
		t.Fatal("nothing written")
	}
	for id, ink := range book {
		if ink {
			t.Fatalf("%s in ink from a second play", id)
		}
	}
	w.consistent(ana)
	if n := w.count(`SELECT count(*) FROM runs WHERE user_id = ? AND pencil`, ana); n != 1 {
		t.Fatalf("%d runs of pencil", n)
	}
}

// A guest's day brought to an account that hasn't met its questions is ink, as it was the guest's: one person.
func TestMergeKeepsAGuestsInk(t *testing.T) {
	w := setup(t)
	owner, guest := w.user(), w.user()
	w.since(owner, 30*24*time.Hour)
	w.dayGame(guest, nil)
	want := w.book(guest)
	w.fold(guest, owner)
	if got := w.book(owner); !maps.Equal(got, want) || len(got) == 0 {
		t.Fatalf("the account's book: %v, the guest's was %v", got, want)
	}
}

// A question of the day voided in the middle of its day (day.go) takes back what its answers wrote: the book has it no
// more, as the whole rule would have it.
func TestVoidTakesBackItsFact(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.reload(w.b)
	ana := w.user()
	s := w.dayAs(ana, -1, func(int) func(int64, int) json.RawMessage { return w.right })
	target := w.picks(s.ID)[4].ID
	if !w.book(ana)[target] {
		t.Fatal("not in ink before")
	}
	w.reload(editedSample(t, func(id string, q map[string]any) {
		if id == target {
			q["retired"], q["retiredWhy"] = true, "wrong"
		}
	}))
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	if _, there := w.book(ana)[target]; there {
		t.Fatal("the void question's fact stayed")
	}
	w.consistent(ana)
}
