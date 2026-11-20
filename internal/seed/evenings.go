package seed

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/royal"
)

// evening is a Роял evening, played on the hub the server runs it with (royal.Hub), stepped on the history's clock:
// the lobby opens, those who come join it from their screens, and at 21:00 the games begin; each question is answered
// at each player's pace (or its time runs out), the cuts after the 5th, 8th, 11th and 14th put some out, those out
// play on, and the evening ends with its podium.
func (w *world) evening(later []session) error {
	start := w.dayAt(w.day, 21, 0)
	coming := map[*player]bool{}
	for _, s := range later {
		coming[s.p] = true
	}
	var planned []int64
	if err := w.ids(&planned, `SELECT user_id FROM royal_plans WHERE day = ?`, start.Format(time.DateOnly)); err != nil {
		return err
	}
	var players []*player
	for _, p := range w.active(w.day) {
		chance := p.royal
		if slices.Contains(planned, p.id) {
			chance = 0.9
		} else if !p.played[w.day] && !coming[p] {
			chance *= 0.3
		}
		if p.persona != keyDay2 && p.persona != keyGuest && w.chance(chance) {
			players = append(players, p)
		}
	}
	if len(players) > 50 {
		players = players[:50]
	}
	if len(players) < 2 {
		return nil
	}
	w.rewind(start.Add(-16 * time.Minute))
	w.royal.Step(w.ctx) // the evening ahead
	w.set(start.Add(-12 * time.Minute))
	w.royal.Step(w.ctx) // its lobby open
	subs := map[int64]*royal.Sub{}
	defer func() {
		for _, s := range subs {
			w.royal.Unfollow(s)
		}
	}()
	for _, p := range players {
		w.wait(w.between(5*time.Second, 40*time.Second))
		sub, err := w.royal.Follow(p.id, fmt.Sprint("seed ", p.id))
		if err != nil {
			return fmt.Errorf("following: %w", err)
		}
		subs[p.id] = sub
		look, err := w.g.LookOf(w.ctx, p.id)
		if err != nil {
			return err
		}
		err = w.royal.Join(w.ctx, royal.Player{ID: p.id, Name: p.name, Tag: p.tag, Look: look})
		if errors.Is(err, royal.ErrClosed) || errors.Is(err, royal.ErrShut) {
			continue
		}
		if err != nil {
			return fmt.Errorf("joining: %w", err)
		}
		w.royal.Step(w.ctx)
	}
	w.set(start)
	w.royal.Step(w.ctx)
	var picks []play.Pick
	var data string
	if err := w.one(&data, `SELECT questions FROM royals WHERE day = ? ORDER BY id DESC LIMIT 1`,
		start.Format(time.DateOnly)); err != nil {
		return err
	}
	if data == "" {
		return nil // nobody's tournament began
	}
	if err := json.Unmarshal([]byte(data), &picks); err != nil {
		return err
	}
	watcher := subs[players[0].id]
	type due struct {
		p  *player
		at time.Time
	}
	var plan []due
	lastN := -1
	for deadline := start.Add(25 * time.Minute); w.clock().Before(deadline) && !w.over(); {
		raw, _ := w.royal.Look(watcher)
		var v struct {
			Phase string `json:"phase"`
			N     int    `json:"n"`
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			return err
		}
		if v.Phase == play.RoyalEnd {
			break
		}
		if debugSeed {
			fmt.Println("royal", w.clock().Format("15:04:05"), v.Phase, v.N)
		}
		if v.Phase == play.RoyalQuestion && v.N != lastN && v.N < len(picks) {
			lastN = v.N
			d, ok := w.g.Deal(picks[v.N])
			if !ok {
				return fmt.Errorf("can't deal %s", picks[v.N].ID)
			}
			plan = plan[:0]
			for _, p := range players {
				if !w.chance(0.04) { // the time runs out on a few
					plan = append(plan, due{p, w.clock().Add(w.took(p, d))})
				}
			}
			slices.SortFunc(plan, func(a, b due) int { return a.at.Compare(b.at) })
		}
		for len(plan) > 0 && !plan[0].at.After(w.clock()) && v.Phase == play.RoyalQuestion {
			d, _ := w.g.Deal(picks[lastN])
			// Refused to one who isn't playing it (gone, or come late): as a screen's tap would be.
			_ = w.royal.Answer(w.ctx, plan[0].p.id, lastN, answerTo(d, w.right(plan[0].p, d)))
			plan = plan[1:]
		}
		w.wait(time.Second)
		w.royal.Step(w.ctx)
	}
	w.set(w.clock().Add(3 * time.Minute)) // the podium shown
	w.royal.Step(w.ctx)
	w.royal.Earned()
	w.g.AftersDone(w.ctx)
	return nil
}

// ids reads a column of ids.
func (w *world) ids(dst *[]int64, q string, args ...any) error {
	rows, err := w.db.Read.QueryContext(w.ctx, q, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		*dst = append(*dst, id)
	}
	return rows.Err()
}

var debugSeed = false
