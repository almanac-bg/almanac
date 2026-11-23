package seed

import (
	"errors"
	"fmt"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// finish is the history's last hours: the regular with friends, a friend's duel waiting for them and one of theirs
// waiting for a friend (as Приятели and Днес show them), then the clock at the end, and the server's sweeps once
// more.
func (w *world) finish() error {
	w.rewind(w.end.Add(-230 * time.Minute))
	for _, p := range w.players {
		if p.persona != keyRegular {
			continue
		}
		if err := w.befriended(p, 5); err != nil {
			return err
		}
		ids, err := w.friendIDs(p)
		if err != nil {
			return err
		}
		for i, id := range ids[:min(2, len(ids))] {
			for _, o := range w.players {
				if o.id != id {
					continue
				}
				from, to := o, p // the first: a friend's duel waiting for the regular; the second: theirs, waiting
				if i == 1 {
					from, to = p, o
				}
				if err := w.friendDuel(from, to); err != nil {
					return err
				}
			}
		}
		if err := w.news(p); err != nil {
			return err
		}
	}
	w.set(w.end)
	w.g.AftersDone(w.ctx)
	w.swept = time.Time{}
	return w.sweep()
}

// befriended makes sure a persona has n friends at least, and one more asking (as Приятели shows a request): asked by
// players they don't know yet, the persona saying yes to all but the newest. Whatever the history happened to bring
// (the game draws its own questions, so no two histories are alike), both are there: a persona already with n friends
// and nobody asking is asked by one more.
func (w *world) befriended(p *player, n int) error {
	ids, err := w.friendIDs(p)
	if err != nil {
		return err
	}
	in, _, err := w.g.Requests(w.ctx, p.id)
	if err != nil {
		return err
	}
	short := max(0, n-len(ids))
	if short == 0 && len(in) > 0 {
		return nil
	}
	if err := w.friendsOfPersona(p, short+1); err != nil {
		return err
	}
	if in, _, err = w.g.Requests(w.ctx, p.id); err != nil {
		return err
	}
	for i, r := range in {
		if i == 0 || short == 0 {
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
	// What the games just played brought (their ranks, counted in the background: play/after.go) is in before anyone
	// is said to be anything: else a rank is read half-counted.
	w.g.Settled(w.ctx)
	var out []Persona
	u, token, err := w.accounts.Guest(w.ctx)
	if err != nil {
		return nil, err
	}
	out = append(out, Persona{Key: keyGuest, ID: u.ID, Name: u.Name, Tag: u.Tag, Token: token,
		About: "a new guest: nothing played, as a browser that's never been here"})
	// The lapsed one: whichever of its candidates' streaks ended lately, as Днес tells it.
	var lapsed *player
	for _, p := range w.players {
		if p.kind == lapsing && p.id != 0 && lapsed == nil {
			if e, err := w.latelyEnded(p); err != nil {
				return nil, err
			} else if e != nil {
				lapsed, p.persona = p, keyLapsed
			}
		}
	}
	if lapsed == nil {
		return nil, fmt.Errorf("seed: no player's streak ended lately")
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

// latelyEnded is a player's streak that ended lately, as Днес tells it (two days or more, on one of the last three:
// server/game.go), nil for none: yesterday, or on a Tuesday or a Wednesday the Sunday before (history.go), as a
// week's first two days missed are forgiven and no streak ends on them.
func (w *world) latelyEnded(p *player) (*play.Ended, error) {
	s, err := w.g.StreakOf(w.ctx, p.id)
	if err != nil || s.Days != 0 || s.Ended == nil || s.Ended.Days < 2 ||
		s.Ended.On < play.DayShift(w.g.Today(), -3) {
		return nil, err
	}
	return s.Ended, nil
}

// about says what a persona is now, from what the game says of them, and checks it's what they're for.
func (w *world) about(p *player) (string, error) {
	ctx := w.ctx
	streak, err := w.g.StreakOf(ctx, p.id)
	if err != nil {
		return "", err
	}
	duels, err := w.g.DuelsOf(ctx, p.id)
	if err != nil {
		return "", err
	}
	ranks, err := w.g.RanksOf(ctx, p.id)
	if err != nil {
		return "", err
	}
	rank := "no rank"
	var best play.ChapterRank
	for _, r := range ranks {
		if r.Level > best.Level {
			best = r
		}
	}
	if best.Level > 0 {
		rank = best.Name + " in " + best.Chapter
	}
	friends, err := w.g.FriendsOf(ctx, p.id)
	if err != nil {
		return "", err
	}
	asking, _, err := w.g.Requests(ctx, p.id)
	if err != nil {
		return "", err
	}
	var days int
	if err := w.one(&days, `SELECT count(*) FROM active_days WHERE user_id = ?`, p.id); err != nil {
		return "", err
	}
	facts := fmt.Sprintf("%d days played, streak %d (spare %v), %s, %d friends (%d asking), "+
		"duels: %d to play, %d waiting, %d played", days, streak.Days, streak.Spare, rank,
		len(friends), len(asking), len(duels.Yours), len(duels.Theirs), len(duels.Played))
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
		if len(friends) < 3 || len(asking) == 0 || days < min(25, w.opt.Days*2/3) || len(duels.Yours) == 0 ||
			len(duels.Theirs) == 0 {
			return fail("isn't a month's regular with friends, one asking, a friend's duel to play and one of theirs waiting")
		}
		return "a month's regular with friends, one asking, a friend's duel to play and one waiting; " + facts, nil
	case keyLapsed:
		e, err := w.latelyEnded(p)
		if err != nil || e == nil {
			return fail("has no streak that ended lately")
		}
		return fmt.Sprintf("a streak of %d that broke on %s, the day missed, told on Днес; %s", e.Days, e.On, facts), nil
	case keyLegend:
		return "the strongest player, a streak from the first day; " + facts, nil
	case keyAdmin:
		return "an admin (/admin), who plays most days; " + facts, nil
	}
	return facts, nil
}
