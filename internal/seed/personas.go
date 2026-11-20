package seed

import (
	"errors"
	"fmt"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// finish is the history's last hours: the regular's rating brought into Злато and the legend's into Легенда by more
// duels where the history left them short (as a player on a run of form plays them), then the clock at the end, and
// the server's sweeps once more.
func (w *world) finish() error {
	w.rewind(w.end.Add(-230 * time.Minute))
	for _, p := range w.players {
		switch p.persona {
		case keyRegular:
			if err := w.befriended(p, 5); err != nil {
				return err
			}
			if err := w.steer(p, 1050, 1199, 24); err != nil {
				return err
			}
			if err := w.news(p); err != nil {
				return err
			}
		case keyLegend:
			if err := w.steer(p, 1500, 1<<20, 60); err != nil {
				return err
			}
			if err := w.news(p); err != nil {
				return err
			}
		}
	}
	w.set(w.end)
	w.g.AftersDone(w.ctx)
	w.swept = time.Time{}
	return w.sweep()
}

// steer plays a player's live duels until their rating is from lo to hi and placed, at most n of them, each against
// someone placed whose duel with them would move ratings (not met yet today: play.ratedToday). While it's under, they
// play the highest rated, who has an off day (misses most, and is slow) while the player is on form (every answer
// right, and quick): each win counts for as much as a win can, so a few close the gap whatever the history left. While
// it's over, the player is off form against the strongest.
func (w *world) steer(p *player, lo, hi, n int) error {
	skill, pace := p.skill, p.pace
	defer func() { p.skill, p.pace = skill, pace }()
	met := map[int64]bool{}
	now := w.clock().In(play.Bulgaria)
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, play.Bulgaria)
	rows, err := w.db.Read.QueryContext(w.ctx, `SELECT a_id + b_id - ?1 FROM duels WHERE rated = 1 AND b_id IS NOT NULL
		AND ended_at >= ?2 AND (a_id = ?1 OR b_id = ?1)`, p.id, midnight.UnixMilli())
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		met[id] = true
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return err
	}
	for range n {
		s, err := w.g.StandingOf(w.ctx, p.id)
		if err != nil {
			return err
		}
		up := s.Rating < lo || !play.Placed(s.Rated)
		switch {
		case up:
			p.skill, p.pace = 1, 2*time.Second
		case s.Rating > hi:
			p.skill, p.pace = 0.1, pace
		default:
			return nil
		}
		var best *player
		bestRating := 0
		day := min(w.day, w.today())
		for _, o := range w.active(day) {
			if o == p || o.isPersona() || met[o.id] || o.joined > day-4 {
				continue
			}
			var rated, rating int
			if err := w.db.Read.QueryRowContext(w.ctx, `SELECT rated, rating FROM users WHERE id = ?`, o.id).
				Scan(&rated, &rating); err != nil {
				return err
			}
			if rated < play.MinRatedGames {
				continue
			}
			if best == nil || (up && rating > bestRating) || (!up && o.skill > best.skill) {
				best, bestRating = o, rating
			}
		}
		if best == nil {
			return nil
		}
		met[best.id] = true
		if err := w.offDay(best, up, func() error { _, err := w.liveDuel(p, best); return err }); err != nil {
			return err
		}
	}
	return nil
}

// offDay plays fn with a player off form if off: missing most answers, and slow.
func (w *world) offDay(p *player, off bool, fn func() error) error {
	if off {
		skill, pace := p.skill, p.pace
		p.skill, p.pace = 0.3, max(pace, 8*time.Second)
		defer func() { p.skill, p.pace = skill, pace }()
	}
	return fn()
}

// befriended makes sure a persona has n friends at least, one more asking: whoever they've asked, or else asked by
// players they don't know yet, the persona saying yes to all but the last.
func (w *world) befriended(p *player, n int) error {
	ids, err := w.friendIDs(p)
	if err != nil || len(ids) >= n {
		return err
	}
	if err := w.friendsOfPersona(p, n-len(ids)+1); err != nil {
		return err
	}
	in, _, err := w.g.Requests(w.ctx, p.id)
	if err != nil {
		return err
	}
	for i, r := range in {
		if i == 0 {
			continue // the newest waits
		}
		if _, err := w.g.Accept(w.ctx, p.id, r.ID); err != nil && !errors.Is(err, play.ErrNoRequest) {
			return err
		}
	}
	return nil
}

// personas are the players a reviewer can be, each checked to be what it says, with a session to sign in by: the
// new guest is made now (account.Accounts.Guest), as a browser that's never been here is.
func (w *world) personas() ([]Persona, error) {
	if err := w.finish(); err != nil {
		return nil, err
	}
	var out []Persona
	u, token, err := w.accounts.Guest(w.ctx)
	if err != nil {
		return nil, err
	}
	out = append(out, Persona{Key: keyGuest, ID: u.ID, Name: u.Name, Tag: u.Tag, Token: token,
		About: "a new guest: nothing played, as a browser that's never been here"})
	// The lapsed one: whichever of its candidates' streaks ended yesterday, as Начало tells it.
	var lapsed *player
	for _, p := range w.players {
		if p.kind == lapsing && p.id != 0 && lapsed == nil {
			if e, err := w.endedYesterday(p); err != nil {
				return nil, err
			} else if e != nil {
				lapsed, p.persona = p, keyLapsed
			}
		}
	}
	if lapsed == nil {
		return nil, fmt.Errorf("seed: no player's streak ended yesterday")
	}
	for _, key := range personaKinds[1:] {
		var p *player
		for _, o := range w.players {
			if o.persona == key && o.id != 0 {
				p = o
			}
		}
		if p == nil {
			return nil, fmt.Errorf("seed: no %s persona", key)
		}
		if key == keyAdmin {
			if err := w.exec(`UPDATE users SET admin = 1 WHERE id = ?`, p.id); err != nil {
				return nil, err
			}
		}
		about, err := w.about(p)
		if err != nil {
			return nil, err
		}
		token, err := w.token(p.id)
		if err != nil {
			return nil, err
		}
		out = append(out, Persona{Key: key, ID: p.id, Name: p.name, Tag: p.tag, Email: p.email, Token: token,
			About: about})
	}
	return out, nil
}

// about says what a persona is now, from what the game says of them, and checks it's what they're for.
// endedYesterday is a player's streak that ended yesterday, as Начало tells it (two days or more: server/game.go), nil
// for none.
func (w *world) endedYesterday(p *player) (*play.Ended, error) {
	s, err := w.g.StreakOf(w.ctx, p.id)
	if err != nil || s.Days != 0 || s.Ended == nil || s.Ended.Days < 2 ||
		s.Ended.On != play.DayShift(w.g.Today(), -1) {
		return nil, err
	}
	return s.Ended, nil
}

func (w *world) about(p *player) (string, error) {
	ctx := w.ctx
	streak, err := w.g.StreakOf(ctx, p.id)
	if err != nil {
		return "", err
	}
	standing, err := w.g.StandingOf(ctx, p.id)
	if err != nil {
		return "", err
	}
	notes, err := w.g.NotesOf(ctx, p.id)
	if err != nil {
		return "", err
	}
	friends, err := w.g.FriendsOf(ctx, p.id)
	if err != nil {
		return "", err
	}
	var days int
	if err := w.one(&days, `SELECT count(*) FROM active_days WHERE user_id = ?`, p.id); err != nil {
		return "", err
	}
	rating := fmt.Sprintf("rating placing (%d of %d)", standing.Rated, play.MinRatedGames)
	if play.Placed(standing.Rated) {
		rating = fmt.Sprintf("%s, rating %d", standing.Division.Name, standing.Rating)
	}
	facts := fmt.Sprintf("%d days played, streak %d (best %d, spare %v), %d notes in the book, %s, %d friends",
		days, streak.Days, streak.Best, streak.Spare, len(notes), rating, len(friends))
	fail := func(why string) (string, error) {
		return "", fmt.Errorf("seed: the %s persona %s: %s", p.persona, why, facts)
	}
	switch p.persona {
	case keyDay2:
		if days != 1 {
			return fail("hasn't played exactly one day")
		}
		return "day two: played yesterday's ten (a guest), not today's yet; " + facts, nil
	case keyRegular:
		if (!w.opt.small && (standing.Division.ID != "gold" || !play.Placed(standing.Rated))) || len(friends) < 3 ||
			days < min(25, w.opt.Days*2/3) {
			return fail("isn't a placed Злато player with friends, of a month")
		}
		return "a month's regular in Злато, with friends; " + facts, nil
	case keyLapsed:
		e, err := w.endedYesterday(p)
		if err != nil || e == nil {
			return fail("has no streak that ended yesterday")
		}
		return fmt.Sprintf("a streak of %d that broke yesterday (%s missed), told on Начало; %s", e.Days, e.On, facts), nil
	case keyLegend:
		if !w.opt.small && (standing.Division.ID != "legend" || !play.Placed(standing.Rated)) {
			return fail("isn't in Легенда")
		}
		return "the strongest player: Легенда, a streak from the first day; " + facts, nil
	case keyAdmin:
		return "an admin (/admin), who plays most days; " + facts, nil
	}
	return facts, nil
}
