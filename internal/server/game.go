package server

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

// today is the day screen's state: the day, the viewer's streak, level and run (if any), and how many have played it.
func (s *Server) today(w http.ResponseWriter, r *http.Request) error {
	u, err := s.user(r)
	if err != nil {
		return err
	}
	day := s.game.Today()
	out := map[string]any{"day": day, "streak": 0, "run": nil}
	var viewer int64
	if u != nil {
		viewer = u.ID
		if out["streak"], err = s.game.Streak(r.Context(), u.ID); err != nil {
			return err
		}
		if out["week"], err = s.game.Week(r.Context(), u.ID); err != nil {
			return err
		}
		if out["level"], err = s.game.LevelNow(r.Context(), u.ID); err != nil {
			return err
		}
		var runID int64
		err := s.db.Read.QueryRowContext(r.Context(), `SELECT id FROM runs WHERE user_id = ? AND kind = 'day' AND day = ?`, u.ID, day).Scan(&runID)
		if err == nil {
			st, err := s.game.State(r.Context(), u.ID, runID)
			if err != nil {
				return err
			}
			out["run"] = st
		}
	}
	board, err := s.game.BoardOf(r.Context(), day, viewer)
	if err != nil {
		return err
	}
	out["board"] = board
	if u != nil {
		friends, err := s.game.FriendsBoard(r.Context(), day, u.ID)
		if err != nil {
			return err
		}
		out["friends"] = friends
	}
	return ok(w, out)
}

func (s *Server) startDay(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	st, err := s.game.StartDay(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, st)
}

var dayPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

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
	return ok(w, b)
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
	st, err := s.game.StartTopic(r.Context(), u.ID, in.Category)
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
