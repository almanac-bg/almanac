package server

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestRemindMinute(t *testing.T) {
	hm := func(h, m int) int { return h*60 + m }
	for _, c := range []struct {
		finished []int
		want     int
	}{
		{nil, hm(19, 0)},                                      // no days yet
		{[]int{hm(10, 0)}, hm(9, 30)},                         // half an hour before
		{[]int{hm(9, 0), hm(10, 0), hm(22, 0)}, hm(9, 30)},    // the median, not the mean
		{[]int{hm(10, 0), hm(12, 0)}, hm(10, 30)},             // the middle two's middle
		{[]int{hm(7, 0)}, hm(8, 0)},                           // not before 8:00
		{[]int{hm(0, 10)}, hm(8, 0)},                          // a night owl's morning
		{[]int{hm(21, 20)}, hm(20, 50)},                       // half an hour before, in the evening too
		{[]int{hm(23, 50)}, hm(21, 30)},                       // at most 21:30
		{[]int{hm(22, 30), hm(22, 0), hm(18, 0)}, hm(21, 30)}, // the latest
		{[]int{hm(20, 0), hm(21, 0), hm(9, 0)}, hm(19, 30)},   // an evening player
	} {
		if got := RemindMinute(c.finished); got != c.want {
			t.Errorf("%v: %d:%02d, want %d:%02d", c.finished, got/60, got%60, c.want/60, c.want%60)
		}
	}
}

// A player is reminded at their own hour, once; one who has no days yet at 19:00. A restart doesn't send two.
func TestRemindAtTheirHour(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	bo, _ := g.guest()
	subscribe(ana, "/ana")
	subscribe(bo, "/bo")
	day := time.Date(2030, 3, 4, 0, 0, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return day.Add(12 * time.Hour) }
	// Ana finished the day at 10:00, 10:20 and 11:00 on her last three days: she's reminded at 9:50.
	for i, at := range []time.Duration{10 * time.Hour, 10*time.Hour + 20*time.Minute, 11 * time.Hour} {
		g.finishedDay(anaID, day.AddDate(0, 0, -i-1), at)
	}
	at := func(h, m int) time.Time { return day.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute) }
	if n := s.remindSent(t.Context(), at(9, 49)); n != 0 {
		t.Fatalf("before Ana's hour: %d", n)
	}
	if n := s.remindSent(t.Context(), at(9, 50)); n != 1 || fake.count("/ana") != 1 || fake.count("/bo") != 0 {
		t.Fatalf("at Ana's hour: %d (ana %d, bo %d)", n, fake.count("/ana"), fake.count("/bo"))
	}
	if n := s.remindSent(t.Context(), at(9, 51)); n != 0 {
		t.Fatal("Ana reminded twice")
	}
	if n := s.remindSent(t.Context(), at(18, 59)); n != 0 {
		t.Fatal("Bo before 19:00")
	}
	s.reminders = reminders{} // a restart: what was in memory is gone, the claims aren't
	if n := s.remindSent(t.Context(), at(19, 0)); n != 1 || fake.count("/bo") != 1 || fake.count("/ana") != 1 {
		t.Fatalf("at 19:00: %d (ana %d, bo %d)", n, fake.count("/ana"), fake.count("/bo"))
	}
	var claims int
	_ = g.db.Read.QueryRow(`SELECT count(*) FROM push_reminded WHERE day = '2030-03-04'`).Scan(&claims)
	if claims != 2 || g.counted("push:sent:day") != 2 {
		t.Fatalf("claims %d, sent %d", claims, g.counted("push:sent:day"))
	}
}

// After three reminders left without playing the day, none more; on the 7th day without play one last, then nothing
// until the player plays the day again.
func TestRemindersBackOff(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	subscribe(ana, "/ana")
	start := time.Date(2030, 3, 1, 0, 0, 0, 0, bulgaria())
	clock := start
	s.game.Now = func() time.Time { return clock }
	// A streak of 7 days, the last on 1 March: every weekday is one she plays.
	for i := range 7 {
		g.finishedDay(anaID, start.AddDate(0, 0, -i), 18*time.Hour)
	}
	sent := map[int]bool{}
	for d := 1; d <= 9; d++ {
		clock = start.AddDate(0, 0, d).Add(20 * time.Hour)
		if s.remindSent(t.Context(), clock) == 1 {
			sent[d] = true
		}
	}
	for d := 1; d <= 9; d++ {
		if want := d <= 3 || d == 7; sent[d] != want {
			t.Fatalf("day %d after the last played: reminded %v, want %v (all: %v)", d, sent[d], want, sent)
		}
	}
	if fake.count("/ana") != 4 || g.counted("push:sent:stop") != 1 || g.counted("push:sent:day") != 3 {
		t.Fatalf("pushes %d, last %d", fake.count("/ana"), g.counted("push:sent:stop"))
	}
	if m := s.lastReminder(t.Context(), anaID); m.Body != "Днешният брой те чака" ||
		m.Title != "Спираме напомнянията, докато не играеш пак" || m.Kind != "stop" {
		t.Fatalf("the last: %+v", m)
	}

	// Ana plays the day on the 10th: the next day she's reminded again.
	g.finishedDay(anaID, start.AddDate(0, 0, 10), 18*time.Hour)
	clock = start.AddDate(0, 0, 11).Add(20 * time.Hour)
	if n := s.remindSent(t.Context(), clock); n != 1 {
		t.Fatal("not reminded after playing again")
	}
}

// The last word names the nearest step in the player's book, when play gives one, and never a streak that ended, nor
// a question's text: the day's issue alone otherwise.
func TestLastReminderNamesTheNearestStep(t *testing.T) {
	s, g, _, _ := pushWorld(t)
	_, id := g.guest()
	day := time.Date(2030, 3, 1, 0, 0, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return day.AddDate(0, 0, 8) }
	for i := range 6 { // a streak of six, ended
		g.finishedDay(id, day.AddDate(0, 0, -i), 9*time.Hour)
	}
	if m := s.lastReminder(t.Context(), id); m.Body != "Днешният брой те чака" {
		t.Fatalf("no step known: %q", m.Body)
	}
	s.nearestStep = func(_ context.Context, userID int64) (Step, bool, error) {
		return Step{Chapter: "История", Left: 1, Rank: "Тетрадка"}, userID == id, nil
	}
	m := s.lastReminder(t.Context(), id)
	if m.Body != "Днешният брой те чака · История: още 1 с мастило до „Тетрадка“" || strings.Contains(m.Body, "6") ||
		strings.Contains(m.Body, "Серия") {
		t.Fatalf("with a step: %q", m.Body)
	}
	_, other := g.guest()
	if m := s.lastReminder(t.Context(), other); m.Body != "Днешният брой те чака" {
		t.Fatalf("a player with no step: %q", m.Body)
	}
	s.nearestStep = func(context.Context, int64) (Step, bool, error) { return Step{}, false, errors.New("down") }
	if m := s.lastReminder(t.Context(), id); m.Body != "Днешният брой те чака" {
		t.Fatalf("play failing: %q", m.Body)
	}
}

// A reminder left on a weekday the player never plays on doesn't count as ignored: one who plays Monday to Friday
// is still reminded on Monday after a weekend of reminders, and the rhythm is theirs from their first week.
func TestRemindersOnTheirWeekdays(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	subscribe(ana, "/ana")
	// One week played, Monday 4 to Friday 8 March 2030.
	for d := 4; d <= 8; d++ {
		g.finishedDay(anaID, time.Date(2030, 3, d, 0, 0, 0, 0, bulgaria()), 18*time.Hour)
	}
	clock := time.Date(2030, 3, 9, 20, 0, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return clock }
	var sent []string
	for d := 9; d <= 14; d++ { // Saturday to Thursday, unplayed
		clock = time.Date(2030, 3, d, 20, 0, 0, 0, bulgaria())
		if s.remindSent(t.Context(), clock) == 1 {
			sent = append(sent, clock.Weekday().String()[:3])
		}
	}
	// Saturday and Sunday don't count; Monday, Tuesday and Wednesday do: none on Thursday.
	if strings.Join(sent, " ") != "Sat Sun Mon Tue Wed" || fake.count("/ana") != 5 {
		t.Fatalf("reminded on %v (%d pushes)", sent, fake.count("/ana"))
	}
}

// A player who played one day has a rhythm of one weekday: the reminders on the others stop all the same, the
// RemindQuietAfter-th the last word (review 2026-11-20: 21 reminders to a one-day player).
func TestRemindersOneDayPlayer(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	subscribe(ana, "/ana")
	g.finishedDay(anaID, time.Date(2030, 3, 6, 0, 0, 0, 0, bulgaria()), 18*time.Hour) // one Wednesday
	clock := time.Date(2030, 3, 7, 20, 0, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return clock }
	sent := 0
	for d := 7; d <= 37; d++ {
		clock = time.Date(2030, 3, d, 20, 0, 0, 0, bulgaria())
		sent += s.remindSent(t.Context(), clock)
	}
	if sent != RemindQuietAfter || fake.count("/ana") != RemindQuietAfter {
		t.Fatalf("a one-day player reminded %d times in a month (%d pushes), want %d", sent, fake.count("/ana"),
			RemindQuietAfter)
	}
	var last int
	if err := g.db.Read.QueryRow(`SELECT count(*) FROM push_reminded WHERE user_id = ? AND last`, anaID).Scan(&last); err != nil ||
		last != 1 {
		t.Fatalf("the last word: %d %v", last, err)
	}
}

// From a player's third week, a reminder goes only on the weekdays they play: one who plays on Wednesdays hears
// nothing on a Saturday, and is reminded on the next Wednesday.
func TestRemindersOnlyOnTheirWeekdaysFromWeekThree(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	subscribe(ana, "/ana")
	for d := 6; d <= 27; d += 7 { // Wednesdays, 6 to 27 March 2030
		g.finishedDay(anaID, time.Date(2030, 3, d, 0, 0, 0, 0, bulgaria()), 18*time.Hour)
	}
	clock := time.Date(2030, 3, 30, 20, 0, 0, 0, bulgaria()) // a Saturday
	s.game.Now = func() time.Time { return clock }
	if n := s.remindSent(t.Context(), clock); n != 0 || fake.count("/ana") != 0 {
		t.Fatalf("a Saturday: reminded %d", n)
	}
	clock = time.Date(2030, 4, 3, 20, 0, 0, 0, bulgaria()) // the next Wednesday
	if n := s.remindSent(t.Context(), clock); n != 1 {
		t.Fatalf("a Wednesday: reminded %d", n)
	}
	// In their first two weeks, any day.
	bo, boID := g.guest()
	subscribe(bo, "/bo")
	g.finishedDay(boID, time.Date(2030, 3, 27, 0, 0, 0, 0, bulgaria()), 18*time.Hour) // one Wednesday
	clock = time.Date(2030, 3, 30, 20, 0, 0, 0, bulgaria())
	if n := s.remindSent(t.Context(), clock); n != 1 || fake.count("/bo") != 1 {
		t.Fatalf("a new player on a Saturday: reminded %d", n)
	}
}

// finishedDay puts a day's game the player finished on a day, at a time of it, straight in the database.
func (g *game) finishedDay(userID int64, day time.Time, at time.Duration) {
	g.t.Helper()
	ms := day.Add(at).UnixMilli()
	if _, err := g.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, at, started_at, finished_at)
		VALUES (?, 'day', ?, '[]', 10, ?, ?)`, userID, day.Format(time.DateOnly), ms-300000, ms); err != nil {
		g.t.Fatal(err)
	}
}
