package play

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
	"time"
)

// scriptPace is a script's: every answer in 50 ms.
func scriptPace(int) time.Duration { return 50 * time.Millisecond }

// quickPace is a quick person's who knew the first n at once (300 ms each), and took 2.5 s over the rest.
func quickPace(n int) func(int) time.Duration {
	return func(i int) time.Duration {
		if i < n {
			return 300 * time.Millisecond
		}
		return 2500 * time.Millisecond
	}
}

// game plays a topic's ten at a pace, all right, and says which run it was.
func (w *world) game(user int64, pace func(int) time.Duration, answers ...func(int64, int) json.RawMessage) int64 {
	w.t.Helper()
	s, err := w.g.StartTopic(w.t.Context(), user, MixTopic)
	if err != nil {
		w.t.Fatal(err)
	}
	if len(answers) == 0 {
		answers = repeat(w.right, Length)
	}
	w.pace = pace
	w.play(user, s.ID, answers...)
	w.pace = nil
	return s.ID
}

// shadow is why a run is a shadow (0: it isn't one).
func (w *world) shadow(runID int64) int {
	w.t.Helper()
	var why int
	if err := w.db.Read.QueryRow(`SELECT shadow FROM runs WHERE id = ?`, runID).Scan(&why); err != nil {
		w.t.Fatal(err)
	}
	return why
}

// scripted is whether a run is marked as played at a script's speed.
func (w *world) scripted(runID int64) bool { return w.shadow(runID) == ShadowScript }

// A run is marked as a script's by the third answer under its Floor, and stays marked; a quick person's two, and
// questions given up at once, don't mark it.
func TestScriptedRunsAreMarked(t *testing.T) {
	w := setup(t)
	if run := w.game(w.user(), scriptPace); !w.scripted(run) {
		t.Fatal("a game answered in 50 ms each isn't marked a script's")
	}
	if run := w.game(w.user(), quickPace(MostQuick)); w.scripted(run) {
		t.Fatal("a quick person's game (two known at once) is marked a script's")
	}
	if run := w.game(w.user(), quickPace(MostQuick+1)); !w.scripted(run) {
		t.Fatal("three answers under their Floor in one game don't mark it")
	}
	giveUp := func(int64, int) json.RawMessage { return json.RawMessage("null") }
	if run := w.game(w.user(), scriptPace, repeat(giveUp, Length)...); w.scripted(run) {
		t.Fatal("questions given up at once mark a game a script's")
	}
	// Marked as it's played: a run left half-way, three quick answers in, is a script's already.
	user := w.user()
	s, err := w.g.StartTopic(t.Context(), user, MixTopic)
	if err != nil {
		t.Fatal(err)
	}
	w.pace = scriptPace
	w.play(user, s.ID, repeat(w.right, MostQuick+1)...)
	w.pace = nil
	if !w.scripted(s.ID) {
		t.Fatal("a run three quick answers in isn't marked")
	}
	// Each question has its own floor: three orders put down in a second each are no person's; three statements
	// judged in a second each are.
	of := func(typ string) []Pick {
		qs := w.b.Live("", typ)
		if len(qs) == 0 {
			t.Fatalf("no %s question in the sample bank", typ)
		}
		return slices.Repeat([]Pick{{ID: qs[0].Base().ID}}, MostQuick+1)
	}
	second := map[int]int64{0: 1000, 1: 1000, 2: 1000}
	if !scriptPaced(w.b, of("order"), second) {
		t.Fatal("three orders put down in a second each count as a person's")
	}
	if scriptPaced(w.b, of("truefalse"), second) {
		t.Fatal("three statements judged in a second each count as a script's")
	}
}

// A day played at a script's speed is on the boards for its player alone: they see it, with their place among the
// others as if it counted; the others see the day without it.
func TestScriptedDayIsTheirsAlone(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bot, cy := w.user(), w.user(), w.user()
	day := func(user int64, pace func(int) time.Duration, answer func(int64, int) json.RawMessage) {
		s, err := w.g.StartDay(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		w.pace = pace
		w.play(user, s.ID, repeat(answer, Length)...)
		w.pace = nil
	}
	// The script plays first, all right, the quickest of all; then Ana, all right, and Cy, all wrong.
	day(bot, scriptPace, w.right)
	day(ana, nil, w.right)
	day(cy, nil, w.wrong)
	for _, pair := range [][2]int64{{ana, cy}, {bot, ana}, {bot, cy}} {
		if err := w.g.befriend(ctx, pair[0], pair[1]); err != nil {
			t.Fatal(err)
		}
	}
	today := w.g.Today()
	has := func(b Board, name string) bool {
		return slices.ContainsFunc(b.Top, func(s Score) bool { return s.Name == name })
	}
	_, _ = w.db.Write.Exec(`UPDATE users SET name = 'Бот' WHERE id = ?`, bot)
	_, _ = w.db.Write.Exec(`UPDATE users SET name = 'Ана' WHERE id = ?`, ana)

	b, err := w.g.BoardOf(ctx, today, cy)
	if err != nil || b.Players != 2 || len(b.Top) != 2 || has(b, "Бот") || b.Top[0].Name != "Ана" || b.Place != 2 {
		t.Fatalf("the day as Cy sees it: %+v %v", b, err)
	}
	if b, _ := w.g.BoardOf(ctx, today, ana); b.Players != 2 || b.Place != 1 || has(b, "Бот") {
		t.Fatalf("the day as Ana sees it: %+v", b)
	}
	if b, _ := w.g.BoardOf(ctx, today, 0); b.Players != 2 || has(b, "Бот") {
		t.Fatalf("the day as nobody signed in sees it: %+v", b)
	}
	// The script's player sees the day as any day: all three, and first place, their own.
	b, err = w.g.BoardOf(ctx, today, bot)
	if err != nil || b.Players != 3 || len(b.Top) != 3 || !b.Top[0].Me || b.Place != 1 || b.Mine == nil ||
		b.Mine.Rights != Length {
		t.Fatalf("the day as the script's player sees it: %+v %v", b, err)
	}
	// Friends: the script's day is in no friend's list nor board, and in its player's own.
	friends, err := w.g.FriendsOf(ctx, cy)
	if err != nil || len(friends) != 2 {
		t.Fatalf("Cy's friends: %+v %v", friends, err)
	}
	for _, f := range friends {
		if (f.ID == bot) != (f.Today == nil) {
			t.Fatalf("Cy's friend %d's day: %+v", f.ID, f.Today)
		}
	}
	if fb, _ := w.g.FriendsBoard(ctx, today, cy); len(fb) != 2 || slices.ContainsFunc(fb, func(s Score) bool { return s.Name == "Бот" }) {
		t.Fatalf("the day among Cy's friends: %+v", fb)
	}
	if fb, _ := w.g.FriendsBoard(ctx, today, bot); len(fb) != 3 || !fb[0].Me {
		t.Fatalf("the day among the script's player's friends: %+v", fb)
	}

	// How the day's other players answered: the script's answers aren't in it, for anyone.
	w.g.CrowdMin = 1
	q, _ := w.b.Get(w.picks(dayRun(t, w, cy))[0].ID)
	if c, err := w.g.dayCrowd(ctx, w.db.Read, today, q, ana); err != nil || c == nil || c.Answers != 1 {
		t.Fatalf("the day's crowd as Ana sees it (Cy's answer alone): %+v %v", c, err)
	}
	if c, _ := w.g.dayCrowd(ctx, w.db.Read, today, q, bot); c == nil || c.Answers != 2 {
		t.Fatalf("the day's crowd as the script's player sees it (Ana's and Cy's): %+v", c)
	}
	if err := w.g.CountCrowds(ctx); err != nil {
		t.Fatal(err)
	}
	if c := w.g.Crowd(q); c == nil || c.Answers != 2 {
		t.Fatalf("everyone's crowd: %+v, want Ana's and Cy's answers", c)
	}
}

func dayRun(t *testing.T, w *world, user int64) int64 {
	t.Helper()
	var id int64
	if err := w.db.Read.QueryRow(`SELECT id FROM runs WHERE user_id = ? AND kind = 'day'`, user).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// dayGame plays the day's ten at a pace (all right, unless answers are given), and says which run it was.
func (w *world) dayGame(user int64, pace func(int) time.Duration, answers ...func(int64, int) json.RawMessage) int64 {
	w.t.Helper()
	s, err := w.g.StartDay(w.t.Context(), user)
	if err != nil {
		w.t.Fatal(err)
	}
	if len(answers) == 0 {
		answers = repeat(w.right, Length)
	}
	w.pace = pace
	w.play(user, s.ID, answers...)
	w.pace = nil
	return s.ID
}

// The knowledge board, recordings and the questions' calibration are people's too.
func TestScriptedOutOfBoardsAndStatistics(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bot := w.user(), w.user()
	for range KnowAll / Length {
		w.game(ana, nil, repeat(w.wrong, Length)...)
		w.game(bot, scriptPace)
	}
	if k, err := w.g.KnowledgeBoard(ctx, ana, false, ""); err != nil || len(k.Top) != 1 || !k.Top[0].Me {
		t.Fatalf("knowledge as Ana sees it: %+v %v", k, err)
	}
	if k, err := w.g.KnowledgeBoard(ctx, bot, false, ""); err != nil || len(k.Top) != 2 || k.Place != 1 || k.Top[0].Value < 90 {
		t.Fatalf("knowledge as the script's player sees it: %+v %v", k, err)
	}
	// A recording: Ana's, never the script's (the latest, all right).
	if l, err := w.g.StartRecorded(ctx, w.user()); err != nil || w.scripted(l.Runs[1]) {
		t.Fatalf("a recording of a script's game: %+v %v", l, err)
	}

	// Calibration counts CalibrateFrom answers of people.
	id := w.b.Live("", "choice")[0].Base().ID
	for i := range CalibrateFrom {
		res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at, shadow) VALUES (?, 'topic', '[]', 0, 1)`, bot)
		if err != nil {
			t.Fatal(err)
		}
		run, _ := res.LastInsertId()
		if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, given, score, points, is_right, ms, at)
			VALUES (?, 0, ?, '{"pick":0}', 1, 0, 1, 50, ?)`, run, id, i); err != nil {
			t.Fatal(err)
		}
	}
	calibrated := func() int {
		list, err := w.g.Calibrate(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range list {
			if c.ID == id {
				return c.Answers
			}
		}
		return 0
	}
	before := calibrated()
	if _, err := w.db.Write.Exec(`UPDATE runs SET shadow = 0 WHERE questions = '[]'`); err != nil {
		t.Fatal(err)
	}
	if after := calibrated(); before != 0 || after < CalibrateFrom {
		t.Fatalf("calibration: %d answers counted with the script's, %d once they're a person's", before, after)
	}
}

// The games played before the mark are judged once, as the server starts: the migration lists the ones that may be a
// script's, and the bank's floors judge them.
func TestScriptedBackfill(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	script, person := w.game(w.user(), scriptPace), w.game(w.user(), quickPace(MostQuick))
	// Orders, matches and splits, put down in a second and a half each: no script would show under the tap's
	// floor, but they're under their own.
	var slow []Pick
	for _, typ := range []string{"order", "match", "split"} {
		slow = append(slow, Pick{ID: w.b.Live("", typ)[0].Base().ID})
	}
	raw, _ := json.Marshal(slow)
	res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at, finished_at) VALUES (?, 'topic', ?, 0, 0)`,
		w.user(), string(raw))
	if err != nil {
		t.Fatal(err)
	}
	sorted, _ := res.LastInsertId()
	for n, p := range slow {
		if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, given, score, points, is_right, ms, at)
			VALUES (?, ?, ?, '{}', 1, 0, 1, 1500, 0)`, sorted, n, p.ID); err != nil {
			t.Fatal(err)
		}
	}
	// The database as it was before the mark, then the migration (and the one that renamed its column since).
	if _, err := w.db.Write.Exec(`DROP INDEX runs_shadow; DROP TABLE runs_unjudged; ALTER TABLE runs DROP COLUMN shadow`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"0035_scripted.sql", "0058_runs_shadow.sql"} {
		body, err := os.ReadFile("../store/migrations/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.db.Write.Exec(string(body)); err != nil {
			t.Fatal(name, err)
		}
	}
	if w.scripted(script) || w.scripted(sorted) {
		t.Fatal("marked before the bank judged")
	}
	n, err := w.g.JudgeRuns(ctx)
	if err != nil || n != 2 || !w.scripted(script) || !w.scripted(sorted) || w.scripted(person) {
		t.Fatalf("judged %d (%v): the script's %v, the sorted %v, the person's %v", n, err, w.scripted(script),
			w.scripted(sorted), w.scripted(person))
	}
	if n, err := w.g.JudgeRuns(ctx); err != nil || n != 0 {
		t.Fatalf("judged again: %d %v", n, err)
	}
}
