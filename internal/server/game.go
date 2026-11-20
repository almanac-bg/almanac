package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/play"
)

// today is the day screen's state: the day and its issue (play.Issue), the viewer's streak and run (if any),
// a friend's duel waiting for them, whether they've finished a game yet,
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
	topics, err := s.game.IssueTopics(ctx, day)
	if err != nil {
		return nil, err
	}
	out["topics"] = topics
	var viewer int64
	done := false // the viewer has finished the day's ten
	if u != nil {
		viewer = u.ID
		s.game.AfterWait(ctx, u.ID) // a game just finished: what it brought (its notes) is in
		streak, err := s.game.StreakOf(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		out["streak"], out["spare"] = streak.Days, streak.Spare
		// What came of the days just missed, told on Начало once (play.TellStreak: the client says when it has): the
		// week forgave one; or it had forgiven one already and the streak ended, and a new one begins.
		recent := s.game.Now().In(play.Bulgaria).AddDate(0, 0, -3).Format(time.DateOnly)
		told, err := s.game.StreakTold(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		if n := len(streak.Forgiven); n > 0 && streak.Forgiven[n-1] >= recent && told != "forgiven:"+streak.Forgiven[n-1] {
			out["forgiven"] = streak.Forgiven[n-1]
		}
		if e := streak.Ended; e != nil && e.On >= recent && e.Days >= 2 {
			if told != "ended:"+e.On {
				out["ended"] = e
			}
		} else if e != nil && out["forgiven"] == nil && streak.Days <= 1 {
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
		// Whether they've finished a game of any kind yet: until then Начало is the day and the topics only.
		if out["played"], err = s.game.Played(ctx, u.ID); err != nil {
			return nil, err
		}
		// A friend said yes to their request: told once (POST /api/told).
		if out["accepted"], err = s.game.AcceptedOf(ctx, u.ID); err != nil {
			return nil, err
		}
		// A friend's duel waits for them: a quiet line, while it waits.
		if out["duel"], err = s.game.DuelsWaiting(ctx, u.ID); err != nil {
			return nil, err
		}
		// A game that ended without its result on screen: its news is told on Начало, once (play/told.go).
		if untold, err := s.game.Untold(ctx, u.ID); err != nil {
			return nil, err
		} else if untold != 0 {
			out["untold"] = untold
		}
		var runID int64
		err = s.db.Read.QueryRowContext(ctx, `SELECT id FROM runs WHERE user_id = ? AND kind = 'day' AND day = ?`, u.ID, day).Scan(&runID)
		if err == nil {
			st, err := s.game.State(ctx, u.ID, runID)
			if err != nil {
				return nil, err
			}
			out["run"] = st
			done = st.Done
			if st.Done { // the entry its right answers wrote that the result shows
				if out["entry"], err = s.game.EntryOfDay(ctx, u.ID, day); err != nil {
					return nil, err
				}
			}
		}
	}
	board, err := s.game.BoardOf(ctx, day, viewer)
	if err != nil {
		return nil, err
	}
	// The day's board names its players only to one who has played the day: never to a visitor, nor on a new
	// player's cover, nor where a shared day's link lands (share.go), where a score shared beside the names would say
	// whose it is. How many played, and how well on average, is anyone's.
	if !done {
		board.Top, board.Mine, board.Place = []play.Score{}, nil, 0
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
