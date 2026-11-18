package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"
)

// playOn answers a run's questions from n on, three seconds each, as its player does.
func (w *world) playOn(user, runID int64, from int, answers ...func(int64, int) json.RawMessage) {
	w.t.Helper()
	for i, a := range answers {
		n := from + i
		w.show(user, runID)
		w.wait(3 * time.Second)
		if _, err := w.answer(user, runID, n, a(runID, n)); err != nil {
			w.t.Fatalf("answer %d: %v", n, err)
		}
	}
}

// at sets the clock to a moment of November 2026, in Bulgaria.
func (w *world) at(day, hour, minute, second int) {
	w.now = time.Date(2026, 11, day, hour, minute, second, 0, Bulgaria)
}

// sundayLate starts a player's day on Sunday 15 November at 23:58, answers half of it right before midnight, and the
// other half right at 00:02 (review 2026-11-18, A2, A3).
func (w *world) sundayLate(user int64) int64 {
	w.t.Helper()
	w.at(15, 23, 58, 0)
	s, err := w.g.StartDay(w.t.Context(), user)
	if err != nil {
		w.t.Fatal(err)
	}
	w.playOn(user, s.ID, 0, repeat(w.right, Length/2)...)
	w.at(16, 0, 2, 0)
	w.playOn(user, s.ID, Length/2, repeat(w.right, Length-Length/2)...)
	return s.ID
}

// A run of Sunday's questions begun before midnight and finished after it counts in its own week, though the minute's
// sweep came in between: the week closes only once Sunday's runs are all in (weekLate), and the run joins its own
// week. A player whose only day of the week it was is in it too. Nobody joins the new week before the old one closes:
// a Monday's run finished meanwhile is seated by the close, in the league the close moved them to.
func TestSundayRunAcrossMidnightCountsInItsWeek(t *testing.T) {
	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	for range RaceSize - 1 {
		w.dayGame(w.user(), nil, append(repeat(w.right, 3), repeat(w.wrong, Length-3)...)...)
	}
	w.dayGame(ana, nil, append(repeat(w.right, 1), repeat(w.wrong, Length-1)...)...)

	// Ana and Bo (whose first day of the week it is) begin Sunday's at 23:58; the sweep runs at 00:00:30.
	w.at(15, 23, 58, 0)
	runs := map[int64]int64{}
	for _, p := range []int64{ana, bo} {
		s, err := w.g.StartDay(ctx, p)
		if err != nil {
			t.Fatal(err)
		}
		runs[p] = s.ID
		w.playOn(p, s.ID, 0, repeat(w.right, Length/2)...)
	}
	w.at(16, 0, 0, 30)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM league_results`); n != 0 {
		t.Fatalf("the week closed at midnight, before Sunday's runs were in: %d places", n)
	}
	if v, err := w.g.LeagueOf(ctx, ana); err != nil || v.Week != "2026-11-09" || v.DaysLeft != 0 || !v.In {
		t.Fatalf("the week as it closes: %+v %v", v, err)
	}
	w.at(16, 0, 2, 0)
	for _, p := range []int64{ana, bo} {
		w.playOn(p, runs[p], Length/2, repeat(w.right, Length-Length/2)...)
	}
	// Ana plays Monday's while the week before closes: not in a group of the new week yet.
	w.at(16, 0, 5, 0)
	w.dayGame(ana, nil)
	if n := w.count(`SELECT count(*) FROM league_members WHERE week = '2026-11-16'`); n != 0 {
		t.Fatalf("%d in the new week before the old one closed", n)
	}
	// Still not closed at the grace's end, while the last of Sunday's could be answered.
	w.now = time.Date(2026, 11, 16, 0, 0, 0, 0, Bulgaria).Add(dayLate)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM league_results`); n != 0 {
		t.Fatalf("the week closed while Sunday's runs could still be answered: %d places", n)
	}

	w.at(16, 0, 30, 0)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	var place, points, sum int
	if err := w.db.Read.QueryRow(`SELECT place, points FROM league_results WHERE user_id = ? AND week = '2026-11-09'`,
		ana).Scan(&place, &points); err != nil {
		t.Fatal(err)
	}
	_ = w.db.Read.QueryRow(`SELECT sum(points) FROM runs WHERE user_id = ? AND kind = 'day' AND day < '2026-11-16'`, ana).Scan(&sum)
	if place != 1 || points != sum {
		t.Fatalf("Ana's week: place %d with %d points, her days %d", place, points, sum)
	}
	if n := w.count(`SELECT count(*) FROM league_results WHERE user_id = ? AND week = '2026-11-09' AND points > 0`,
		bo); n != 1 {
		t.Fatal("Bo's only day of the week, finished after midnight, counted in no week")
	}
	var tier, groupTier int
	err := w.db.Read.QueryRow(`SELECT u.league, g.tier FROM users u JOIN league_members m ON m.user_id = u.id
		JOIN league_groups g ON g.id = m.group_id WHERE u.id = ? AND m.week = '2026-11-16'`, ana).Scan(&tier, &groupTier)
	if err != nil || tier != 1 || groupTier != 1 {
		t.Fatalf("Ana's Monday: league %d, in a group of %d (%v)", tier, groupTier, err)
	}
	if v, _ := w.g.LeagueOf(ctx, ana); v.Week != "2026-11-16" || !v.In || v.League.Tier != 1 || v.DaysLeft != 7 {
		t.Fatalf("Ana's new week: %+v", v)
	}
	// Sunday's goal of the day's questions is Sunday's, for both.
	for _, p := range []int64{ana, bo} {
		if n := w.count(`SELECT count(*) FROM goals_done WHERE user_id = ? AND day = '2026-11-15' AND goal = 'day'`,
			p); n != 1 {
			t.Fatalf("player %d: Sunday's goal of the day not kept", p)
		}
	}
}

// What follows a run is judged by the run, not by when it's done: the sweep's retry after midnight keeps the goals of
// the run's day and puts it in its own week, while the week is open; and the close seats one whose retry comes after
// it.
func TestAfterRetryAcrossMidnight(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	ana, bo := w.user(), w.user()
	// What follows their Sunday runs fails (a goal can't be kept), as if the server had stopped there.
	if _, err := w.db.Write.Exec(`CREATE TEMP TRIGGER stop BEFORE INSERT ON goals_done
		BEGIN SELECT RAISE(ABORT, 'stopped'); END`); err != nil {
		t.Fatal(err)
	}
	w.at(15, 23, 50, 0)
	w.dayGame(ana, nil)
	w.dayGame(bo, nil)
	if _, err := w.db.Write.Exec(`DROP TRIGGER stop`); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM runs_after`); n != 2 {
		t.Fatalf("%d runs left to follow up", n)
	}
	if _, err := w.db.Write.Exec(`UPDATE runs_after SET due = ? WHERE run_id = ?`,
		time.Date(2026, 11, 16, 1, 0, 0, 0, Bulgaria).UnixMilli(), dayRun(t, w, bo)); err != nil {
		t.Fatal(err)
	}

	// Ana's is retried at 00:05: Sunday's goals, Sunday's week.
	w.at(16, 0, 5, 0)
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM goals_done WHERE user_id = ? AND day = '2026-11-15' AND goal = 'day'`, ana); n != 1 {
		t.Fatal("the retry after midnight didn't keep Sunday's goal")
	}
	if n := w.count(`SELECT count(*) FROM goals_done WHERE user_id = ? AND day = '2026-11-16'`, ana); n != 0 {
		t.Fatal("Sunday's run counted for Monday's goals")
	}
	if n := w.count(`SELECT count(*) FROM league_members WHERE user_id = ? AND week = '2026-11-09'`, ana); n != 1 {
		t.Fatal("the retry after midnight didn't join Sunday's week")
	}
	// Bo's comes after the week closed: the close seated him, and the retry puts him in no other week.
	w.at(16, 1, 0, 0)
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM league_results WHERE week = '2026-11-09'`); n != 2 {
		t.Fatalf("%d places of the week, not Ana's and Bo's", n)
	}
	if n := w.count(`SELECT count(*) FROM league_members WHERE user_id = ? AND week = '2026-11-16'`, bo); n != 0 {
		t.Fatal("Sunday's run put Bo in Monday's week")
	}
	if n := w.count(`SELECT count(*) FROM goals_done WHERE user_id = ? AND day = '2026-11-15' AND goal = 'day'`, bo); n != 1 {
		t.Fatal("Bo's late retry didn't keep Sunday's goal")
	}
}

// The day's goals are the day's game's, though its last answers came after midnight: all ten answers count on its own
// day (a row, eight of ten), its goals are kept, and the day with all three done earns its reserve day.
func TestGoalsAcrossMidnight(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	w.at(15, 12, 0, 0)
	w.daysPlayed(ana, 3, 2, 1) // Thursday to Saturday: the first day's reserve
	w.setGoals(ana, "day", "row5", "eight")
	if s, _ := w.g.StreakOf(ctx, ana); s.Reserve != 1 {
		t.Fatalf("before: %+v", s)
	}
	w.sundayLate(ana)
	var done []string
	rows, err := w.db.Read.Query(`SELECT goal FROM goals_done WHERE user_id = ? AND day = '2026-11-15' ORDER BY goal`, ana)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		done = append(done, id)
	}
	rows.Close()
	if !slices.Equal(done, []string{"day", "eight", "row5"}) {
		t.Fatalf("Sunday's goals done: %v", done)
	}
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 4 || s.Reserve != 2 {
		t.Fatalf("Sunday's full day earned no reserve: %+v", s)
	}
	// Monday's goals are Monday's: Sunday's game moved none of them.
	if goals := w.goalsOf(ana); goals["day"].Done || goals["day"].Progress != 0 {
		t.Fatalf("Monday's goals: %+v", goals)
	}
	if moved, err := w.g.GoalsMoved(ctx, ana, dayRun(t, w, ana)); err != nil || len(moved) != 0 {
		t.Fatalf("Sunday's game told as moving goals: %+v %v", moved, err)
	}
}

// A repair is the games' day's, not the clock's: the day's questions begun before midnight and finished after it win
// the streak back with a game played before midnight; and so does a game begun before midnight and finished within
// DayGrace after it, with the day's questions played before.
func TestRepairAcrossMidnight(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	w.at(15, 12, 0, 0)
	w.daysPlayed(ana, 5, 4, 3) // a streak of three, ended yesterday
	w.daysPlayed(bo, 5, 4, 3)
	if r, _ := w.g.RepairOf(ctx, ana); r == nil {
		t.Fatal("no repair on offer")
	}
	// Ana: a topic's game at 23:50, the day's questions from 23:58 to 00:02.
	w.at(15, 23, 50, 0)
	w.topic(ana)
	w.sundayLate(ana)
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 4 || !slices.Equal(s.Mended, []string{"2026-11-14"}) {
		t.Fatalf("Ana's repair across midnight: %+v", s)
	}
	// Bo: the day's questions at 23:50, a topic's game from 23:58 to 00:02.
	w.at(15, 23, 50, 0)
	w.playDay(bo)
	w.at(15, 23, 58, 0)
	s, err := w.g.StartTopic(ctx, bo, "history")
	if err != nil {
		t.Fatal(err)
	}
	n := len(w.picks(s.ID))
	w.playOn(bo, s.ID, 0, repeat(w.right, n/2)...)
	w.at(16, 0, 2, 0)
	w.playOn(bo, s.ID, n/2, repeat(w.right, n-n/2)...)
	if s, _ := w.g.StreakOf(ctx, bo); s.Days != 4 || !slices.Equal(s.Mended, []string{"2026-11-14"}) {
		t.Fatalf("Bo's repair across midnight: %+v", s)
	}
	// A game finished past the grace is the next day's alone.
	gal := w.user()
	w.at(15, 12, 0, 0)
	w.daysPlayed(gal, 5, 4, 3)
	w.at(15, 23, 50, 0)
	w.playDay(gal)
	w.at(15, 23, 58, 0)
	s, err = w.g.StartTopic(ctx, gal, "history")
	if err != nil {
		t.Fatal(err)
	}
	w.at(16, 0, 0, 0)
	w.wait(DayGrace + time.Minute)
	w.playOn(gal, s.ID, 0, repeat(w.right, n)...)
	if s, _ := w.g.StreakOf(ctx, gal); len(s.Mended) != 0 {
		t.Fatalf("a game finished past the grace mended Sunday: %+v", s)
	}
}

// A week closes a few groups at a time (closeBatch), each write with its places, moves and news; one cut off half-way
// goes on where it stopped, nothing kept or told twice, and the next week opens only once all of it is kept.
func TestWeekClosesInBatches(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	defer func(n int) { closeBatch = n }(closeBatch)
	closeBatch = RaceSize
	var all []int64
	for tier := range 3 {
		for i := range RaceSize {
			p := w.user()
			all = append(all, p)
			if _, err := w.db.Write.Exec(`UPDATE users SET league = ? WHERE id = ?`, tier, p); err != nil {
				t.Fatal(err)
			}
			w.dayGame(p, nil, append(repeat(w.right, i), repeat(w.wrong, Length-i)...)...)
		}
	}
	told := map[int64]int{}
	calls := 0
	w.g.LeagueNews = func(_ context.Context, _ *sql.Tx, news []LeagueNews) error {
		calls++
		if calls == 2 {
			return errors.New("cut off")
		}
		for _, n := range news {
			told[n.To]++
		}
		return nil
	}
	w.at(16, 0, 30, 0)
	if err := w.g.SettleDue(ctx); err == nil {
		t.Fatal("a close cut off half-way went on")
	}
	if n := w.count(`SELECT count(*) FROM league_results`); n != RaceSize {
		t.Fatalf("%d places kept by the first write, not one group's", n)
	}
	var week string
	_ = w.db.Read.QueryRow(`SELECT id FROM league_week`).Scan(&week)
	if week != "2026-11-09" {
		t.Fatalf("the next week opened before the close was done: %s", week)
	}
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM league_results`); n != len(all) {
		t.Fatalf("%d places kept", n)
	}
	for _, p := range all {
		if told[p] != 1 {
			t.Fatalf("player %d told %d times", p, told[p])
		}
	}
	// The first of each group went up once.
	if n := w.count(`SELECT count(*) FROM users WHERE league = 3`); n != 2 { // Родопи's first two
		t.Fatalf("%d in Стара планина", n)
	}
	_ = w.db.Read.QueryRow(`SELECT id FROM league_week`).Scan(&week)
	if week != "2026-11-16" {
		t.Fatalf("the week open: %s", week)
	}
}
