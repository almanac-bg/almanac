package server

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// In December, from the 15th, each player with seven days in the game that year hears their year once, at their hour:
// by notification where one reaches them (held from one held out of the reminders), else by mail while they keep the
// game's mail; never twice, a restart or not; nothing before the 15th, nor to one with six days.
func TestYearWord(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	day := time.Date(2030, 12, 15, 0, 0, 0, 0, bulgaria())
	clock := day.Add(9 * time.Hour)
	s.game.Now = func() time.Time { return clock }
	at := func(d time.Time) time.Time { clock = d; return d }
	played := func(id int64, days int) {
		for d := range days {
			if _, err := g.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?, ?)`, id,
				fmt.Sprintf("2030-06-%02d", d+1)); err != nil {
				t.Fatal(err)
			}
		}
	}
	ana, anaID := g.guest() // notifications on: by notification
	subscribe(ana, "/ana")
	played(anaID, 7)
	bo, boID := g.guest() // held out: claimed, not sent
	subscribe(bo, "/bo")
	played(boID, 9)
	s.heldOut = func(id int64) bool { return id == boID }
	_, viID := g.guest() // an email and no notifications: by mail
	played(viID, 8)
	_, eveID := g.guest() // an email, the game's mail off
	played(eveID, 8)
	_, gaID := g.guest() // six days
	played(gaID, 6)
	_, noID := g.guest() // no way to reach
	played(noID, 7)
	for _, p := range []struct {
		id    int64
		email string
	}{{viID, "vi@example.bg"}, {eveID, "eve@example.bg"}, {gaID, "ga@example.bg"}} {
		if _, err := g.db.Write.Exec(`UPDATE users SET email = ? WHERE id = ?`, p.email, p.id); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.setMailPref(t.Context(), eveID, mailStreak, false); err != nil {
		t.Fatal(err)
	}

	if n := s.yearWords(t.Context(), at(day.Add(-24*time.Hour+12*time.Hour))); n != 0 {
		t.Fatalf("on the 14th: %d", n)
	}
	if n := s.yearWords(t.Context(), at(day.Add(7*time.Hour))); n != 0 {
		t.Fatalf("in the night: %d", n)
	}
	if n := s.yearWords(t.Context(), at(day.Add(19*time.Hour))); n != 2 {
		t.Fatalf("at their hour: %d", n)
	}
	s.sendQueued(t.Context())
	s.yearWording = yearWording{} // a restart: what was in memory is gone, the claims aren't
	if n := s.yearWords(t.Context(), at(day.Add(20*time.Hour))); n != 0 {
		t.Fatalf("again: %d", n)
	}
	if fake.count("/ana") != 1 || fake.count("/bo") != 0 {
		t.Fatalf("notifications: Ana %d, Bo %d", fake.count("/ana"), fake.count("/bo"))
	}
	claims := map[int64]string{}
	rows, err := g.db.Read.Query(`SELECT user_id, how || CASE WHEN held THEN ' held' ELSE '' END FROM year_words
		WHERE year = 2030`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id int64
		var how string
		_ = rows.Scan(&id, &how)
		claims[id] = how
	}
	rows.Close()
	if len(claims) != 3 || claims[anaID] != "push" || claims[boID] != "push held" || claims[viID] != "mail" {
		t.Fatalf("claims: %v", claims)
	}
	var message string
	if err := g.db.Read.QueryRow(`SELECT message FROM outbox`).Scan(&message); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"vi@example.bg", "Твоята 2030 в АЛМАНАХ", "8 дни игра. Виж годината си.", "/year/2030",
		"k=year"} {
		if !strings.Contains(message, want) {
			t.Fatalf("the mail has no %q: %s", want, message)
		}
	}
}

// What the year's word says: the days, the facts if any, and the way to the year.
func TestYearWordText(t *testing.T) {
	for _, c := range []struct {
		days, facts int
		want        string
	}{
		{34, 212, "34 дни игра, 212 факта в Алманаха. Виж годината си."},
		{7, 1, "7 дни игра, 1 факт в Алманаха. Виж годината си."},
		{9, 0, "9 дни игра. Виж годината си."},
	} {
		if got := yearWordText(play.Year{Days: c.days, Facts: c.facts}); got != c.want {
			t.Errorf("%d days, %d facts: %q", c.days, c.facts, got)
		}
	}
}
