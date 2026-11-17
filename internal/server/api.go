package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/live"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/room"
	"github.com/almanac-bg/almanac/internal/royal"
)

// apiError is an error a player can be shown: a code for the client, and the words for the player.
type apiError struct {
	status  int
	code    string
	message string
}

func (e *apiError) Error() string { return e.code }

var (
	errNotFound   = &apiError{http.StatusNotFound, "not_found", "Не го намираме."}
	errBadRequest = &apiError{http.StatusBadRequest, "bad_request", "Нещо не е наред. Опитай пак."}
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
	play.ErrNoYear:         {http.StatusNotFound, "no_year", "Тази година още не е започнала."},
	play.ErrNoMistakes:     {http.StatusConflict, "no_mistakes", "Още няма въпроси за втори шанс."},
	play.ErrNoInvite:       {http.StatusNotFound, "no_invite", "Няма такава покана. Може връзката да е грешна."},
	play.ErrOwnInvite:      {http.StatusConflict, "own_invite", "Това е твоята покана. Прати я на приятел."},
	play.ErrNotFriends:     {http.StatusNotFound, "not_friends", "Не сте приятели в играта."},
	play.ErrManyFriends:    {http.StatusConflict, "many_friends", "Списъкът с приятели е пълен: до 200."},
	play.ErrNotYours:       {http.StatusForbidden, "not_yours", "Това още не е отключено."},
	play.ErrNotice:         {http.StatusBadRequest, "no_notice", "Няма такова известие."},
	play.ErrNoPlayer:       {http.StatusNotFound, "no_player", "Няма играч с такова потребителско име."},
	play.ErrNoDuel:         {http.StatusNotFound, "no_duel", "Този дуел вече го няма."},
	play.ErrManyWaiting:    {http.StatusConflict, "many_duels", "Пет твои дуела чакат приятели. Изчакай някой от тях да свърши."},
	play.ErrNobody:         {http.StatusConflict, "nobody", "Точно сега няма с кого да играеш. Опитай след малко."},
	live.ErrNoMatch:        {http.StatusNotFound, "no_duel", "Този дуел вече го няма."},
	live.ErrNotNow:         {http.StatusConflict, "not_now", "Този въпрос вече отмина."},
	live.ErrAnswer:         {http.StatusBadRequest, "bad_answer", "Този отговор не става за този въпрос."},
	live.ErrTooMany:        {http.StatusServiceUnavailable, "too_many_duels", "Твърде много дуели в момента. Опитай след малко."},
	play.ErrNoRequest:      {http.StatusNotFound, "no_request", "Поканата вече я няма."},
	play.ErrManyRequests:   {http.StatusConflict, "many_requests", "Твърде много покани чакат отговор: до 50."},
	play.ErrRoomGame:       {http.StatusBadRequest, "bad_room_game", "Стаята играе по 5, 10, 15 или 20 въпроса, лесни, смесени или трудни."},
	royal.ErrClosed:        {http.StatusConflict, "royal_closed", "Входът за Роял още не е отворен."}, // joinRoyal says when
	royal.ErrShut:          {http.StatusConflict, "royal_closed", "Роял вече тече, а закъснелите влизат до 3-тия въпрос."},
	royal.ErrNotNow:        {http.StatusConflict, "not_now", "Вече е късно за това."},
	room.ErrNoRoom:         {http.StatusNotFound, "no_room", "Няма такава стая. Може да е затворена."},
	room.ErrFull:           {http.StatusConflict, "full", "Стаята е пълна."},
	room.ErrNotYours:       {http.StatusForbidden, "not_host", "Това прави водещият."},
	room.ErrRemoved:        {http.StatusForbidden, "removed", "Водещият те махна от стаята."},
	room.ErrNotNow:         {http.StatusConflict, "not_now", "Вече е късно за това."},
	room.ErrAnswer:         {http.StatusBadRequest, "bad_answer", "Този отговор не става за този въпрос."},
	room.ErrTooMany:        {http.StatusServiceUnavailable, "too_many_rooms", "Твърде много отворени стаи. Опитай след малко."},
	room.ErrPaused:         {http.StatusServiceUnavailable, "updating", "Играта се обновява. Опитай пак след малко."},
	room.ErrNoPlayers:      {http.StatusConflict, "no_players", "Още няма играчи в стаята."},
	account.ErrBadEmail:    {http.StatusBadRequest, "bad_email", "Това не прилича на имейл адрес."},
	account.ErrTooSoon:     {http.StatusTooManyRequests, "too_soon", "Току-що ти пратихме код. Провери пощата си."},
	account.ErrBadCode:     {http.StatusBadRequest, "bad_code", "Грешен код."},
	account.ErrCodeExpired: {http.StatusBadRequest, "code_expired", "Кодът е изтекъл. Поискай нов."},
	account.ErrCodeTries:   {http.StatusBadRequest, "code_tries", "Твърде много опити. Поискай нов код."},
	account.ErrNoHandoff:   {http.StatusNotFound, "no_handoff", "Тази връзка вече не работи: играта ти остана там, където я започна."},
	account.ErrBadName:     {http.StatusBadRequest, "bad_name", "Името трябва да е от 2 до 30 букви, цифри или интервали."},
	account.ErrBadTag:      {http.StatusBadRequest, "bad_tag", "Потребителското име е от 3 до 20 латински букви, цифри или _ и започва с буква."},
	account.ErrTagTaken:    {http.StatusConflict, "tag_taken", "Това потребителско име е заето. Опитай друго."},
}

// apiHandler runs an API handler: its error becomes a JSON answer, an unexpected one a 500 that's logged.
func (s *Server) apiHandler(h func(http.ResponseWriter, *http.Request) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		err := h(w, r)
		if err == nil {
			return
		}
		// The player went away (closed the page mid-request): nobody to answer, nothing wrong.
		if errors.Is(err, context.Canceled) && r.Context().Err() != nil {
			w.WriteHeader(499)
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
	// A class or a pub comes from one address: a room's worth of new players (room.MaxPlayers), and some.
	if !s.limits.allow("guest:"+s.clientIP(r), 60, time.Hour) {
		return errTooMany
	}
	// Where the player came in: the path the client was first opened at (an old client sends nothing).
	var in struct {
		From string `json:"from"`
	}
	_ = readJSON(r, &in)
	u, token, err := s.accounts.Guest(r.Context())
	if err != nil {
		return err
	}
	if err := s.cameFrom(r.Context(), u.ID, in.From, inApp(r)); err != nil {
		slog.Warn("came from", "err", err) // the guest is made all the same
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
		if soon := (account.TooSoon{}); errors.As(err, &soon) {
			return &apiError{http.StatusTooManyRequests, "too_soon",
				fmt.Sprintf("Току-що ти пратихме код. Нов можеш да поискаш след %d с.", seconds(soon.Wait))}
		}
		return err
	}
	// Another code may go after CodeEvery: the client counts it down.
	return ok(w, map[string]any{"sent": true, "again": seconds(account.CodeEvery)})
}

// seconds is a wait in whole seconds, rounded up: never "0 с" while there's still a wait.
func seconds(d time.Duration) int { return int((d + time.Second - 1) / time.Second) }

// wrongCodeWords say a code was wrong and, once the tries left are few, how many.
func wrongCodeWords(left int) string {
	switch left {
	case 1:
		return "Грешен код. Остава ти още 1 опит."
	case 2:
		return "Грешен код. Остават ти още 2 опита."
	}
	return "Грешен код."
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
	if wrong := (account.WrongCode{}); errors.As(err, &wrong) {
		return &apiError{http.StatusBadRequest, "bad_code", wrongCodeWords(wrong.Left)}
	}
	if err != nil {
		return err
	}
	if c, err := r.Cookie(s.cookie); err == nil {
		_ = s.accounts.SignOut(r.Context(), c.Value)
	}
	s.setSession(w, token)
	return ok(w, map[string]any{"user": u})
}

// handoff makes the link that brings the player's game to the phone's own browser, once (account.Handoff): from an
// app's browser (Messenger, Instagram …) where a guest's game would otherwise stay. The link opens the app's page
// /hand/<token>, which takes it by takeHandoff: a page, so that a link preview fetching it takes nothing.
func (s *Server) handoff(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if !s.limits.allow("handoff:"+strconv.FormatInt(u.ID, 10), 20, time.Hour) {
		return errTooMany
	}
	token, err := s.accounts.Handoff(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"url": s.cfg.PublicURL + "/hand/" + token})
}

// takeHandoff signs this browser in by a handoff's token, the game it brings joined with what's here.
func (s *Server) takeHandoff(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.limits.allow("hand:"+s.clientIP(r), 30, time.Hour) {
		return errTooMany
	}
	current, err := s.user(r)
	if err != nil {
		return err
	}
	u, token, err := s.accounts.TakeHandoff(r.Context(), in.Token, current)
	if err != nil {
		return err
	}
	if token != "" {
		if c, err := r.Cookie(s.cookie); err == nil {
			_ = s.accounts.SignOut(r.Context(), c.Value)
		}
		s.setSession(w, token)
	}
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
	// Either or both: a new name, a new tag.
	var in struct {
		Name *string `json:"name"`
		Tag  *string `json:"tag"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	// By player, and loosely by address: a whole class names itself as it comes into a room, from one network.
	if !s.limits.allow("rename:"+strconv.FormatInt(u.ID, 10), 20, time.Hour) ||
		!s.limits.allow("rename-ip:"+s.clientIP(r), 200, time.Hour) {
		return errTooMany
	}
	if in.Name != nil {
		if u.Name, err = s.accounts.Rename(r.Context(), u.ID, *in.Name); err != nil {
			return err
		}
	}
	if in.Tag != nil {
		if u.Tag, err = s.accounts.Retag(r.Context(), u.ID, *in.Tag); err != nil {
			return err
		}
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
