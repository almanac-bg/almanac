package server

import (
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/royal"
)

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
