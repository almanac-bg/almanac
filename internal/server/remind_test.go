package server

import (
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
		{[]int{hm(21, 0)}, hm(20, 30)},                        // just before Роял
		{[]int{hm(21, 10)}, hm(20, 40)},                       // still before it
		{[]int{hm(21, 20)}, hm(20, 30)},                       // in Роял's evening: before it
		{[]int{hm(23, 50)}, hm(20, 30)},                       // at most 21:30, which is Роял's
		{[]int{hm(22, 30), hm(22, 0), hm(18, 0)}, hm(20, 30)}, // 21:30, the latest, is Роял's too
		{[]int{hm(20, 0), hm(21, 0), hm(9, 0)}, hm(19, 30)},   // an evening player before Роял
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
	// A streak of 4 days, the last on 1 March.
	for i := range 4 {
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
	if m := s.lastReminder(t.Context(), anaID, "2030-03-01"); m.Body != "Въпросите на деня са тук, когато решиш. Серията ти беше 4 дни." ||
		m.Title != "Спираме напомнянията засега" || m.Kind != "stop" {
		t.Fatalf("the last: %+v", m)
	}

	// Ana plays the day on the 10th: the next day she's reminded again.
	g.finishedDay(anaID, start.AddDate(0, 0, 10), 18*time.Hour)
	clock = start.AddDate(0, 0, 11).Add(20 * time.Hour)
	if n := s.remindSent(t.Context(), clock); n != 1 {
		t.Fatal("not reminded after playing again")
	}
}

// The last word leaves out a streak of one day.
func TestLastReminderWithoutAStreak(t *testing.T) {
	s, g, _, _ := pushWorld(t)
	_, id := g.guest()
	day := time.Date(2030, 3, 1, 0, 0, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return day.AddDate(0, 0, 8) }
	g.finishedDay(id, day, 9*time.Hour)
	if m := s.lastReminder(t.Context(), id, "2030-03-01"); m.Body != "Въпросите на деня са тук, когато решиш." {
		t.Fatalf("one day: %q", m.Body)
	}
	if strings.Contains(s.lastReminder(t.Context(), id, "2030-03-01").Body, "Серия") {
		t.Fatal("a streak of one")
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
