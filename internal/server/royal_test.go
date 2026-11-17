package server

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/royal"
)

// Роял's stream sends the evening as one object (the board, with the viewer's own part); a player's screen too many
// is told to try again in a while, not shut out for good.
func TestRoyalStream(t *testing.T) {
	g := start(t)
	ana := g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	v := ana.stream("/api/royal/events").until(func(map[string]any) bool { return true })
	if v["phase"] == nil || v["now"] == nil || v["in"] != false {
		t.Fatalf("the evening: %v", v)
	}
	for range 4 { // royal.maxOfPlayer, with the first
		ana.stream("/api/royal/events").until(func(map[string]any) bool { return true })
	}
	busy := ana.stream("/api/royal/events")
	var got []string
	for {
		line, err := busy.r.Reader.ReadString('\n')
		if err != nil {
			break
		}
		got = append(got, strings.TrimSpace(line))
	}
	var ms int
	if len(got) < 2 || got[1] != "event: busy" {
		t.Fatalf("a screen too many: %q", got)
	}
	if _, err := fmt.Sscanf(got[0], "retry: %d", &ms); err != nil || ms < 30_000 {
		t.Fatalf("a screen too many, back in: %q", got[0])
	}
}

// One who can't come into Роял is told why, and when they can, as the evenings are.
func TestRefusal(t *testing.T) {
	at := func(d, h, m int) int64 { return time.Date(2026, 11, d, h, m, 0, 0, play.Bulgaria).UnixMilli() }
	for _, c := range []struct {
		err  error
		g    royal.Glance
		want string
	}{
		{royal.ErrClosed, royal.Glance{Now: at(13, 18, 0), OpensAt: at(13, 20, 45)}, "Входът за Роял се отваря днес в 20:45."},
		{royal.ErrClosed, royal.Glance{Now: at(12, 22, 0), OpensAt: at(13, 20, 45)}, "Входът за Роял се отваря утре в 20:45."},
		// Tuesday, Friday to Sunday only: the next on Friday.
		{royal.ErrClosed, royal.Glance{Now: at(10, 22, 0), OpensAt: at(13, 20, 45)}, "Входът за Роял се отваря в петък в 20:45."},
		{royal.ErrClosed, royal.Glance{Now: at(16, 22, 0), OpensAt: at(17, 22, 50)}, "Входът за Роял се отваря утре в 22:50."},
		{royal.ErrClosed, royal.Glance{Now: at(15, 22, 0), OpensAt: at(17, 20, 45)}, "Входът за Роял се отваря във вторник в 20:45."},
		{royal.ErrShut, royal.Glance{Now: at(14, 21, 2), Next: at(15, 21, 0)},
			"Роял вече тече, а закъснелите влизат само до 3-тия въпрос. Следващият е утре в 21:00."},
	} {
		if got := refusal(c.err, c.g); got != c.want {
			t.Errorf("%v at %v: %q, want %q", c.err, time.UnixMilli(c.g.Now), got, c.want)
		}
	}
}
