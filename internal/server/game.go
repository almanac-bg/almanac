package server

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/play"
)

// today is the day screen's state: the day and its issue (play.Issue), the viewer's streak, level and run (if any),
// a live game they're in (playing), whether they've finished a game yet and which of the game's systems they've met,
// how many have played the day (and how well on average), and their friends' day.
func (s *Server) today(w http.ResponseWriter, r *http.Request) error {
	u, err := s.user(r)
	if err != nil {
		return err
	}
	out, err := s.todayOf(r.Context(), u)
	if err != nil {
		return err
	}
	return ok(w, out)
}

// todayOf is the day screen's state for u (nil: a visitor), as GET /api/day sends it and the page of Начало has it
// in its boot (pages.go).
func (s *Server) todayOf(ctx context.Context, u *account.User) (map[string]any, error) {
	day := s.game.Today()
	out := map[string]any{"day": day, "issue": play.Issue(day), "streak": 0, "run": nil}
	// Роял's lobby open or its games under way: Начало shows it to everyone then, new players too (it's the best
	// nudge there is), whatever play.NudgeRoyal says between evenings.
	royalNow := s.royal.Glance().Phase != "soon"
	out["royalNow"] = royalNow
	var viewer int64
	if u != nil {
		viewer = u.ID
		s.game.AfterWait(ctx, u.ID) // a game just finished: what it earned (goals, achievements) is in
		streak, err := s.game.StreakOf(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		out["streak"], out["reserve"] = streak.Days, streak.Reserve
		out["saved"] = s.game.InWeek(streak.Saved) // kept, by a reserve day
		out["next"] = streak.Next
		// What came of the days just missed, told on Начало once (play.TellStreak: the client says when it has): a
		// reserve day kept the streak; or none was left and it ended, and a new one begins.
		recent := s.game.Now().In(play.Bulgaria).AddDate(0, 0, -3).Format(time.DateOnly)
		told, err := s.game.StreakTold(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		if n := len(streak.Saved); n > 0 && streak.Saved[n-1] >= recent && told != "kept:"+streak.Saved[n-1] {
			out["kept"] = streak.Saved[n-1]
		}
		if e := streak.Ended; e != nil && e.On >= recent && e.Days >= 2 {
			if told != "ended:"+e.On {
				out["ended"] = e
			}
		} else if e != nil && out["kept"] == nil && streak.Days <= 1 {
			// Back after days away, the streak ended since the last day played (and not just now: that's told as its
			// end, above): welcomed back, once, with the longest streak they've had.
			last, err := s.game.LastDay(ctx, u.ID)
			if err != nil {
				return nil, err
			}
			if e.On > last && s.game.Away(last) && told != "back:"+last {
				out["back"] = map[string]any{"last": last, "best": streak.Best}
			}
		}
		if out["week"], err = s.game.Week(ctx, u.ID); err != nil {
			return nil, err
		}
		if out["level"], err = s.game.LevelNow(ctx, u.ID); err != nil {
			return nil, err
		}
		// Whether they've finished a game of any kind yet: until then Начало is the day and the topics only.
		var played bool
		if err := s.db.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM runs WHERE user_id = ? AND finished_at IS NOT NULL)`, u.ID).
			Scan(&played); err != nil {
			return nil, err
		}
		out["played"] = played
		// Whether Роял is among the ways to play with others: not for a new player while its evenings are thin.
		nudge, err := s.game.NudgeRoyal(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		// A live game they're in, under way: Начало has the way back to it.
		if p := s.playing(u.ID); p != nil {
			out["playing"] = p
		}
		out["royal"] = nudge || royalNow
		// A friend said yes to their request, and what came of a live duel they left: each told once (POST /api/told).
		if out["accepted"], err = s.game.AcceptedOf(ctx, u.ID); err != nil {
			return nil, err
		}
		if out["left"], err = s.game.LeftOf(ctx, u.ID); err != nil {
			return nil, err
		}
		// Which of the game's systems they've met: Начало shows the level and the goals once XP is open.
		if out["open"], err = s.game.OpenOf(ctx, u.ID); err != nil {
			return nil, err
		}
		// A game that ended without its result on screen: its news is told on Начало, once (play/told.go).
		if untold, err := s.game.Untold(ctx, u.ID); err != nil {
			return nil, err
		} else if untold != 0 {
			out["untold"] = untold
		}
		var runID int64
		done := false
		err = s.db.Read.QueryRowContext(ctx, `SELECT id FROM runs WHERE user_id = ? AND kind = 'day' AND day = ?`, u.ID, day).Scan(&runID)
		if err == nil {
			st, err := s.game.State(ctx, u.ID, runID)
			if err != nil {
				return nil, err
			}
			out["run"], done = st, st.Done
			if st.Done { // the right answer the fewest others got, for the result shared
				if out["rarest"], err = s.game.RarestRight(ctx, u.ID, day); err != nil {
					return nil, err
				}
				// The questions it got wrong will wait for a second chance: said when there'll be a game of them.
				if missed, all, err := s.game.Misses(ctx, u.ID, runID); err != nil {
					return nil, err
				} else if missed > 0 && all >= play.MistakesFrom {
					out["misses"] = map[string]int{"n": missed, "days": int(play.MistakesAfter.Hours() / 24)}
				}
			}
		}
		// While today's ten wait, how yesterday's ended for them, once its board is final.
		if !done {
			if out["yesterday"], err = s.game.YesterdayOf(ctx, u.ID); err != nil {
				return nil, err
			}
		}
	}
	board, err := s.game.BoardOf(ctx, day, viewer)
	if err != nil {
		return nil, err
	}
	out["board"] = board
	if u != nil {
		friends, err := s.game.FriendsBoard(ctx, day, u.ID)
		if err != nil {
			return nil, err
		}
		out["friends"] = friends
		// No friend has played yet: whether there's any, for the boards to ask a player with none to add one.
		if friends == nil {
			var any bool
			if err := s.db.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ?)`, u.ID).
				Scan(&any); err != nil {
				return nil, err
			}
			out["befriended"] = any
		}
	}
	return out, nil
}

func (s *Server) startDay(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	st, err := s.game.StartDay(s.fromClient(r, u.ID), u.ID)
	if err != nil {
		return err
	}
	return ok(w, st)
}

var dayPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// board is a day's board (Класации' „Вчера“): its best and the viewer's place, its issue, whether it's final
// (play.DaySettled: its first is the day's winner), and the viewer's friends on it.
func (s *Server) board(w http.ResponseWriter, r *http.Request) error {
	day := r.PathValue("day")
	if _, err := time.Parse(time.DateOnly, day); err != nil || !dayPattern.MatchString(day) {
		return errNotFound
	}
	u, err := s.user(r)
	if err != nil {
		return err
	}
	var viewer int64
	if u != nil {
		viewer = u.ID
	}
	b, err := s.game.BoardOf(r.Context(), day, viewer)
	if err != nil {
		return err
	}
	out := map[string]any{"board": b, "issue": play.Issue(day), "final": s.game.DaySettled(day)}
	if u != nil {
		if out["friends"], err = s.game.FriendsBoard(r.Context(), day, u.ID); err != nil {
			return err
		}
	}
	return ok(w, out)
}

func (s *Server) startTopic(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Category string `json:"category"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.limits.allow("topic:"+strconv.FormatInt(u.ID, 10), 120, time.Hour) {
		return errTooMany
	}
	st, err := s.game.StartTopic(s.fromClient(r, u.ID), u.ID, in.Category)
	if err != nil {
		return err
	}
	return ok(w, st)
}

// mistakes says how many questions wait for the player's second chance, from how many it opens, and, while there are
// too few to play, what's still to come (play.Coming).
func (s *Server) mistakes(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	n, err := s.game.Mistakes(r.Context(), u.ID)
	if err != nil {
		return err
	}
	out := map[string]any{"waiting": n, "from": play.MistakesFrom}
	if n < play.MistakesFrom {
		if out["coming"], err = s.game.ComingOf(r.Context(), u.ID); err != nil {
			return err
		}
	}
	return ok(w, out)
}

// startMistakes starts a second chance: the questions the player got wrong, asked again.
func (s *Server) startMistakes(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if !s.limits.allow("topic:"+strconv.FormatInt(u.ID, 10), 120, time.Hour) {
		return errTooMany
	}
	st, err := s.game.StartMistakes(s.fromClient(r, u.ID), u.ID)
	if err != nil {
		return err
	}
	return ok(w, st)
}

// runOf is the player and the run a request names.
func (s *Server) runOf(r *http.Request) (int64, int64, error) {
	u, err := s.mustUser(r)
	if err != nil {
		return 0, 0, err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return 0, 0, errNotFound
	}
	return u.ID, id, nil
}

// left are the player's games of their own left unfinished today (play.Left): a topic's tile says where each stopped,
// and its screen goes on with it.
func (s *Server) left(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	runs, err := s.game.Left(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"runs": runs})
}

// Playing is a live game the player is in, under way now, which their screen may have left: a live duel, a room's
// game (by its code) or tonight's Роял. Only one is said, in that order: a player is rarely in two. A seat in Роял's
// lobby is one too, with its start (Starts): it's kept while the player plays something else (royal.Hub.Waiting).
type Playing struct {
	Kind   string `json:"kind"` // "duel", "room" or "royal"
	Code   string `json:"code,omitempty"`
	Starts int64  `json:"starts,omitempty"`
}

// playing is the live game a player is in now, if any.
func (s *Server) playing(id int64) *Playing {
	switch {
	case s.live.Playing(id):
		return &Playing{Kind: "duel"}
	case s.rooms.Playing(id) != "":
		return &Playing{Kind: "room", Code: s.rooms.Playing(id)}
	case s.royal.Playing(id):
		return &Playing{Kind: "royal"}
	}
	if start, ok := s.royal.Waiting(id); ok {
		return &Playing{Kind: "royal", Starts: start.UnixMilli()}
	}
	return nil
}

// playingNow says which live game the player is in now (null: none), for a screen deciding whether to go straight
// back into it.
func (s *Server) playingNow(w http.ResponseWriter, r *http.Request) error {
	u, err := s.user(r)
	if err != nil {
		return err
	}
	var p *Playing
	if u != nil {
		p = s.playing(u.ID)
	}
	return ok(w, map[string]any{"playing": p})
}

func (s *Server) runState(w http.ResponseWriter, r *http.Request) error {
	user, id, err := s.runOf(r)
	if err != nil {
		return err
	}
	st, err := s.game.State(r.Context(), user, id)
	if err != nil {
		return err
	}
	return ok(w, st)
}

func (s *Server) show(w http.ResponseWriter, r *http.Request) error {
	user, id, err := s.runOf(r)
	if err != nil {
		return err
	}
	st, err := s.game.Show(r.Context(), user, id)
	if err != nil {
		return err
	}
	return ok(w, st)
}

// start starts a question's time once its pictures are in on the player's screen (play.Start).
func (s *Server) start(w http.ResponseWriter, r *http.Request) error {
	user, id, err := s.runOf(r)
	if err != nil {
		return err
	}
	var in struct {
		N int `json:"n"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	st, err := s.game.Start(r.Context(), user, id, in.N)
	if err != nil {
		return err
	}
	return ok(w, st)
}

func (s *Server) answer(w http.ResponseWriter, r *http.Request) error {
	user, id, err := s.runOf(r)
	if err != nil {
		return err
	}
	var in struct {
		N      int             `json:"n"`
		Answer json.RawMessage `json:"answer"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	res, err := s.game.Answer(r.Context(), user, id, in.N, in.Answer)
	if err != nil {
		return err
	}
	return ok(w, res)
}

func (s *Server) review(w http.ResponseWriter, r *http.Request) error {
	user, id, err := s.runOf(r)
	if err != nil {
		return err
	}
	items, err := s.game.Review(r.Context(), user, id)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"questions": items})
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	st, err := s.game.StatsOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, st)
}

// games is a page of the player's finished games, newest first (Профил's „Всички игри“): of a kind (?kind=day, topic
// or others; none: all), from where the page before ended (?from=, its next).
func (s *Server) games(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	page, err := s.game.GamesOf(r.Context(), u.ID, q.Get("kind"), q.Get("from"), play.GamesPage)
	if err != nil {
		return err
	}
	return ok(w, page)
}
