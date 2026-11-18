package seed

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
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

// room is a room's evening: who's in it (its host first), and how many games.
type room struct {
	players []*player
	games   int
	mix     play.Mix
}

// roomsToday are the rooms played today: the host's quiz night each Thursday, a class's on a weekday morning now and
// then, and a few circles of friends at the weekend.
func (w *world) roomsToday() []room {
	var out []room
	weekday := w.dayAt(w.day, 0, 0).Weekday()
	for _, p := range w.players {
		if p.persona == keyHost && p.id != 0 && weekday == time.Thursday {
			people := append([]*player{p}, w.circleOf(p)...)
			out = append(out, room{players: people[:min(len(people), 8)], games: 2 + w.r.IntN(2), mix: play.MixMixed})
		}
	}
	if weekday == time.Saturday || weekday == time.Sunday {
		seen := map[int]bool{}
		for _, p := range w.active(w.day) {
			if seen[p.circle] || p.isPersona() || !w.chance(0.15) {
				continue
			}
			seen[p.circle] = true
			people := slices.DeleteFunc(w.circleOf(p), func(o *player) bool { return o.isPersona() })
			if len(people) < 2 {
				continue
			}
			people = append([]*player{p}, people[:min(len(people), 5)]...)
			out = append(out, room{players: people, games: 1 + w.r.IntN(2), mix: []play.Mix{play.MixEasy, play.MixMixed,
				play.MixHard}[w.r.IntN(3)]})
		}
	}
	return out
}

// playRooms plays the rooms of the evening as package room does, in memory (its questions drawn by play.DrawRoom, by
// what its players have seen: RoomPast; each answer graded and paid as it grades and pays them), and keeps each
// player's game as the room keeps it (RecordRoom).
func (w *world) playRooms(rooms []room) error {
	for _, rm := range rooms {
		w.rewind(w.dayAt(w.day, 19, 30).Add(w.between(0, 30*time.Minute)))
		w.rooms++
		for game := range rm.games {
			category := ""
			if w.chance(0.5) {
				category = w.b.Categories[w.r.IntN(len(w.b.Categories))].ID
			}
			length := []int{10, 10, 15, 20}[w.r.IntN(4)]
			ids := make([]int64, len(rm.players))
			for i, p := range rm.players {
				ids[i] = p.id
			}
			barred, seen, err := w.g.RoomPast(w.ctx, ids)
			if err != nil {
				return err
			}
			picks := play.DrawRoom(w.b, category, length, rm.mix, barred, seen, w.r)
			if len(picks) == 0 {
				continue
			}
			games := make([]play.RoomPlay, len(rm.players))
			for i := range games {
				games[i] = play.RoomPlay{Game: fmt.Sprintf("seed-%d-%d", w.rooms, game), Category: category, Picks: picks,
					Length: length, Players: len(rm.players)}
			}
			for n, pick := range picks {
				d, ok := w.g.Deal(pick)
				if !ok {
					return fmt.Errorf("can't deal %s", pick.ID)
				}
				shown := w.clock()
				longest := time.Duration(0)
				for i, p := range rm.players {
					took := w.took(p, d)
					longest = max(longest, took)
					g, err := bank.GradeAt(d, answerTo(d, w.right(p, d)), took)
					if err != nil {
						return err
					}
					worth := play.WorthOf(d.Question(), g.Score, took)
					games[i].Points += worth.Points
					games[i].Answers = append(games[i].Answers, play.RoomAnswer{N: n, Given: g.Given, Shown: g.Shown,
						Score: g.Score, Right: g.Right, Points: worth.Points, Ms: took.Milliseconds(), At: shown.Add(took)})
				}
				w.set(shown.Add(longest + w.between(5*time.Second, 12*time.Second)))
			}
			for i, p := range rm.players {
				if _, err := w.g.RecordRoom(w.as(p), p.id, games[i]); err != nil {
					return fmt.Errorf("keeping a room's game: %w", err)
				}
			}
			w.g.AftersDone(w.ctx)
			w.wait(w.between(time.Minute, 4*time.Minute))
		}
	}
	return nil
}

var debugSeed = false
