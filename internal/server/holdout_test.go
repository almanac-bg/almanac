package server

import (
	"io"
	"strings"
	"testing"
	"time"
)

// A player held out of the reminders (play.HeldReminders) is claimed at their hour as any other and never sent; the
// held stop as the reminded do; and /admin compares the two groups (review 2026-11-18, D4).
func TestRemindersHeldOut(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	bo, boID := g.guest()
	subscribe(ana, "/ana")
	subscribe(bo, "/bo")
	s.heldOut = func(id int64) bool { return id == boID }
	day := time.Date(2030, 3, 4, 0, 0, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return day.Add(12 * time.Hour) }
	if n := s.remindSent(t.Context(), day.Add(19*time.Hour)); n != 1 || fake.count("/ana") != 1 || fake.count("/bo") != 0 {
		t.Fatalf("reminded %d (ana %d, bo %d)", n, fake.count("/ana"), fake.count("/bo"))
	}
	var held bool
	if err := g.db.Read.QueryRow(`SELECT held FROM push_reminded WHERE user_id = ? AND day = '2030-03-04'`, boID).
		Scan(&held); err != nil || !held {
		t.Fatalf("Bo's claim: held %v, %v", held, err)
	}
	// Three days left without play, and both stop: Bo's held claims count as reminders that reached him.
	for d := 1; d <= 3; d++ {
		next := day.AddDate(0, 0, d)
		s.game.Now = func() time.Time { return next.Add(12 * time.Hour) }
		s.remindSent(t.Context(), next.Add(19*time.Hour))
	}
	claims := func(id int64) int {
		var n int
		_ = g.db.Read.QueryRow(`SELECT count(*) FROM push_reminded WHERE user_id = ?`, id).Scan(&n)
		return n
	}
	if claims(anaID) != 3 || claims(boID) != 3 || fake.count("/bo") != 0 {
		t.Fatalf("claims: Ana %d, Bo %d", claims(anaID), claims(boID))
	}
	// Ana played a day after one: /admin tells the two groups apart.
	g.finishedDay(anaID, day.AddDate(0, 0, 1), 20*time.Hour)
	rows, err := s.holdout(t.Context(), "2030-03-08")
	if err != nil {
		t.Fatal(err)
	}
	if r := rows[0]; r.Sent.rate != (rate{1, 3}) || r.Held.rate != (rate{0, 3}) || r.Sent.Players != 1 || r.Held.Players != 1 {
		t.Fatalf("the day finished after: %+v", r)
	}
	if r := rows[1]; r.Sent.rate != (rate{1, 3}) || r.Held.rate != (rate{0, 3}) {
		t.Fatalf("within two hours: %+v", r)
	}
	// Told from the experiment's first whole day (kv, set by the migration that began it): the days before aren't in.
	if _, err := g.db.Write.Exec(`INSERT INTO kv (key, value) VALUES ('reminders_from', '2030-03-06')`); err != nil {
		t.Fatal(err)
	}
	if rows, err = s.holdout(t.Context(), "2030-03-08"); err != nil {
		t.Fatal(err)
	}
	if r := rows[0]; r.Sent.rate != (rate{0, 1}) || r.Held.rate != (rate{0, 1}) {
		t.Fatalf("from the 6th: %+v", r)
	}
}

// The hold-out is counted by player: one player's claims go together, and the interval is as wide as the players
// make it, not the claims.
func TestHoldoutByPlayer(t *testing.T) {
	one := byPlayer([]claims{{10, 20}})
	many := byPlayer(func() []claims {
		var out []claims
		for i := range 20 {
			out = append(out, claims{i % 2, 1})
		}
		return out
	}())
	if one.rate != (rate{10, 20}) || many.rate != (rate{10, 20}) || one.Players != 1 || many.Players != 20 {
		t.Fatalf("one %+v, many %+v", one, many)
	}
	width := func(p players) int {
		lo, hi := wilson(float64(p.N)/float64(p.Of), p.eff)
		return hi - lo
	}
	if width(one) <= width(many) {
		t.Fatalf("one player's 20 claims (%d) tell as much as 20 players' (%d)", width(one), width(many))
	}
	// Players alike (each half their claims) tell more than players apart (each all or none), with as many claims.
	alike := byPlayer([]claims{{2, 4}, {2, 4}, {2, 4}, {2, 4}})
	apart := byPlayer([]claims{{4, 4}, {0, 4}, {4, 4}, {0, 4}})
	if width(alike) >= width(apart) {
		t.Fatalf("alike %d, apart %d", width(alike), width(apart))
	}
	if !strings.Contains(string(many.HTML()), "20 играча") || !strings.Contains(string(one.HTML()), "<small>1 играч</small>") {
		t.Fatalf("cells: %s, %s", many.HTML(), one.HTML())
	}
	if byPlayer(nil).HTML() != `<span class="rate none">—</span>` {
		t.Fatal("none")
	}
}

// The day's reminder by mail isn't held out (the owner's call): a player who asked for it gets it, though held out of
// the notification and the streak's mail, and a streak's mail held from them that day leaves the day to it.
func TestDayMailNotHeldOut(t *testing.T) {
	g := start(t)
	s := g.srv
	day := time.Date(2030, 3, 10, 0, 0, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return day.Add(12 * time.Hour) }
	_, id := g.guest()
	if _, err := g.db.Write.Exec(`UPDATE users SET email = 'ana@example.bg' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if err := s.setMailPref(t.Context(), id, mailDay, true); err != nil {
		t.Fatal(err)
	}
	g.finishedDay(id, day.AddDate(0, 0, -1), 10*time.Hour)
	s.heldOut = func(int64) bool { return true }
	if _, err := g.db.Write.Exec(`INSERT INTO streak_mails (user_id, day, at, held) VALUES (?, '2030-03-10', 1, 1)`, id); err != nil {
		t.Fatal(err)
	}
	if n := s.dayMails(t.Context(), day.Add(12*time.Hour)); n != 1 {
		t.Fatalf("mailed %d", n)
	}
	g.outbox.Flush(t.Context())
	if len(g.inbox.got) != 1 || g.counted("mail:day:sent") != 1 {
		t.Fatalf("sent %d, counted %d", len(g.inbox.got), g.counted("mail:day:sent"))
	}
	// A streak's mail that went is a mail that day: none more.
	if _, err := g.db.Write.Exec(`UPDATE streak_mails SET held = 0, day = '2030-03-11'`); err != nil {
		t.Fatal(err)
	}
	next := day.AddDate(0, 0, 1)
	s.game.Now = func() time.Time { return next.Add(12 * time.Hour) }
	if n := s.dayMails(t.Context(), next.Add(12*time.Hour)); n != 0 {
		t.Fatalf("mailed %d beside the streak's", n)
	}
}

// The streak's mail too: claimed for one held out, never sent.
func TestStreakMailHeldOut(t *testing.T) {
	g := start(t)
	s := g.srv
	day := time.Date(2030, 3, 10, 0, 0, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return day.Add(12 * time.Hour) }
	_, id := g.guest()
	if _, err := g.db.Write.Exec(`UPDATE users SET email = 'ana@example.bg' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	for d := range 5 {
		g.finishedDay(id, day.AddDate(0, 0, -3-d), 10*time.Hour)
	}
	s.heldOut = func(int64) bool { return true }
	if n := s.streakMails(t.Context(), day.Add(12*time.Hour)); n != 0 {
		t.Fatalf("mailed %d", n)
	}
	g.outbox.Flush(t.Context())
	var held bool
	if err := g.db.Read.QueryRow(`SELECT held FROM streak_mails WHERE user_id = ?`, id).Scan(&held); err != nil || !held ||
		len(g.inbox.got) != 0 {
		t.Fatalf("held %v, %v, sent %d", held, err, len(g.inbox.got))
	}
}

// Yesterday is told against a whole day four weeks before, not today, under way, against one.
func TestAdminTilesOfDaysOver(t *testing.T) {
	g := start(t)
	s := g.srv
	day := time.Date(2030, 3, 20, 0, 0, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return day.Add(9 * time.Hour) }
	admin := g.player()
	admin.call("POST", "/api/guest", map[string]any{})
	_, _ = g.db.Write.Exec(`UPDATE users SET admin = 1`)
	for range 2 {
		_, id := g.guest()
		g.finishedDay(id, day.AddDate(0, 0, -1), 10*time.Hour)
		_, _ = g.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?, '2030-03-19')`, id)
	}
	res, err := admin.client.Get(g.url + "/admin")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(b), `<p class="tile-name">Играли вчера</p>
<p class="tile-value">2</p>`) {
		t.Fatalf("the tiles: %s", b[strings.Index(string(b), `class="tiles"`):][:600])
	}
}

// /admin with players in it: people only (an admin's games aren't), the charts drawn, a week's cohort frozen once
// over (D1–D12).
func TestAdminMeasures(t *testing.T) {
	g := start(t)
	s := g.srv
	day := time.Date(2030, 3, 20, 0, 0, 0, 0, bulgaria()) // a Wednesday
	clock := day.Add(12 * time.Hour)
	s.game.Now = func() time.Time { return clock }
	admin := g.player()
	_, out := admin.call("POST", "/api/guest", map[string]any{})
	adminID := int64(out["user"].(map[string]any)["id"].(float64))
	_, _ = g.db.Write.Exec(`UPDATE users SET admin = 1`)
	// Players new three weeks back, a phone's; two come back the next day.
	first := day.AddDate(0, 0, -16) // Monday the 4th
	var ids []int64
	for i := range 4 {
		_, id := g.guest()
		ids = append(ids, id)
		at := first.Add(10 * time.Hour)
		if _, err := g.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, at, started_at, finished_at, device)
			VALUES (?, 'day', ?, '[]', 10, ?, ?, 'phone')`, id, first.Format(time.DateOnly), at.UnixMilli(), at.UnixMilli()+1); err != nil {
			t.Fatal(err)
		}
		_, _ = g.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?, ?)`, id, first.Format(time.DateOnly))
		if i < 2 {
			g.finishedDay(id, first.AddDate(0, 0, 1), 10*time.Hour)
			_, _ = g.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?, ?)`, id, first.AddDate(0, 0, 1).Format(time.DateOnly))
		}
	}
	// The admin played too: not counted.
	g.finishedDay(adminID, first, 11*time.Hour)
	_, _ = g.db.Write.Exec(`INSERT INTO active_days (user_id, day) SELECT id, ? FROM users WHERE admin`, first.Format(time.DateOnly))

	body := func() string {
		res, err := admin.client.Get(g.url + "/admin")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return string(b)
	}
	page := body()
	for _, part := range []string{"<svg", `class="line s1"`, "04.03–10.03", "Телефон", "Денят пак (1–7)"} {
		if !strings.Contains(page, part) {
			t.Fatalf("the page has no %q", part)
		}
	}
	var n, total int
	if err := g.db.Read.QueryRow(`SELECT n, total FROM cohort_weeks WHERE week = '2030-03-04' AND measure = 'd1'`).
		Scan(&n, &total); err != nil || n != 2 || total != 4 {
		t.Fatalf("the week frozen: %d of %d, %v", n, total, err)
	}
	if err := g.db.Read.QueryRow(`SELECT n FROM cohort_weeks WHERE week = '2030-03-04' AND measure = 'new'`).Scan(&n); err != nil || n != 4 {
		t.Fatalf("the week's new: %d, %v", n, err)
	}
	// Frozen: a merge later takes one of them away, and the week stays as it was.
	_, _ = g.db.Write.Exec(`DELETE FROM active_days WHERE user_id = ?`, ids[3])
	if !strings.Contains(body(), `title="Замразени`) {
		t.Fatal("the frozen week isn't marked")
	}
	_ = g.db.Read.QueryRow(`SELECT n FROM cohort_weeks WHERE week = '2030-03-04' AND measure = 'new'`).Scan(&n)
	if n != 4 {
		t.Fatalf("the frozen week changed: %d", n)
	}
}
