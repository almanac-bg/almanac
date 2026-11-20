package seed

import (
	"errors"
	"fmt"
	"slices"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

// pair is two players, the lower id first.
func pair(a, b int64) [2]int64 {
	if a > b {
		a, b = b, a
	}
	return [2]int64{a, b}
}

// befriend has a player ask someone they know to be friends (by their tag), now and then.
func (w *world) befriend(p *player) error {
	if !w.chance(p.social * 0.35) {
		return nil
	}
	var them []*player
	for _, o := range w.circleOf(p) {
		if !w.friends[pair(p.id, o.id)] {
			them = append(them, o)
		}
	}
	if len(them) == 0 {
		if !w.chance(0.03) {
			return nil
		}
		// Someone they know off the game: by email, which waits for them.
		_, err := w.g.Request(w.ctx, p.id, fmt.Sprintf("friend%d@example.invalid", w.r.IntN(1000)), true)
		if errors.Is(err, play.ErrManyRequests) {
			return nil
		}
		return err
	}
	o := them[w.r.IntN(len(them))]
	w.friends[pair(p.id, o.id)] = true
	_, err := w.g.Request(w.ctx, p.id, o.tag, false)
	if errors.Is(err, play.ErrManyRequests) {
		return nil
	}
	return err
}

// answerRequests has a player answer the friend requests waiting for them: most yes, some no, some left.
func (w *world) answerRequests(p *player) error {
	in, _, err := w.g.Requests(w.ctx, p.id)
	if err != nil {
		return err
	}
	for _, r := range in {
		switch x := w.r.Float64(); {
		case p.persona == keyRegular && x < 0.5 && w.day >= w.today()-1:
			// the regular keeps one or two waiting, for Приятели to show
		case x < 0.8:
			if _, err := w.g.Accept(w.ctx, p.id, r.ID); err != nil && !errors.Is(err, play.ErrNoRequest) {
				return err
			}
		case x < 0.9:
			if err := w.g.Withdraw(w.ctx, p.id, r.ID); err != nil && !errors.Is(err, play.ErrNoRequest) {
				return err
			}
		}
	}
	return nil
}

// friendIDs are a player's friends.
func (w *world) friendIDs(p *player) ([]int64, error) {
	fs, err := w.g.FriendsOf(w.ctx, p.id)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(fs))
	for _, f := range fs {
		ids = append(ids, f.ID)
	}
	return ids, nil
}

// dress has a player choose their avatar now and then: any animal, in any tone.
func (w *world) dress(p *player) error {
	if !w.chance(0.05) && !(p.persona != "" && w.day == w.today()-1) {
		return nil
	}
	avatar := play.Shapes[w.r.IntN(len(play.Shapes))] + "-" + play.Tones[w.r.IntN(len(play.Tones))]
	return w.g.SetAvatar(w.ctx, p.id, avatar)
}

// prefs are what a player said to the asks for reminders: notifications on a device (and which kinds), mail (and
// which kinds), as their screens keep them. The devices' addresses lead nowhere (.invalid): nothing is ever sent.
func (w *world) prefs(p *player) error {
	now := store.Ms(w.clock())
	if w.chance(0.6) {
		_ = w.g.Tally(w.ctx, "pushask:shown", 1)
		if w.chance(0.55) {
			_ = w.g.Tally(w.ctx, "pushask:yes", 1)
			if err := w.exec(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at)
				VALUES (?, ?, 'seed', 'seed', ?)`, fmt.Sprintf("https://push.invalid/seed/%d", p.id), p.id, now); err != nil {
				return err
			}
			for _, kind := range []string{"day", "friends"} {
				if err := w.exec(`INSERT INTO push_prefs (user_id, kind, wanted) VALUES (?, ?, ?)`,
					p.id, kind, b2i(w.chance(0.85))); err != nil {
					return err
				}
			}
		} else {
			_ = w.g.Tally(w.ctx, "pushask:no", 1)
		}
	}
	if p.profile >= 0 && w.chance(0.5) {
		_ = w.g.Tally(w.ctx, "mailask:shown", 1)
		yes := w.chance(0.5)
		_ = w.g.Tally(w.ctx, map[bool]string{true: "mailask:yes", false: "mailask:no"}[yes], 1)
		for _, kind := range []string{"streak", "day"} {
			if err := w.exec(`INSERT INTO mail_prefs (user_id, kind, wanted) VALUES (?, ?, ?)
				ON CONFLICT DO NOTHING`, p.id, kind, b2i(yes && (kind == "streak" || w.chance(0.6)))); err != nil {
				return err
			}
		}
	}
	return nil
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// friendsOfPersona makes sure a persona who should have friends has: asked by some of their circle (accepted as they
// come in).
func (w *world) friendsOfPersona(p *player, n int) error {
	others := slices.DeleteFunc(w.active(w.day), func(o *player) bool {
		return o == p || o.isPersona() || w.friends[pair(p.id, o.id)]
	})
	w.r.Shuffle(len(others), func(i, j int) { others[i], others[j] = others[j], others[i] })
	for _, o := range others[:min(n, len(others))] {
		w.friends[pair(p.id, o.id)] = true
		o.circle = p.circle
		if _, err := w.g.Request(w.ctx, o.id, p.tag, false); err != nil && !errors.Is(err, play.ErrManyRequests) {
			return err
		}
	}
	return nil
}
