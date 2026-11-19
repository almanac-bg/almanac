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

// invited is a player who came by someone's invite link: they know the inviter, and ask them to be friends by it
// (AskByInvite), as the link's page does.
func (w *world) invited(p *player) {
	var from []*player
	for _, o := range w.players {
		if o.id != 0 && o != p && o.social > 0.3 && !o.isPersona() {
			from = append(from, o)
		}
	}
	if len(from) == 0 {
		return
	}
	o := from[w.r.IntN(len(from))]
	p.circle = o.circle
	code, err := w.g.InviteCode(w.ctx, o.id)
	if err != nil {
		return
	}
	if _, _, _, err := w.g.AskByInvite(w.ctx, p.id, code); err == nil {
		w.friends[pair(p.id, o.id)] = true
	}
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

// challenge sends a finished game of ten to some friends, and as a link (link: kept for others to take later).
func (w *world) challenge(p *player, runID int64) error {
	ids, err := w.friendIDs(p)
	if err != nil {
		return err
	}
	w.r.Shuffle(len(ids), func(i, j int) { ids[i], ids[j] = ids[j], ids[i] })
	ids = ids[:min(len(ids), 1+w.r.IntN(3))]
	code, _, err := w.g.Challenge(w.ctx, p.id, runID, ids)
	if errors.Is(err, play.ErrNoChallengeRun) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("challenge: %w", err)
	}
	if w.chance(0.4) {
		w.links = append(w.links, link{code: code, from: p, day: w.day})
	}
	return nil
}

// challengeFriend challenges a friend at once: ten drawn for the two, played now, sent once played.
func (w *world) challengeFriend(p *player) error {
	ids, err := w.friendIDs(p)
	if err != nil || len(ids) == 0 {
		return err
	}
	s, _, err := w.g.ChallengeFriend(w.as(p), p.id, ids[w.r.IntN(len(ids))])
	if errors.Is(err, play.ErrManyWaiting) || errors.Is(err, play.ErrNoQuestion) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("challenge a friend: %w", err)
	}
	_, err = w.playRun(p, s, -1)
	return err
}

// link is a challenge's link shared into a chat, for whoever opens it.
type link struct {
	code string
	from *player
	day  int
}

// asked has a player answer the friends' challenges waiting for them: most played, some said no to, some left to run
// out.
func (w *world) asked(p *player) error {
	waiting, err := w.g.AskedOf(w.ctx, p.id)
	if err != nil {
		return err
	}
	for _, a := range waiting {
		x := w.r.Float64()
		if p.persona == keyRegular && w.day == w.today() {
			x = 1 // the regular finds today's waiting, for Начало and Дуели to show
		}
		switch {
		case x < 0.6:
			d, err := w.g.DuelOf(w.ctx, p.id, a.ID)
			if err != nil {
				return err
			}
			if err := w.take(p, d.Challenge); err != nil {
				return err
			}
		case x < 0.7:
			if err := w.g.Decline(w.ctx, p.id, a.ID); err != nil && !errors.Is(err, play.ErrNoDuel) {
				return err
			}
		}
	}
	return nil
}

// take is a player's game of a challenge, by its code: played to its end.
func (w *world) take(p *player, code string) error {
	if code == "" {
		return nil
	}
	s, _, err := w.g.TakeChallenge(w.as(p), p.id, code)
	if errors.Is(err, play.ErrChallengeOver) || errors.Is(err, play.ErrOwnChallenge) ||
		errors.Is(err, play.ErrChallengeHeld) || errors.Is(err, play.ErrChallengeGone) || errors.Is(err, play.ErrNoChallenge) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("take a challenge: %w", err)
	}
	if s.ID == 0 || s.Done {
		return nil
	}
	_, err = w.playRun(p, s, -1)
	return err
}

// openLinks has a player open a challenge's link shared in their circle's chat, now and then.
func (w *world) openLinks(p *player) error {
	for _, l := range w.links {
		if l.from != p && l.from.circle == p.circle && w.day-l.day <= 2 && w.chance(0.25) {
			if err := w.take(p, l.code); err != nil {
				return err
			}
		}
	}
	return nil
}

// block has a player block someone they played and didn't like, rarely.
func (w *world) block(p *player, other *player) error {
	if other == nil || other.isPersona() || p.isPersona() || !w.chance(0.01) {
		return nil
	}
	if _, err := w.g.Block(w.ctx, p.id, other.tag); err != nil {
		return err
	}
	w.blocked[pair(p.id, other.id)] = true
	return nil
}

// dress has a player choose their look from what they have, now and then: an avatar and its colour, a title, a frame,
// a pattern (SetLook refuses what isn't theirs).
func (w *world) dress(p *player) error {
	if !w.chance(0.05) && !(p.persona != "" && w.day == w.today()-1) {
		return nil
	}
	pr, err := w.g.ProgressOf(w.ctx, p.id)
	if err != nil {
		return err
	}
	var shapes, titles, frames, backdrops []string
	for _, s := range pr.Shapes {
		if !s.Locked {
			shapes = append(shapes, s.Shape)
		}
	}
	for _, t := range pr.Titles {
		if !t.Locked {
			titles = append(titles, t.ID)
		}
	}
	for _, c := range pr.Frames {
		if !c.Locked {
			frames = append(frames, c.ID)
		}
	}
	for _, c := range pr.Backdrops {
		if !c.Locked {
			backdrops = append(backdrops, c.ID)
		}
	}
	pick := func(s []string) *string {
		if len(s) == 0 {
			return nil
		}
		v := s[w.r.IntN(len(s))]
		return &v
	}
	var avatar *string
	if shape := pick(shapes); shape != nil && len(pr.Tones) > 0 {
		v := *shape + "-" + pr.Tones[w.r.IntN(len(pr.Tones))]
		avatar = &v
	}
	err = w.g.SetLook(w.ctx, p.id, avatar, pick(titles), pick(frames), pick(backdrops))
	if errors.Is(err, play.ErrNotYours) {
		return nil
	}
	return err
}

// prefs are what a player said to the asks for reminders: notifications on a device (and which kinds), mail (and
// which kinds), as their screens keep them. The devices' addresses lead nowhere (.invalid): nothing is ever sent.
func (w *world) prefs(p *player) error {
	now := store.Ms(w.clock())
	if w.chance(0.6) {
		_ = w.g.Tally(w.ctx, "pushask:shown", 1)
		if w.chance(0.55) {
			_ = w.g.Tally(w.ctx, "pushask:yes", 1)
			if p.device == "app-ios" || p.device == "app-android" {
				platform := map[string]string{"app-ios": "ios", "app-android": "android"}[p.device]
				if err := w.exec(`INSERT INTO phones (token, user_id, platform, created_at) VALUES (?, ?, ?, ?)`,
					fmt.Sprintf("seed-phone-%d", p.id), p.id, platform, now); err != nil {
					return err
				}
			} else if err := w.exec(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at)
				VALUES (?, ?, 'seed', 'seed', ?)`, fmt.Sprintf("https://push.invalid/seed/%d", p.id), p.id, now); err != nil {
				return err
			}
			for _, kind := range []string{"day", "friends", "royal"} {
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

// opponent is whom a player meets in a live duel now: someone else playing at about this time, of about their
// rating as the queue pairs them, not met today yet; nil for nobody (a recording, then).
func (w *world) opponent(p *player, online []*player, met map[[2]int64]bool) *player {
	mine := w.rating(p)
	var best *player
	bestGap := 1 << 30
	for _, o := range online {
		if o == p || o.id == 0 || met[pair(p.id, o.id)] || w.blocked[pair(p.id, o.id)] || o.persona == keyDay2 {
			continue
		}
		gap := abs(w.rating(o)-mine) + w.r.IntN(150)
		if gap < bestGap {
			best, bestGap = o, gap
		}
	}
	if best != nil {
		met[pair(p.id, best.id)] = true
	}
	return best
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
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
