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

// playDay plays a day: everyone who comes, in the order they come, Роял in the evening if it's on, rooms.
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
	evening := w.dayAt(w.day, 21, 0)
	stop := w.end.Add(-4 * time.Hour) // the end's last hours: what the personas need (finish)
	royalOn := w.g.RoyalOn(evening) && evening.Add(30*time.Minute).Before(stop)
	roomAt := w.dayAt(w.day, 19, 30)
	rooms := w.roomsToday()
	if !roomAt.Add(time.Hour).Before(stop) {
		rooms = nil
	}
	var online []*player
	met := map[[2]int64]bool{}
	for i, s := range sessions {
		if royalOn && !s.at.Before(evening.Add(-20*time.Minute)) {
			if err := w.evening(sessions[i:]); err != nil {
				return fmt.Errorf("Роял: %w", err)
			}
			royalOn = false
		}
		if rooms != nil && !s.at.Before(roomAt) {
			if err := w.playRooms(rooms); err != nil {
				return fmt.Errorf("rooms: %w", err)
			}
			rooms = nil
		}
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
	if royalOn {
		if err := w.evening(nil); err != nil {
			return fmt.Errorf("Роял: %w", err)
		}
	}
	if rooms != nil {
		if err := w.playRooms(rooms); err != nil {
			return fmt.Errorf("rooms: %w", err)
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
			// A streak that ends yesterday, whichever reserve days it holds (cast): stop on the day that does it.
			s, err := w.g.StreakOf(w.ctx, p.id)
			if err != nil {
				return nil, err
			}
			if w.day+s.Reserve == w.today()-1 {
				p.until = w.day - 1
				continue
			}
		}
		comes := p.id == 0 || w.chance(p.rate)
		if p.persona == keyDay2 && w.day == w.today() {
			comes = false // day two, not played yet
		}
		if p.persona == keyRegular && w.day == w.today() && w.dayAt(w.day, 0, 0).Weekday() != time.Monday {
			comes = false // today's ten left for whoever looks at the regular (a Monday's played: the week's league)
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
		if p.persona == keyRegular || p.persona == keyHost {
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
		if err := w.block(p, o); err != nil {
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
	if p.royal > 0 && w.g.RoyalOn(w.dayAt(w.day, 21, 0)) && w.chance(p.royal*0.4) {
		if err := w.g.PlanRoyal(w.ctx, w.g.Today(), p.id, true); err != nil {
			return fmt.Errorf("planning Роял: %w", err)
		}
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
