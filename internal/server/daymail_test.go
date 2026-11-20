package server

import (
	"strings"
	"testing"
	"time"
)

// The day's reminder by mail goes, at the player's hour, only to a player who asked for it, has an email (proved by
// the sign-in code: the only way one is set) and no notifications on any device, and hasn't played the day yet; once
// a day, none after three left unplayed, none in the night, none on a day the streak's mail went.
func TestDayMail(t *testing.T) {
	g := start(t)
	s := g.srv
	day := time.Date(2030, 3, 10, 0, 0, 0, 0, bulgaria())
	clock := day
	s.game.Now = func() time.Time { return clock }
	at := func(h, m int) time.Time {
		clock = day.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute)
		return clock
	}
	// Played yesterday and the day before at 10:00: reminded at 9:30.
	player := func(email string, on bool) int64 {
		_, id := g.guest()
		if email != "" {
			if _, err := g.db.Write.Exec(`UPDATE users SET email = ? WHERE id = ?`, email, id); err != nil {
				t.Fatal(err)
			}
		}
		if on {
			if err := s.setMailPref(t.Context(), id, mailDay, true); err != nil {
				t.Fatal(err)
			}
		}
		g.finishedDay(id, day.AddDate(0, 0, -1), 10*time.Hour)
		g.finishedDay(id, day.AddDate(0, 0, -2), 10*time.Hour)
		return id
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := g.db.Write.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	player("ana@example.bg", true)
	bo := player("bo@example.bg", true) // notifications on in a browser: they remind
	exec(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES ('e', ?, 'p', 'a', 0)`, bo)
	player("vi@example.bg", false) // never asked
	player("", true)               // no email
	gi := player("gi@example.bg", true)
	g.finishedDay(gi, day, 8*time.Hour) // played today before their hour
	ha := player("ha@example.bg", true) // three mails since they last played
	exec(`DELETE FROM runs WHERE user_id = ?`, ha)
	g.finishedDay(ha, day.AddDate(0, 0, -4), 10*time.Hour)
	exec(`INSERT INTO day_mails (user_id, day, at) VALUES (?1, '2030-03-07', 0), (?1, '2030-03-08', 0), (?1, '2030-03-09', 0)`, ha)
	fe := player("fe@example.bg", true) // two since: one more
	exec(`DELETE FROM runs WHERE user_id = ?`, fe)
	g.finishedDay(fe, day.AddDate(0, 0, -3), 10*time.Hour)
	exec(`INSERT INTO day_mails (user_id, day, at) VALUES (?1, '2030-03-08', 0), (?1, '2030-03-09', 0)`, fe)
	ju := player("ju@example.bg", true) // the streak's mail went today
	exec(`INSERT INTO streak_mails (user_id, day, at) VALUES (?, '2030-03-10', 0)`, ju)

	if n := s.dayMails(t.Context(), at(9, 29)); n != 0 {
		t.Fatalf("before their hour: %d", n)
	}
	if n := s.dayMails(t.Context(), at(9, 30)); n != 2 {
		t.Fatalf("at their hour: %d", n)
	}
	if n := s.dayMails(t.Context(), at(9, 31)); n != 0 {
		t.Fatalf("again: %d", n)
	}
	s.dayMailing = reminders{} // a restart: what was in memory is gone, the claims aren't
	if n := s.dayMails(t.Context(), at(12, 0)); n != 0 {
		t.Fatalf("after a restart: %d", n)
	}
	g.outbox.Flush(t.Context())
	if len(g.inbox.got) != 2 || g.counted("mail:day:sent") != 2 {
		t.Fatalf("sent %+v, counted %d", g.inbox.got, g.counted("mail:day:sent"))
	}
	for _, m := range g.inbox.got {
		if m.To != "ana@example.bg" && m.To != "fe@example.bg" {
			t.Fatalf("to %s", m.To)
		}
		if m.Subject != "Въпросите на деня те чакат" || !strings.Contains(m.Text, m.Unsubscribe) ||
			!strings.Contains(m.Unsubscribe, "k=day") || !strings.Contains(m.Text, "/?from=mail\n") {
			t.Fatalf("the mail: %+v", m)
		}
	}

	// The next day: Ana, Gi and Ju again, Fe not (three since she last played). In the night, nobody.
	day = day.AddDate(0, 0, 1)
	if n := s.dayMails(t.Context(), at(22, 30)); n != 0 {
		t.Fatalf("in the night: %d", n)
	}
	if n := s.dayMails(t.Context(), at(9, 30)); n != 3 {
		t.Fatalf("the next day: %d", n)
	}
}

// The day's mail is asked for only with an email; off by default, unlike the streak's; stopped by its link with a tap.
func TestDayMailPrefs(t *testing.T) {
	g := start(t)
	s := g.srv
	guest, _ := g.guest()
	if status, _ := guest.call("PATCH", "/api/mail/prefs", map[string]any{"kind": "day", "on": true}); status != 400 {
		t.Fatalf("a guest asked for it: %d", status)
	}
	ana, anaID := g.guest()
	if _, err := g.db.Write.Exec(`UPDATE users SET email = 'ana@example.bg' WHERE id = ?`, anaID); err != nil {
		t.Fatal(err)
	}
	if _, prefs := ana.call("GET", "/api/mail/prefs", nil); prefs["day"] != false || prefs["streak"] != true {
		t.Fatalf("prefs: %v", prefs)
	}
	if _, prefs := ana.call("PATCH", "/api/mail/prefs", map[string]any{"kind": "day", "on": true}); prefs["day"] != true ||
		prefs["can"] != true {
		t.Fatalf("turned on: %v", prefs)
	}
	link := strings.Replace(s.mailOffURL(anaID, mailDay), s.cfg.PublicURL, g.url, 1)
	if status, body := g.from("203.0.113.1", "GET", strings.TrimPrefix(link, g.url), ""); status != 200 ||
		!strings.Contains(body, "веднъж на ден") {
		t.Fatalf("the page: %d %s", status, body)
	}
	if status, body := g.from("203.0.113.1", "POST", strings.TrimPrefix(link, g.url), ""); status != 200 ||
		!strings.Contains(body, "Няма да ти пишем") {
		t.Fatalf("turned off: %d %s", status, body)
	}
	if _, prefs := ana.call("GET", "/api/mail/prefs", nil); prefs["day"] != false || prefs["streak"] != true {
		t.Fatalf("prefs after the link: %v", prefs)
	}
}
