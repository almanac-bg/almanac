package seed

import (
	"fmt"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// session is a player's visit on a day: when, and whether they play the day's ten.
type session struct {
	at  time.Time
	p   *player
	day bool
}

// history plays every day from the first to now.
func (w *world) history() error {
	for w.day = 0; w.day <= w.today(); w.day++ {
		if err := w.playDay(); err != nil {
			return fmt.Errorf("day %s: %w", w.dayAt(w.day, 0, 0).Format(time.DateOnly), err)
		}
		if w.opt.Progress != nil {
			var runs int
			_ = w.one(&runs, `SELECT count(*) FROM runs`)
			w.opt.Progress(fmt.Sprintf("%s: %d players, %d games", w.dayAt(w.day, 0, 0).Format(time.DateOnly),
				len(w.active(w.day)), runs))
		}
	}
	return nil
}

// releases are the versions the history's days were played on (/admin marks them on its charts), one every few days.
func (w *world) release() error {
	if w.day%9 != 0 {
		return nil
	}
	v := fmt.Sprintf("v3.%d.0", w.day/9)
	w.g.Version = v
	return w.exec(`INSERT OR IGNORE INTO releases (version, at) VALUES (?, ?)`, v, store.Ms(w.dayAt(w.day, 5, 0)))
}

// playDay plays a day: everyone who comes, in the order they come.
func (w *world) playDay() error {
	w.g.AftersDone(w.ctx)
	w.rewind(w.dayAt(w.day, 0, 30))
	if err := w.release(); err != nil {
		return err
	}
	if err := w.sweep(); err != nil {
		return err
	}
	sessions, err := w.plan()
	if err != nil {
		return err
	}
	stop := w.end.Add(-4 * time.Hour) // the end's last hours: what the personas need (finish)
	var online []*player
	met := map[[2]int64]bool{}
	for _, s := range sessions {
		if !s.at.Before(stop) {
			break
		}
		w.rewind(s.at)
		online = online[:0]
		for _, o := range sessions {
			if d := o.at.Sub(s.at); d > -40*time.Minute && d < 40*time.Minute {
				online = append(online, o.p)
			}
		}
		if err := w.visit(s, online, met); err != nil {
			return fmt.Errorf("%s (%d): %w", s.p.name, s.p.id, err)
		}
	}
	return w.tallies()
}

// plan is who comes on the day, and when, in order.
func (w *world) plan() ([]session, error) {
	var out []session
	for _, p := range w.players {
		if p.joined > w.day || (p.until >= 0 && w.day > p.until) {
			continue
		}
		if p.kind == lapsing && p.until < 0 && w.day >= w.today()-4 && p.id != 0 {
			// A streak that ends yesterday (cast): stop on the day that does it. Missed from today, it ends today if
			// this week has forgiven a day already; else tomorrow, or the day after if tomorrow is a Monday, whose
			// week forgives one of its own (play/runs.go).
			s, err := w.g.StreakOf(w.ctx, p.id)
			if err != nil {
				return nil, err
			}
			ends := w.day
			if s.Spare {
				ends++
				if w.dayAt(ends, 0, 0).Weekday() == time.Monday {
					ends++
				}
			}
			if ends == w.today()-1 {
				p.until = w.day - 1
				continue
			}
		}
		comes := p.id == 0 || w.chance(p.rate)
		if p.persona == keyDay2 && w.day == w.today() {
			comes = false // day two, not played yet
		}
		if p.persona == keyRegular && w.day == w.today() {
			comes = false // today's ten left for whoever looks at the regular
		}
		if !comes {
			continue
		}
		at := w.dayAt(w.day, p.hour, 0).Add(w.between(0, 90*time.Minute) - 30*time.Minute)
		day := w.chance(0.97) || p.played[w.day-1] || p.id == 0
		out = append(out, session{at: at, p: p, day: day})
		// Some come back later in the day, for a duel or a topic.
		if p.duels+p.topics > 2 && w.chance(0.4) {
			out = append(out, session{at: at.Add(w.between(2*time.Hour, 8*time.Hour)), p: p})
		}
	}
	slices.SortFunc(out, func(a, b session) int { return a.at.Compare(b.at) })
	return out, nil
}

// visit is one of a player's visits: they come in (the first time, as a new guest), see what waits for them, play.
func (w *world) visit(s session, online []*player, met map[[2]int64]bool) error {
	p := s.p
	if p.id == 0 {
		if err := w.arrive(p); err != nil {
			return fmt.Errorf("arriving: %w", err)
		}
		if err := w.prefs(p); err != nil {
			return fmt.Errorf("asks: %w", err)
		}
		if p.persona == keyRegular {
			if err := w.friendsOfPersona(p, 6); err != nil {
				return err
			}
		}
	} else if err := w.exec(`UPDATE users SET seen_at = ? WHERE id = ?`, store.Ms(w.clock()), p.id); err != nil {
		return err
	}
	if p.profile == w.day && p.email == "" {
		if err := w.email(p); err != nil {
			return err
		}
	}
	if p.email == "" {
		_ = w.g.Tally(w.ctx, "visit:"+p.from, 1)
	}
	if err := w.answerRequests(p); err != nil {
		return fmt.Errorf("requests: %w", err)
	}
	if s.day {
		if err := w.dayRun(p); err != nil {
			return err
		}
	}
	for range min(4, w.count(p.topics)) {
		if _, err := w.topicRun(p); err != nil {
			return err
		}
	}
	for range min(8, w.count(p.duels)) {
		o := w.opponent(p, online, met)
		if o != nil && w.chance(0.2) {
			o = nil // nobody came in time: a recording
		}
		if _, err := w.liveDuel(p, o); err != nil {
			return err
		}
	}
	// The legend's last evenings before today: on form, so that the history leaves it near Легенда whatever the draw
	// (finish brings it the rest of the way; one evening's opponents may not be enough on their own).
	if p.persona == keyLegend && w.day >= w.today()-3 && w.day < w.today() {
		if err := w.steer(p, 1500, 1<<20, 20); err != nil {
			return err
		}
	}
	if err := w.news(p); err != nil {
		return fmt.Errorf("news: %w", err)
	}
	if err := w.befriend(p); err != nil {
		return fmt.Errorf("befriending: %w", err)
	}
	if err := w.dress(p); err != nil {
		return fmt.Errorf("dressing: %w", err)
	}
	return w.sweep()
}

// tallies are what /admin counts each day of what no table keeps: notifications sent and opened, mails sent.
func (w *world) tallies() error {
	var on int
	if err := w.one(&on, `SELECT count(DISTINCT user_id) FROM push_subs`); err != nil {
		return err
	}
	sent := on * 6 / 10
	for key, n := range map[string]int{"push:sent:day": sent, "push:open:day": sent / 4,
		"push:sent:friends": on / 8, "push:open:friends": on / 20, "mail:day:sent": on / 5} {
		if n > 0 {
			if err := w.g.Tally(w.ctx, key, n); err != nil {
				return err
			}
		}
	}
	return nil
}
