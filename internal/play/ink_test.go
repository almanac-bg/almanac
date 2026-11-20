package play

import (
	"encoding/json"
	"maps"
	"testing"
	"time"
)

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

// The day's issue writes in ink each right answer to a question the player meets there first; a wrong one writes
// nothing; a question met before (even answered wrong) writes pencil; any other game writes pencil; and a fact is
// written once: pencil never turns to ink. The book's ink, by chapter, and a game's news say the same.
func TestInkAndPencil(t *testing.T) {
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
				t.Errorf("met before its issue, right in it: written %v, ink %v; want pencil", written, ink)
			}
		case 2:
			if written {
				t.Errorf("wrong in the issue: written")
			}
		default:
			if !ink {
				t.Errorf("question %d, right in its issue: written %v, ink %v", n+1, written, ink)
			}
		}
	}
	news, err := w.g.NewsOf(ctx, ana, s.ID)
	if err != nil || news.Ink != w.inkShown(picks, 0, 3, 4, 5, 6, 7, 8, 9) || !news.Pencil {
		t.Fatalf("the day's news: %+v %v", news, err)
	}
	ink, err := w.g.InkOf(ctx, ana)
	if err != nil || ink[MixTopic] != news.Ink {
		t.Fatalf("the book's ink: %v %v, want %d", ink, err, news.Ink)
	}

	// Another game: pencil only; and the issue's wrong one, right now, is pencil.
	topic, err := w.g.StartTopic(ctx, ana, "history")
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, topic.ID, repeat(w.right, Length)...)
	book = w.book(ana)
	for _, p := range w.picks(topic.ID) {
		if ink, written := book[p.ID]; !written || ink {
			t.Errorf("a topic's right answer: written %v, ink %v", written, ink)
		}
	}
	if n, _ := w.g.NewsOf(ctx, ana, topic.ID); n.Ink != 0 || !n.Pencil {
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
