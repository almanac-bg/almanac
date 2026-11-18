package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/live"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/room"
	"github.com/almanac-bg/almanac/internal/royal"
	"github.com/almanac-bg/almanac/internal/store"
)

// apiError is an error a player can be shown: a code for the client, and the words for the player.
type apiError struct {
	status  int
	code    string
	message string
}

func (e *apiError) Error() string { return e.code }

var (
	errNotFound   = &apiError{http.StatusNotFound, "not_found", "Не намираме това, което търсиш."}
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
	play.ErrDayOver:        {http.StatusGone, "day_over", "Денят на тази игра свърши. Днешните въпроси те чакат в Начало."},
	play.ErrNoYear:         {http.StatusNotFound, "no_year", "Тази година още не е започнала."},
	play.ErrNoMistakes:     {http.StatusConflict, "no_mistakes", "Още няма достатъчно въпроси за втори шанс."},
	play.ErrNoInvite:       {http.StatusNotFound, "no_invite", "Няма такава покана. Може връзката да е грешна."},
	play.ErrOwnInvite:      {http.StatusConflict, "own_invite", "Това е твоята покана. Прати я на приятел."},
	play.ErrNotFriends:     {http.StatusNotFound, "not_friends", "Не сте приятели в играта."},
	play.ErrManyFriends:    {http.StatusConflict, "many_friends", "Списъкът с приятели е пълен: в него има място за 200."},
	play.ErrNotYours:       {http.StatusForbidden, "not_yours", "Това още не е отключено."},
	play.ErrNotice:         {http.StatusBadRequest, "no_notice", "Няма такова известие."},
	play.ErrNoPlayer:       {http.StatusNotFound, "no_player", "Няма играч с такова потребителско име."},
	play.ErrNoDuel:         {http.StatusNotFound, "no_duel", "Този дуел вече го няма."},
	play.ErrNoChallenge:    {http.StatusNotFound, "no_challenge", "Това предизвикателство вече го няма."},
	play.ErrChallengeOver:  {http.StatusGone, "challenge_over", "Времето за това предизвикателство изтече."},
	play.ErrChallengeGone:  {http.StatusGone, "challenge_over", "Въпрос от това предизвикателство се оказа грешен, затова то вече не може да се играе."},
	play.ErrOwnChallenge:   {http.StatusConflict, "own_challenge", "Това е твоето предизвикателство. Прати го на някого."},
	play.ErrChallengeHeld:  {http.StatusConflict, "challenge_held", "Това предизвикателство е първо за приятеля, на когото е пратено. Опитай пак, щом го изиграе."},
	play.ErrNoChallengeRun: {http.StatusBadRequest, "no_challenge_run", "Предизвикателство става само от завършена игра от десет въпроса."},
	play.ErrManyWaiting:    {http.StatusConflict, "many_challenges", "Три твои предизвикателства вече чакат този приятел. Изчакай да изиграе някое."},
	play.ErrNobody:         {http.StatusConflict, "nobody", "Точно сега няма с кого да играеш. Опитай след малко."},
	live.ErrNoMatch:        {http.StatusNotFound, "no_duel", "Този дуел вече го няма."},
	live.ErrNotNow:         {http.StatusConflict, "not_now", "Този въпрос вече отмина."},
	live.ErrAnswer:         {http.StatusBadRequest, "bad_answer", "Този отговор не става за този въпрос."},
	live.ErrTooMany:        {http.StatusServiceUnavailable, "too_many_duels", "Твърде много дуели в момента. Опитай след малко."},
	play.ErrNoRequest:      {http.StatusNotFound, "no_request", "Поканата вече я няма."},
	play.ErrManyRequests:   {http.StatusConflict, "many_requests", "Твърде много покани чакат отговор. Изчакай да отговорят на някоя от тях."},
	play.ErrRoomGame:       {http.StatusBadRequest, "bad_room_game", "Стаята играе по 5, 10, 15 или 20 въпроса, лесни, смесени или трудни."},
	royal.ErrClosed:        {http.StatusConflict, "royal_closed", "Входът за Роял още не е отворен."}, // joinRoyal says when
	royal.ErrShut:          {http.StatusConflict, "royal_closed", "Роял вече тече, а закъснелите влизат само до 3-тия въпрос."},
	royal.ErrNotNow:        {http.StatusConflict, "not_now", "Вече е късно за това."},
	room.ErrNoRoom:         {http.StatusNotFound, "no_room", "Няма такава стая. Може да е затворена."},
	room.ErrFull:           {http.StatusConflict, "full", "Стаята е пълна."},
	room.ErrNotYours:       {http.StatusForbidden, "not_host", "Само водещият може да прави това."},
	room.ErrRemoved:        {http.StatusForbidden, "removed", "Водещият те махна от стаята."},
	room.ErrNotNow:         {http.StatusConflict, "not_now", "Вече е късно за това."},
	room.ErrAnswer:         {http.StatusBadRequest, "bad_answer", "Този отговор не става за този въпрос."},
	room.ErrTooMany:        {http.StatusServiceUnavailable, "too_many_rooms", "Твърде много отворени стаи. Опитай след малко."},
	room.ErrPaused:         {http.StatusServiceUnavailable, "updating", "Играта се обновява. Опитай пак след малко."},
	room.ErrNameAgain:      {http.StatusBadRequest, "name_again", "Водещият помоли за друго име. Избери ново."},
	account.ErrBadEmail:    {http.StatusBadRequest, "bad_email", "Това не прилича на имейл адрес."},
	account.ErrTooSoon:     {http.StatusTooManyRequests, "too_soon", "Току-що ти пратихме код. Провери пощата си."},
	account.ErrBadCode:     {http.StatusBadRequest, "bad_code", "Грешен код."},
	account.ErrCodeExpired: {http.StatusBadRequest, "code_expired", "Кодът вече не важи. Поискай нов."},
	account.ErrCodeTries:   {http.StatusBadRequest, "code_tries", "Твърде много опити. Поискай нов код."},
	account.ErrCodesBusy:   {http.StatusServiceUnavailable, "codes_busy", "Точно сега пращаме много кодове. Опитай пак след минута."},
	account.ErrAddressBusy: {http.StatusTooManyRequests, "address_busy",
		"Вече пратихме няколко кода на този адрес. Провери пощата си, и папката за спам, или опитай пак по-късно."},
	account.ErrNoMail: {http.StatusBadRequest, "no_mail",
		"Писмата ни до този адрес не стигат. Провери дали е изписан вярно или опитай с друг."},
	account.ErrNoHandoff: {http.StatusNotFound, "no_handoff", "Тази връзка вече не работи: играта ти остана там, където я започна."},
	account.ErrHandoffSignedIn: {http.StatusConflict, "handoff_signed_in",
		"Тук вече играеш с профила си. За да добавиш към него играта от другото място, влез с имейла си там, където я започна."},
	account.ErrHandoffHere: {http.StatusConflict, "handoff_here",
		"Тук вече имаш своя игра. Двете игри се събират само с имейл: запази тази с имейл, после влез със същия имейл там, където е другата."},
	account.ErrBadName: {http.StatusBadRequest, "bad_name",
		"Името трябва да е от 2 до 30 знака: букви на кирилица или латиница, цифри, интервали, точки или тирета, с поне една буква."},
	account.ErrNameScripts: {http.StatusBadRequest, "bad_name",
		"Пиши всяка дума от името само на кирилица или само на латиница, без да ги смесваш."},
	account.ErrNameLink:     {http.StatusBadRequest, "bad_name", "След точка в името трябва да има интервал: името не може да е адрес на сайт."},
	account.ErrNameReserved: {http.StatusBadRequest, "reserved_name", "Това име е запазено за играта. Избери друго."},
	account.ErrNameRude:     {http.StatusBadRequest, "bad_name", "Това име звучи грубо. Избери друго."},
	account.ErrBadTag:       {http.StatusBadRequest, "bad_tag", "Потребителското име трябва да е от 3 до 20 знака: латински букви, цифри или _, като първият е буква."},
	account.ErrTagTaken:     {http.StatusConflict, "tag_taken", "Това потребителско име е заето. Опитай друго."},
	account.ErrSuspended:    {http.StatusForbidden, "suspended", "Този профил е спрян от екипа на играта."},
	play.ErrBlocked:         {http.StatusNotFound, "no_player", "Няма такъв играч."},
	play.ErrManyBlocks:      {http.StatusConflict, "many_blocks", "Имаш твърде много блокирани играчи."},
}

// versionHeader names the game's version on every API answer: a page loaded before a deploy sees it's another and
// loads itself anew at a moment that costs the player nothing (web/src/fresh.ts).
const versionHeader = "X-Almanac-Version"

// apiHandler runs an API handler: its error becomes a JSON answer, an unexpected one a 500 that's logged. A write
// past its rate (mayWrite) isn't run.
func (s *Server) apiHandler(h func(http.ResponseWriter, *http.Request) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set(versionHeader, s.cfg.Version)
		var err error
		if s.mayWrite(r) {
			err = h(w, r)
		} else {
			err = errTooMany
		}
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
			slog.Error("api", "method", r.Method, "route", route(r), "err", err)
			s.problems.add(fmt.Sprintf("server: %s %s: %v", r.Method, r.Pattern, err))
			ae = &apiError{http.StatusInternalServerError, "server", "Нещо се обърка при нас. Опитай пак."}
		}
		writeJSON(w, ae.status, map[string]string{"error": ae.code, "message": ae.message})
	})
}

// How many writes (any API request but a GET) may come in writesPer: from a browser's session, from a network, and
// from a site (address.go). Every write takes the database's one writer, so one client sending thousands a second
// would make everyone's slow (review 2026-11-18, S11). A player answers, taps and moves on at a few a second at
// most; a school's network has a few classes in rooms, fifty answers at once each; a site, a few such networks. The
// rest of the limits are per action; this is the floor under all of them.
const (
	writesPer     = 10 * time.Second
	writesSession = 100
	writesNet     = 600
	writesSite    = 2000
)

// mayWrite counts a write (a request that isn't a GET or a HEAD) against its session's, network's and site's rate
// (writesSession, writesNet, writesSite), and says whether it's within them. The session is kept by its token's hash,
// never the token itself: the counts are saved to a file over a restart.
func (s *Server) mayWrite(r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	if token := s.session(r); token != "" {
		key := account.SessionKey(token)
		if !s.limits.allow("write:session:"+base64.RawURLEncoding.EncodeToString(key[:12]), writesSession, writesPer) {
			return false
		}
	}
	return s.allowFrom(r, "write", writesNet, writesSite, writesPer)
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
	return s.accounts.Session(r.Context(), s.session(r))
}

// session is the token of the browser's session, as its cookie has it ("": none).
func (s *Server) session(r *http.Request) string {
	if c, err := r.Cookie(s.cookie); err == nil {
		return c.Value
	}
	return ""
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

// health says whether the game is up, for the monitors that poll it (README: Наблюдение) and for a deploy: its
// version, its bank, whether the database reads and takes writes; and, when its disk runs low or its mail isn't going
// out, so ("disk": "low", "mail": "failing": the mail that would tell of those may not get out). A server that can't
// write answers 503, so that a monitor that only looks at the status hears of it: one that reads still plays nothing
// (every answer is a write). The write is probed at most every probeEvery (a row in kv, through the one writer), and
// a failed one is a problem told.
func (s *Server) health(w http.ResponseWriter, r *http.Request) error {
	if err := s.db.Read.PingContext(r.Context()); err != nil {
		return err
	}
	writes, low := s.probeWrites(r.Context())
	out := map[string]any{"ok": writes, "version": s.cfg.Version, "bank": s.BankStatus(), "writes": writes}
	if low {
		out["disk"] = "low"
	}
	if s.outbox != nil && s.outbox.Failing() {
		out["mail"] = "failing"
	}
	if !writes {
		writeJSON(w, http.StatusServiceUnavailable, out)
		return nil
	}
	return ok(w, out)
}

// probeEvery is how long a write probe's answer holds: monitors poll every minute or so, and each probe is a write.
const probeEvery = 30 * time.Second

// probe is what the last write probe found (health).
type probe struct {
	mu     sync.Mutex
	at     time.Time
	writes bool
	low    bool
}

// probeWrites writes a row, if the last probe is older than probeEvery, and says whether the database took it, and
// whether its disk is low (store.DiskLow).
func (s *Server) probeWrites(ctx context.Context) (writes, low bool) {
	p := &s.probe
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	if now.Sub(p.at) < probeEvery {
		return p.writes, p.low
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second) // a probe, once begun, is finished
	defer cancel()
	_, err := s.db.Write.ExecContext(ctx, `INSERT INTO kv (key, value) VALUES ('health', ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, strconv.FormatInt(now.UnixMilli(), 10))
	p.at, p.writes = now, err == nil
	if err != nil {
		slog.Error("health: the database took no write", "err", err)
		s.problems.add("health: the database takes no writes (a full disk? journalctl: health)")
	}
	if s.cfg.DBPath != "" {
		p.low, _ = store.DiskLow(s.cfg.DBPath)
	}
	return p.writes, p.low
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) error {
	u, err := s.user(r)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"user": u})
}

// How many guests a network may start in an hour, and a site (an IPv6 /48; address.go).
const (
	guestsNet  = 2*room.MaxPlayers + 20
	guestsSite = 5 * guestsNet
)

// guest starts a player who has none: the first time they play.
func (s *Server) guest(w http.ResponseWriter, r *http.Request) error {
	if u, err := s.user(r); err != nil || u != nil {
		if err != nil {
			return err
		}
		return ok(w, map[string]any{"user": u})
	}
	// A school or a pub comes from one network (an IPv4 address, an IPv6 /64), and a mobile carrier puts many phones
	// behind one IPv4 address: two rooms' worth of new players an hour (room.MaxPlayers), and a site (an IPv6 /48: a
	// big school's, a company's; an IPv4 /24) five times that. A guest that never plays is cleared in a few days
	// (account.CleanUp).
	if !s.guardFrom(r, "guest", guestsNet, guestsSite, time.Hour) {
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

// How many codes may be asked for in an hour, from a network and from a site, and tried: a class saving its games at
// once, from its school's one address, and a carrier's address with many phones behind it, each asking again when the
// mail is slow (review 2026-11-18, S9), and a few tries each. What one network asks for can't flood anyone's inbox
// (account.CodesPerAddressHour) nor stop others' codes (account.SiteShare), so these only bound the mail a network
// makes the game send.
const (
	codesNet   = 60
	codesSite  = 5 * codesNet
	verifyNet  = 150
	verifySite = 5 * verifyNet
)

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
	if !s.guardFrom(r, "code", codesNet, codesSite, time.Hour) {
		return errTooMany
	}
	// The site's share of the minute's codes (account.CodesAMinute), and how many go to the address from anywhere
	// (account.CodesPerAddressHour), are counted in SendCode.
	asked, err := s.accounts.SendCode(r.Context(), email, s.asked(r), s.clientSite(r))
	if soon := (account.TooSoon{}); errors.As(err, &soon) {
		return &apiError{http.StatusTooManyRequests, "too_soon",
			fmt.Sprintf("Току-що ти пратихме код. Нов можеш да поискаш след %d с.", seconds(soon.Wait))}
	}
	if errors.Is(err, account.ErrCodesBusy) {
		s.problems.add("sign-in codes: a site past its share of the minute (account.SiteShare, CodesAMinuteMost); a flood?")
	}
	if err != nil {
		return err
	}
	// The code works only in this browser, which keeps its token for as long as the code lives.
	http.SetCookie(w, &http.Cookie{
		Name: s.askCookie, Value: asked.Token, Path: "/", MaxAge: int(account.CodeTTL / time.Second),
		HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteStrictMode,
	})
	// Another code may go after CodeEvery: the client counts it down. The field takes the code's digits.
	return ok(w, map[string]any{"sent": true, "again": seconds(account.CodeEvery), "digits": asked.Digits})
}

// asked is the token this browser kept from the last code it asked for ("": none).
func (s *Server) asked(r *http.Request) string {
	if c, err := r.Cookie(s.askCookie); err == nil {
		return c.Value
	}
	return ""
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
	if !s.guardFrom(r, "verify", verifyNet, verifySite, time.Hour) {
		return errTooMany
	}
	// Only by the browser the code is for (its ask cookie). Its session is replaced by a new one (account.Verify),
	// its notifications brought along.
	proof := account.Proof{Email: in.Email, Code: in.Code, Asked: s.asked(r)}
	u, token, err := s.accounts.Verify(r.Context(), proof, s.session(r))
	if wrong := (account.WrongCode{}); errors.As(err, &wrong) {
		return &apiError{http.StatusBadRequest, "bad_code", wrongCodeWords(wrong.Left)}
	}
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: s.askCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.secure,
		SameSite: http.SameSiteStrictMode})
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

// lookHandoff says whose game a handoff's token brings to this browser, and on how many days it was played
// (account.LookHandoff), or why it can't come here: asked by /hand/<token> as it opens, so that the player sees what
// the tap would bring (a link from someone else is theirs), and taking nothing.
func (s *Server) lookHandoff(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.allowFrom(r, "handlook", 60, 300, time.Hour) {
		return errTooMany
	}
	h, err := s.accounts.LookHandoff(r.Context(), in.Token, s.session(r))
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"game": h})
}

// takeHandoff brings the game of a handoff's token to this browser, in place of a guest with nothing yet, and takes
// it from the browser it came from (account.TakeHandoff): posted from /hand/<token> once the player taps to bring it.
func (s *Server) takeHandoff(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	// From a phone's browser: behind a carrier's address, many phones (codesNet).
	if !s.guardFrom(r, "hand", codesNet, codesSite, time.Hour) {
		return errTooMany
	}
	u, token, err := s.accounts.TakeHandoff(r.Context(), in.Token, s.session(r))
	if err != nil {
		return err
	}
	if token != "" {
		s.setSession(w, token)
	}
	return ok(w, map[string]any{"user": u})
}

// signOut ends this browser's session, and with it the notifications turned on here (account.SignOut): whatever the
// browser or the app did or didn't manage to say of them itself.
func (s *Server) signOut(w http.ResponseWriter, r *http.Request) error {
	if token := s.session(r); token != "" {
		if err := s.accounts.SignOut(r.Context(), token); err != nil {
			return err
		}
	}
	s.clearSession(w)
	return ok(w, map[string]any{"user": nil})
}

// signOutOthers ends the player's every other session, and the notifications of those browsers and phones: a phone
// lost, a computer left signed in. This browser stays signed in.
func (s *Server) signOutOthers(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.mustUser(r); err != nil {
		return err
	}
	n, err := s.accounts.SignOutOthers(r.Context(), s.session(r))
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"ended": n})
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
		!s.allowFrom(r, "rename-net", 200, 1000, time.Hour) {
		return errTooMany
	}
	// Each is checked only when it changes: a name or tag the player has (drawn, or taken before a check came in)
	// doesn't stop them saving the other.
	if in.Name != nil && strings.Join(strings.Fields(*in.Name), " ") != u.Name {
		if u.Name, err = s.accounts.Rename(r.Context(), u.ID, *in.Name); err != nil {
			return err
		}
	}
	if in.Tag != nil && strings.ToLower(strings.TrimPrefix(strings.TrimSpace(*in.Tag), "@")) != u.Tag {
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
