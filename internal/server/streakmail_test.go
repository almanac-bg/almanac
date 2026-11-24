package server

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// A streak of five ended yesterday: one mail, at the player's hour, to a player with an email whom no notification
// reaches. Never twice, nor to anyone else.
func TestStreakMail(t *testing.T) {
	g := start(t)
	s := g.srv
	day := time.Date(2030, 3, 10, 0, 0, 0, 0, bulgaria())
	clock := day
	s.game.Now = func() time.Time { return clock }
	at := func(h, m int) time.Time {
		clock = day.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute)
		return clock
	}
	// Five days at 10:00, Saturday to Wednesday, the last four days ago; the week forgave Thursday and Friday, Saturday ended the
	// streak: yesterday.
	player := func(email string, days int) int64 {
		_, id := g.guest()
		if email != "" {
			if _, err := g.db.Write.Exec(`UPDATE users SET email = ? WHERE id = ?`, email, id); err != nil {
				t.Fatal(err)
			}
		}
		for d := range days {
			g.finishedDay(id, day.AddDate(0, 0, -4-d), 10*time.Hour)
		}
		return id
	}
	player("ana@example.bg", 5)
	bo := player("bo@example.bg", 5) // notifications on in a browser
	if _, err := g.db.Write.Exec(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES ('e', ?, 'p', 'a', 0)`, bo); err != nil {
		t.Fatal(err)
	}
	player("vi@example.bg", 4) // a streak too short
	player("", 5)              // no email
	eve := player("eve@example.bg", 5)
	if err := s.setMailPref(t.Context(), eve, mailStreak, false); err != nil {
		t.Fatal(err)
	}
	gi := player("gi@example.bg", 5) // back today before their hour
	g.finishedDay(gi, day, 8*time.Hour)
	fe := player("fe@example.bg", 5) // mailed 29 days ago
	if _, err := g.db.Write.Exec(`INSERT INTO streak_mails (user_id, day, at) VALUES (?, '2030-02-09', 0)`, fe); err != nil {
		t.Fatal(err)
	}

	if n := s.streakMails(t.Context(), at(9, 29)); n != 0 {
		t.Fatalf("before their hour: %d", n)
	}
	if n := s.streakMails(t.Context(), at(9, 30)); n != 1 {
		t.Fatalf("at their hour: %d", n)
	}
	if n := s.streakMails(t.Context(), at(9, 31)); n != 0 {
		t.Fatalf("again: %d", n)
	}
	s.streakMailing = streakMailing{} // a restart: what was in memory is gone, the claims aren't
	if n := s.streakMails(t.Context(), at(12, 0)); n != 0 {
		t.Fatalf("after a restart: %d", n)
	}
	g.outbox.Flush(t.Context())
	if len(g.inbox.got) != 1 {
		t.Fatalf("sent %+v", g.inbox.got)
	}
	byTo := map[string]string{}
	for _, m := range g.inbox.got {
		// Its link to the game says where it came from: a browser signed out is asked to sign in first.
		// It never names the ended streak's number.
		if m.Subject != "Започни нова серия днес" || strings.ContainsAny(m.Subject+m.Text[:strings.Index(m.Text, "http")], "0123456789") ||
			!strings.Contains(m.Text, m.Unsubscribe) ||
			!strings.Contains(m.Unsubscribe, "/mail/off?") || !strings.Contains(m.Text, "/?from=mail") {
			t.Fatalf("the mail: %+v", m)
		}
		byTo[m.To] = m.Text
	}
	if !strings.Contains(byTo["ana@example.bg"], "Днес можеш да започнеш нова серия.") {
		t.Fatalf("Ana's: %q", byTo["ana@example.bg"])
	}
}

// The link in the mail stops it with a tap, no sign-in needed (and a mail program's own button posts to it); a link
// not signed by the server does nothing. Настройки has the same switch, for those the mail is for.
func TestStreakMailOff(t *testing.T) {
	g := start(t)
	s := g.srv
	ana, anaID := g.guest()
	if _, err := g.db.Write.Exec(`UPDATE users SET email = 'ana@example.bg' WHERE id = ?`, anaID); err != nil {
		t.Fatal(err)
	}
	if _, prefs := ana.call("GET", "/api/mail/prefs", nil); prefs["can"] != true || prefs["streak"] != true {
		t.Fatalf("prefs: %v", prefs)
	}
	link := s.mailOffURL(anaID, mailStreak)
	page := func(method, link string) string {
		res, err := http.DefaultClient.Do(must(http.NewRequest(method, strings.Replace(link, s.cfg.PublicURL, g.url, 1), nil)))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return string(b)
	}
	if body := page("GET", link); !strings.Contains(body, "Спри писмата") {
		t.Fatalf("the page: %s", body)
	}
	if on, _ := s.wantsMail(t.Context(), anaID, mailStreak); !on {
		t.Fatal("opening the link turned the mail off")
	}
	forged := strings.Replace(link, "u="+fmt.Sprint(anaID), "u="+fmt.Sprint(anaID+1), 1)
	if body := page("POST", forged); !strings.Contains(body, "не работи") {
		t.Fatalf("a forged link: %s", body)
	}
	if body := page("POST", link); !strings.Contains(body, "Готово") || !strings.Contains(body, "включи писмата пак") {
		t.Fatalf("turned off: %s", body)
	}
	if _, prefs := ana.call("GET", "/api/mail/prefs", nil); prefs["streak"] != false {
		t.Fatalf("prefs after the link: %v", prefs)
	}
	// The link of a player since deleted: nothing left to stop, so done (it was „Нещо се обърка“, the audit of
	// 2026-11-24), and nothing kept of them.
	if body := page("POST", s.mailOffURL(anaID+1000, mailStreak)); !strings.Contains(body, "Готово") {
		t.Fatalf("a deleted player's link: %s", body)
	}
	var kept int
	if _ = g.db.Read.QueryRow(`SELECT count(*) FROM mail_prefs WHERE user_id = ?`, anaID+1000).Scan(&kept); kept != 0 {
		t.Fatal("a pref kept for a player who isn't there")
	}
	if _, prefs := ana.call("PATCH", "/api/mail/prefs", map[string]any{"kind": "streak", "on": true}); prefs["streak"] != true {
		t.Fatalf("turned on again: %v", prefs)
	}
	if status, _ := ana.call("PATCH", "/api/mail/prefs", map[string]any{"kind": "other", "on": true}); status != 400 {
		t.Fatalf("an unknown kind: %d", status)
	}
	// A guest, with no email, can't have it.
	bo, _ := g.guest()
	if _, prefs := bo.call("GET", "/api/mail/prefs", nil); prefs["can"] != false {
		t.Fatalf("a guest's prefs: %v", prefs)
	}
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}
