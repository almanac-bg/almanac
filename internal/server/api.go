package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/room"
)

// apiError is an error a player can be shown: a code for the client, and the words for the player.
type apiError struct {
	status  int
	code    string
	message string
}

func (e *apiError) Error() string { return e.code }

var (
	errNotFound   = &apiError{http.StatusNotFound, "not_found", "Няма такова нещо."}
	errBadRequest = &apiError{http.StatusBadRequest, "bad_request", "Нещо в заявката не е наред."}
	errSignedOut  = &apiError{http.StatusUnauthorized, "signed_out", "Първо влез в профила си."}
	errTooMany    = &apiError{http.StatusTooManyRequests, "too_many", "Твърде много опити. Опитай пак малко по-късно."}
)

// playerErrors are the errors a player may cause, as the API answers them.
var playerErrors = map[error]*apiError{
	play.ErrNoRun:          {http.StatusNotFound, "no_run", "Няма такава игра."},
	play.ErrNoTopic:        {http.StatusNotFound, "no_topic", "Няма такава тема."},
	play.ErrOutOfStep:      {http.StatusConflict, "out_of_step", "Играта е продължила другаде. Зареждаме я наново."},
	play.ErrBadAnswer:      {http.StatusBadRequest, "bad_answer", "Този отговор не става за този въпрос."},
	play.ErrNoQuestion:     {http.StatusServiceUnavailable, "no_questions", "В момента няма въпроси за игра."},
	room.ErrNoRoom:         {http.StatusNotFound, "no_room", "Няма такава стая. Може да е затворена."},
	room.ErrFull:           {http.StatusConflict, "full", "Стаята е пълна."},
	room.ErrNotYours:       {http.StatusForbidden, "not_host", "Това прави домакинът."},
	room.ErrNotNow:         {http.StatusConflict, "not_now", "Не точно сега."},
	room.ErrAnswer:         {http.StatusBadRequest, "bad_answer", "Този отговор не става за този въпрос."},
	room.ErrTooMany:        {http.StatusServiceUnavailable, "too_many_rooms", "Твърде много отворени стаи. Опитай след малко."},
	room.ErrNobody:         {http.StatusNotFound, "nobody", "В момента няма с кого. Опитай пак след малко."},
	account.ErrBadEmail:    {http.StatusBadRequest, "bad_email", "Това не прилича на имейл адрес."},
	account.ErrTooSoon:     {http.StatusTooManyRequests, "too_soon", "Току-що ти изпратихме код. Провери пощата си."},
	account.ErrBadCode:     {http.StatusBadRequest, "bad_code", "Грешен код."},
	account.ErrCodeExpired: {http.StatusBadRequest, "code_expired", "Кодът е изтекъл. Поискай нов."},
	account.ErrBadName:     {http.StatusBadRequest, "bad_name", "Името трябва да е от 2 до 20 букви, цифри или интервали."},
	account.ErrNameTaken:   {http.StatusConflict, "name_taken", "Това име е заето."},
}

// apiHandler runs an API handler: its error becomes a JSON answer, an unexpected one a 500 that's logged.
func (s *Server) apiHandler(h func(http.ResponseWriter, *http.Request) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		err := h(w, r)
		if err == nil {
			return
		}
		var ae *apiError
		if !errors.As(err, &ae) {
			for known, e := range playerErrors {
				if errors.Is(err, known) {
					ae = e
				}
			}
		}
		if ae == nil {
			slog.Error("api", "method", r.Method, "path", r.URL.Path, "err", err)
			s.problems.add(fmt.Sprintf("server: %s %s: %v", r.Method, r.Pattern, err))
			ae = &apiError{http.StatusInternalServerError, "server", "Нещо се обърка при нас. Опитай пак."}
		}
		writeJSON(w, ae.status, map[string]string{"error": ae.code, "message": ae.message})
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func ok(w http.ResponseWriter, v any) error {
	writeJSON(w, http.StatusOK, v)
	return nil
}

// readJSON decodes a small JSON body into v, refusing anything else.
func readJSON(r *http.Request, v any) error {
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		return errBadRequest
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 64<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errBadRequest
	}
	return nil
}

// user is who's signed in, or nil.
func (s *Server) user(r *http.Request) (*account.User, error) {
	c, err := r.Cookie(s.cookie)
	if err != nil {
		return nil, nil
	}
	return s.accounts.Session(r.Context(), c.Value)
}

// mustUser is who's signed in, or errSignedOut.
func (s *Server) mustUser(r *http.Request) (*account.User, error) {
	u, err := s.user(r)
	if err == nil && u == nil {
		err = errSignedOut
	}
	return u, err
}

func (s *Server) setSession(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: s.cookie, Value: token, Path: "/",
		MaxAge:   account.SessionDays * 24 * 60 * 60,
		HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: s.cookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) error {
	if err := s.db.Read.PingContext(r.Context()); err != nil {
		return err
	}
	return ok(w, map[string]any{"ok": true, "version": s.cfg.Version, "questions": len(s.bank.Load().Live("", ""))})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) error {
	u, err := s.user(r)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"user": u})
}

// guest starts a player who has none: the first time they play.
func (s *Server) guest(w http.ResponseWriter, r *http.Request) error {
	if u, err := s.user(r); err != nil || u != nil {
		if err != nil {
			return err
		}
		return ok(w, map[string]any{"user": u})
	}
	if !s.limits.allow("guest:"+s.clientIP(r), 30, time.Hour) {
		return errTooMany
	}
	u, token, err := s.accounts.Guest(r.Context())
	if err != nil {
		return err
	}
	s.setSession(w, token)
	return ok(w, map[string]any{"user": u})
}

func (s *Server) sendCode(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Email string `json:"email"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	email, err := account.NormalEmail(in.Email)
	if err != nil {
		return err
	}
	if !s.limits.allow("code:"+s.clientIP(r), 10, time.Hour) || !s.limits.allow("code:"+email, 5, time.Hour) {
		return errTooMany
	}
	if err := s.accounts.SendCode(r.Context(), email); err != nil {
		return err
	}
	return ok(w, map[string]any{"sent": true})
}

func (s *Server) verify(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.limits.allow("verify:"+s.clientIP(r), 30, time.Hour) {
		return errTooMany
	}
	current, err := s.user(r)
	if err != nil {
		return err
	}
	u, token, err := s.accounts.Verify(r.Context(), in.Email, in.Code, current)
	if err != nil {
		return err
	}
	if c, err := r.Cookie(s.cookie); err == nil {
		_ = s.accounts.SignOut(r.Context(), c.Value)
	}
	s.setSession(w, token)
	return ok(w, map[string]any{"user": u})
}

func (s *Server) signOut(w http.ResponseWriter, r *http.Request) error {
	if c, err := r.Cookie(s.cookie); err == nil {
		if err := s.accounts.SignOut(r.Context(), c.Value); err != nil {
			return err
		}
	}
	s.clearSession(w)
	return ok(w, map[string]any{"user": nil})
}

func (s *Server) rename(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.limits.allow("rename:"+s.clientIP(r), 20, time.Hour) {
		return errTooMany
	}
	if u.Name, err = s.accounts.Rename(r.Context(), u.ID, in.Name); err != nil {
		return err
	}
	return ok(w, map[string]any{"user": u})
}

// deleteAccount deletes the player and everything of theirs: runs, answers, sessions.
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if err := s.accounts.Delete(r.Context(), u.ID); err != nil {
		return err
	}
	s.clearSession(w)
	return ok(w, map[string]any{"user": nil})
}
