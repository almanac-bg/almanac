package server

import (
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// daysPlayed makes a player one who finished the day's questions on each of these days (counted back from the game's
// today, on its clock).
func (g *game) daysPlayed(userID int64, back ...int) {
	g.t.Helper()
	for _, d := range back {
		at := g.srv.game.Now().AddDate(0, 0, -d)
		if _, err := g.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, started_at, finished_at)
			VALUES (?, 'day', ?, '[{"id":""}]', ?, ?)`, userID, at.In(play.Bulgaria).Format(time.DateOnly), at.UnixMilli(),
			at.UnixMilli()); err != nil {
			g.t.Fatal(err)
		}
	}
}

// Днес hears of a streak just ended, once, on whichever device; the day's reminder then only asks for today's. The
// same at noon and in the minutes after midnight, while yesterday's runs can still be finished (play.DayGrace).
func TestStreakEndedOnTheDay(t *testing.T) {
	for name, now := range map[string]time.Time{
		"noon":           time.Date(2026, 12, 10, 12, 0, 0, 0, play.Bulgaria),
		"after midnight": time.Date(2026, 12, 10, 0, 5, 0, 0, play.Bulgaria),
	} {
		t.Run(name, func(t *testing.T) { streakEndedOnTheDay(t, now) })
	}
}

func streakEndedOnTheDay(t *testing.T, now time.Time) {
	g := start(t)
	g.srv.game.Now = func() time.Time { return now }
	ana, anaID := g.guest()
	g.daysPlayed(anaID, 6, 5, 4) // three days to Sunday; Monday and Tuesday forgiven, Wednesday (yesterday) ended it
	_, today := ana.call("GET", "/api/day", nil)
	if want := play.Issue(g.srv.game.Today()); want < 1 || today["issue"] != float64(want) {
		t.Fatalf("the day's issue: %v, want %d", today["issue"], want)
	}
	ended, _ := today["ended"].(map[string]any)
	if ended == nil || ended["days"] != nil || ended["on"] != "2026-12-09" { // its number never said
		t.Fatalf("a streak of three, ended yesterday: %v", today["ended"])
	}
	if m := g.srv.reminder(t.Context(), g.srv.game.Today(), anaID); m.Body != "Десет въпроса, един опит. До полунощ." {
		t.Fatalf("the reminder after a streak ended: %+v", m)
	}
	on := "ended:" + ended["on"].(string)
	for i, want := range []bool{true, false} {
		if status, out := ana.call("POST", "/api/me/streak-told", map[string]any{"key": on}); status != 200 ||
			out["fresh"] != want {
			t.Fatalf("told the end, time %d: %d %v", i+1, status, out)
		}
	}
	if status, _ := ana.call("POST", "/api/me/streak-told", map[string]any{"key": "ended:soon"}); status != 400 {
		t.Fatalf("a notice that isn't one: %d", status)
	}
	// Told once: Днес, on another device, doesn't tell it again.
	if _, today = ana.call("GET", "/api/day", nil); today["ended"] != nil {
		t.Fatalf("told again: %v", today["ended"])
	}
}

// A day's run whose tenth ran out before the day closed counts for its day by its own clock, whenever and however it's
// next looked at (the review of #783): Sunday and Monday played, Tuesday's tenth shown at 23:58 and left to run out
// with the phone locked. Днес on Wednesday at 09:05 says so on its first look (a streak of three, nothing forgiven,
// Tuesday's result untold), and on Thursday's first look; the tab woken on the tenth gets Tuesday's result, not a day
// over.
func TestDayLeftOnItsTenthCountsAtTheFirstLook(t *testing.T) {
	g := start(t)
	var clock atomic.Int64
	at := func(day, hour, minute int) {
		clock.Store(time.Date(2026, 11, day, hour, minute, 0, 0, play.Bulgaria).UnixMilli())
	}
	g.srv.game.Now = func() time.Time { return time.UnixMilli(clock.Load()) }
	left := func() (*player, float64) {
		t.Helper()
		at(24, 23, 30)
		p, id := g.guest()
		g.daysPlayed(id, 2, 1)
		_, run := p.call("POST", "/api/day", map[string]any{})
		playAnswers(p, run, 0, play.Length-1, "", 3*time.Second)
		at(24, 23, 58)
		runID := run["id"].(float64)
		if status, st := p.call("POST", "/api/runs/"+strconv.Itoa(int(runID))+"/show", map[string]any{}); status != 200 ||
			st["question"] == nil {
			t.Fatalf("the tenth shown: %d %v", status, st)
		}
		return p, runID
	}
	ana, aRun := left()
	bo, bRun := left()
	cy, cRun := left()
	g.srv.game.Settled(t.Context())

	at(25, 9, 5)
	for i := range 2 {
		_, day := ana.call("GET", "/api/day", nil)
		if day["streak"] != 3.0 || day["forgiven"] != nil || day["ended"] != nil || day["back"] != nil ||
			day["yesterday"] != nil {
			t.Fatalf("Днес on Wednesday, look %d: streak %v, forgiven %v, ended %v, back %v, yesterday %v", i+1,
				day["streak"], day["forgiven"], day["ended"], day["back"], day["yesterday"])
		}
		if i == 0 && day["untold"] != aRun {
			t.Fatalf("Днес on Wednesday's first look: untold %v, Tuesday's is %v", day["untold"], aRun)
		}
	}
	status, res := cy.call("POST", "/api/runs/"+strconv.Itoa(int(cRun))+"/answer", map[string]any{"n": play.Length - 1,
		"answer": nil})
	if st, _ := res["state"].(map[string]any); status != 200 || res["timedOut"] != true || st["done"] != true {
		t.Fatalf("the tab woken on Tuesday's tenth, Wednesday 09:05: %d %v", status, res)
	}

	at(26, 9, 5)
	_, day := bo.call("GET", "/api/day", nil)
	if day["streak"] != 3.0 || day["forgiven"] != "2026-11-25" || day["untold"] != bRun {
		t.Fatalf("Днес on Thursday, the first look: streak %v, forgiven %v, untold %v (Tuesday's %v)", day["streak"],
			day["forgiven"], day["untold"], bRun)
	}
}

// Yesterday's questions, finished in the minutes after midnight (play.DayGrace), count for yesterday: the streak goes
// on, and Днес tells of no day missed.
func TestStreakFinishedAfterMidnight(t *testing.T) {
	g := start(t)
	now := time.Date(2026, 12, 10, 0, 5, 0, 0, play.Bulgaria)
	g.srv.game.Now = func() time.Time { return now }
	ana, anaID := g.guest()
	g.daysPlayed(anaID, 4, 3, 2)
	g.finishedDay(anaID, time.Date(2026, 12, 9, 0, 0, 0, 0, play.Bulgaria), 24*time.Hour+3*time.Minute) // at 00:03
	_, today := ana.call("GET", "/api/day", nil)
	if today["streak"] != 4.0 || today["ended"] != nil || today["forgiven"] != nil {
		t.Fatalf("yesterday's, finished after midnight: streak %v, ended %v, forgiven %v", today["streak"],
			today["ended"], today["forgiven"])
	}
	if m := g.srv.reminder(t.Context(), g.srv.game.Today(), anaID); m.Body !=
		"Серията ти е 4 дни. Десет въпроса, до полунощ." {
		t.Fatalf("the reminder of a streak kept over midnight: %+v", m)
	}
}
