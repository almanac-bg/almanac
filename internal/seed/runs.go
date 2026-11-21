package seed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
)

// as is the context a player's requests come in.
func (w *world) as(*player) context.Context { return w.ctx }

// picks are a run's questions, as it holds them.
func (w *world) picks(runID int64) ([]play.Pick, error) {
	var s string
	if err := w.one(&s, `SELECT questions FROM runs WHERE id = ?`, runID); err != nil {
		return nil, err
	}
	var p []play.Pick
	return p, json.Unmarshal([]byte(s), &p)
}

// right says whether a player gets a question right: by their strength, and how hard it is.
func (w *world) right(p *player, d bank.Dealt) bool {
	chance := p.skill
	switch d.Question().Base().Difficulty {
	case bank.Easy:
		chance += 0.15
	case bank.Hard:
		chance -= 0.2
	}
	return w.chance(chance)
}

// took is how long a player takes over a question: about their pace, never quicker than a person reads, and within
// its time.
func (w *world) took(p *player, d bank.Dealt) time.Duration {
	limit := play.Limit(d.Question())
	t := time.Duration(float64(p.pace) * (0.6 + 0.8*w.r.Float64()))
	if limit > 20*time.Second {
		t += 6 * time.Second // an order, a match: more to do
	}
	return min(max(t, 2500*time.Millisecond), limit-time.Second)
}

// answerTo is an answer to a deal as a player's screen sends it: the right one, or a wrong one (another option, a
// number far off, the other of true or not, every pair one along, every item the other way, an order backwards).
func answerTo(d bank.Dealt, right bool) json.RawMessage {
	reveal, _ := json.Marshal(d.Reveal(nil))
	var r map[string]any
	_ = json.Unmarshal(reveal, &r)
	for _, k := range []string{"pick", "value", "truth", "sides", "pairs", "order"} {
		v, ok := r[k]
		if !ok {
			continue
		}
		if !right {
			switch k {
			case "pick":
				v = (int(v.(float64)) + 1) % bank.ChoiceOptions
			case "value":
				x := v.(float64)
				if n, ok := d.Question().(*bank.Number); ok {
					v = x + 10*max(n.Tolerance, 0.1)*max(x, 1) + 7
				} else {
					v = x*3 + 7
				}
			case "truth":
				v = !v.(bool)
			case "sides":
				s := v.([]any)
				for i, x := range s {
					s[i] = 1 - int(x.(float64))
				}
			case "pairs":
				s := v.([]any)
				v = append(s[1:], s[0])
			case "order":
				s := v.([]any)
				for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
					s[i], s[j] = s[j], s[i]
				}
			}
		}
		out, _ := json.Marshal(map[string]any{k: v})
		return out
	}
	return json.RawMessage(`null`)
}

// playRun plays a run of the player's own to its end (or, with stop >= 0, leaves it after that many answers), as
// their screen does: each question shown (started once its pictures are in), answered at their pace, its answer read.
// Now and then the time runs out on one.
func (w *world) playRun(p *player, s play.State, stop int) (play.State, error) {
	ctx := w.as(p)
	picks, err := w.picks(s.ID)
	if err != nil {
		return s, err
	}
	for !s.Done && !w.over() {
		if stop >= 0 && s.At >= stop {
			return s, nil
		}
		if s, err = w.g.Show(ctx, p.id, s.ID); err != nil {
			return s, fmt.Errorf("show: %w", err)
		}
		if s.Done || s.Question == nil {
			break
		}
		if s.Question.StartsMs > 0 {
			w.wait(w.between(300*time.Millisecond, 2*time.Second))
			if s, err = w.g.Start(ctx, p.id, s.ID, s.Question.N); err != nil {
				return s, fmt.Errorf("start: %w", err)
			}
		}
		n := s.Question.N
		d, ok := w.g.Deal(picks[n])
		if !ok {
			return s, fmt.Errorf("can't deal %s", picks[n].ID)
		}
		if w.chance(0.02) { // gone to make tea
			w.wait(play.Limit(d.Question()) + 5*time.Second)
			continue
		}
		w.wait(w.took(p, d))
		res, err := w.g.Answer(ctx, p.id, s.ID, n, answerTo(d, w.right(p, d)))
		if errors.Is(err, play.ErrOutOfStep) {
			continue // its time ran out meanwhile: the next look moves on
		}
		if err != nil {
			return s, fmt.Errorf("answer: %w", err)
		}
		s = res.State
		w.wait(w.between(2*time.Second, 9*time.Second)) // the answer and its fact, read
	}
	if s.Done {
		p.last = s.ID // its news is told as the visit ends (news)
	}
	return s, nil
}

// news is what a visit's last result screen tells (play.Game.NewsOf): everything the visit's games earned, told as
// told, as a player sees it once they look.
func (w *world) news(p *player) error {
	if p.last == 0 {
		return nil
	}
	_, err := w.g.NewsOf(w.as(p), p.id, p.last)
	p.last = 0
	return err
}

// dayRun is the player's day's ten, played.
func (w *world) dayRun(p *player) error {
	s, err := w.g.StartDay(w.as(p), p.id)
	if err != nil {
		return fmt.Errorf("day: %w", err)
	}
	if s.Done {
		return nil
	}
	if s, err = w.playRun(p, s, -1); err != nil {
		return fmt.Errorf("day: %w", err)
	}
	if s.Done {
		p.played[w.day] = true
	}
	return nil
}

// topicRun is a game of a topic („Микс“ now and then), maybe left half-way; it says the run.
func (w *world) topicRun(p *player) (play.State, error) {
	topic := play.MixTopic
	if cats := w.b.Categories; len(cats) > 0 && w.chance(0.8) {
		topic = cats[w.r.IntN(len(cats))].ID
	}
	s, err := w.g.StartTopic(w.as(p), p.id, topic)
	if errors.Is(err, play.ErrNoQuestion) {
		return s, nil
	}
	if err != nil {
		return s, fmt.Errorf("topic %q: %w", topic, err)
	}
	stop := -1
	if w.chance(0.05) {
		stop = w.r.IntN(play.Length)
	}
	s, err = w.playRun(p, s, stop)
	if err != nil {
		return s, fmt.Errorf("topic %q: %w", topic, err)
	}
	return s, nil
}

// friendDuel is a duel a player starts with a friend: their side played, so it's sent (play.Game.DuelFriend). Past
// the game's limits, it isn't started.
func (w *world) friendDuel(p, o *player) error {
	id, err := w.g.DuelFriend(w.as(p), p.id, o.id)
	if errors.Is(err, play.ErrDuelsToOne) || errors.Is(err, play.ErrDuelsADay) || errors.Is(err, play.ErrNoQuestion) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("duel: %w", err)
	}
	return w.playDuel(p, id)
}

// recordingDuel is a duel against a recording of another player's game (play.Game.DuelRecording), if there's one.
func (w *world) recordingDuel(p *player) error {
	level := play.Even
	if p.id%3 == 0 {
		level = play.Stronger
	}
	id, err := w.g.DuelRecording(w.as(p), p.id, level)
	if errors.Is(err, play.ErrNobody) || errors.Is(err, play.ErrNoQuestion) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("duel: %w", err)
	}
	return w.playDuel(p, id)
}

// playDuel plays the player's side of a duel to its end.
func (w *world) playDuel(p *player, id int64) error {
	run, err := w.g.PlayDuel(w.ctx, p.id, id)
	if err != nil {
		return fmt.Errorf("duel %d: %w", id, err)
	}
	s, err := w.g.State(w.as(p), p.id, run)
	if err != nil {
		return fmt.Errorf("duel %d: %w", id, err)
	}
	if _, err := w.playRun(p, s, -1); err != nil {
		return fmt.Errorf("duel %d: %w", id, err)
	}
	return nil
}

// duelsWaiting are the duels a player's friends sent them, played as they come by: most of them, the rest left for
// later (some to lapse).
func (w *world) duelsWaiting(p *player) error {
	d, err := w.g.DuelsOf(w.ctx, p.id)
	if err != nil {
		return err
	}
	for _, v := range d.Yours {
		if !v.First && w.chance(0.3) {
			continue
		}
		if err := w.playDuel(p, v.ID); err != nil {
			return err
		}
	}
	return nil
}

// friendToDuel is one of the player's friends to send a duel to, at random; nil for none.
func (w *world) friendToDuel(p *player) (*player, error) {
	ids, err := w.friendIDs(p)
	if err != nil || len(ids) == 0 {
		return nil, err
	}
	id := ids[w.r.IntN(len(ids))]
	for _, o := range w.players {
		if o.id == id {
			return o, nil
		}
	}
	return nil, nil
}
