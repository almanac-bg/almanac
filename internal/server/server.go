// Package server is the game over HTTP: the API, the app's page and its files, and the pictures.
//
// It listens on the socket systemd hands it (deploy/almanac.socket), if it's given one, else on Config.Addr: with the
// socket, connections that come while the server restarts wait for the new one instead of being refused. Nothing the
// game plays lives in its memory alone (every game is in the database, answer by answer), so a restart cuts no play;
// the limits' counts are kept over it (Config.LimitsFile, limits.go), which count by network, from the player's own address even behind Cloudflare (address.go). A bank reloaded goes
// into play at once (bank.go). Every API answer names the version (api.go), so that a page loaded before
// a deploy loads itself anew at a quiet moment (web/src/fresh.ts).
//
// A panic in a request ends that request alone (middleware.go); one in the work done in the background (the sweeps, the loops the program starts) is stopped there by package safe, and told as a problem, mailed to whoever
// runs the game (problems.go).
package server

import (
	"context"
	"crypto/tls"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/assets"
	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/safe"
	"github.com/almanac-bg/almanac/internal/store"
)

// Config is how a server runs.
type Config struct {
	// Addr is where it listens (":8080"; ":443" with TLS).
	Addr string
	// PublicURL is the address players use (https://almanac.bg): links in mail, and whether cookies are Secure.
	PublicURL string
	// TLSCert and TLSKey, when set, make the server speak HTTPS itself (behind Cloudflare: its origin certificate).
	TLSCert, TLSKey string
	// TrustCloudflare takes the player's address from CF-Connecting-IP, on connections from Cloudflare's own
	// addresses (address.go).
	TrustCloudflare bool
	// MTASTS are the domain's mail servers, for its MTA-STS policy at mta-sts.<domain> (none: no policy), and
	// MTASTSMode the policy's mode ("testing" until reports are clean, then "enforce").
	MTASTS     []string
	MTASTSMode string
	// CrowdMin is how many answers a question needs before how players answered it shows (play.CrowdMin).
	CrowdMin int
	// Push sends notifications to browsers; nil: none.
	Push *push.Sender
	// Operator is who runs the game, and Contact their address (the privacy page, security.txt).
	Operator, Contact string
	// Alerts is where problems are told (TellProblems).
	Alerts Alerts
	// LimitsFile is where the limits' counts are kept as the server stops, for its next run to go on counting from
	// ("": nowhere; a restart then starts every count again).
	LimitsFile string
	// DBPath is the database's file, for /api/health to say when its disk runs low ("": not said).
	DBPath string
	// Dev serves the client from disk, as the build rewrites it.
	Dev     bool
	Version string
}

// Deps are what the server works with.
type Deps struct {
	DB       *store.DB
	Accounts *account.Accounts
	Outbox   *mail.Outbox
	Bank     *bank.Bank
}

// Server is the game's HTTP side.
type Server struct {
	cfg       Config
	db        *store.DB
	accounts  *account.Accounts
	outbox    *mail.Outbox
	game      *play.Game
	push      *push.Sender
	bank      atomic.Pointer[bank.Bank]
	banks     banks // a bank refused (bank.go)
	client    fs.FS
	limits    *limiter // the limits on floods (limits.go)
	cards     *cards   // the shared days' cards drawn (share.go)
	guard     *limiter // apart, the limits that keep players safe: codes, guests, reports
	problems  *problems
	reminders reminders // who is due the day's reminder when, today (remind.go)
	// heldOut says whether a player is held out of the reminders (play.HeldReminders: remind.go, streakmail.go).
	heldOut       func(userID int64) bool
	pushq         pushQueue     // the notifications' queue, as Push sends it (pushes.go)
	streakMailing streakMailing // who is due the mail of a streak ended when, today (streakmail.go)
	dayMailing    reminders     // who is due the day's reminder by mail when, today (daymail.go)
	// nearestStep is a player's nearest step in the book, for the reminders' last word (step.go); nil names none.
	nearestStep  func(ctx context.Context, userID int64) (Step, bool, error)
	secure       bool
	host         string
	cookie       string       // the session's
	askCookie    string       // the token of the browser a sign-in code is for (account.Asked)
	playedCookie string       // the day this browser last started the day's questions (playedHere: handoff.go)
	unlogged     atomic.Int64 // browsers' errors past clientErrorsAll not logged since the last one (problems.go)
	probe        probe        // whether the database takes writes, as /api/health last found (api.go)
	handler      http.Handler
}

func New(cfg Config, d Deps) (*Server, error) {
	u, err := url.Parse(cfg.PublicURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, errors.New("PUBLIC_URL must be like https://almanac.bg")
	}
	if _, ok := mtaSTSMaxAge[cfg.MTASTSMode]; cfg.MTASTSMode != "" && !ok {
		return nil, errors.New("MTA_STS_MODE must be testing, enforce or none")
	}
	if cfg.Operator == "" {
		cfg.Operator = "екипа на АЛМАНАХ" // "Играта се поддържа от …"
	}
	if cfg.Contact == "" {
		cfg.Contact = "privacy@almanac.bg"
	}
	s := &Server{
		cfg: cfg, db: d.DB, accounts: d.Accounts, outbox: d.Outbox,
		client: assets.FS(cfg.Dev),
		limits: newLimiter(), guard: newLimiterOf(limitKeys / 2), problems: newProblems(), cards: newCards(),
		secure: u.Scheme == "https",
		host:   strings.ToLower(u.Hostname()),
	}
	// A __Host- cookie is bound to this exact host, over HTTPS, for the whole site: nothing else can set or read it.
	s.cookie, s.askCookie, s.playedCookie = "sid", "ask", "played"
	if s.secure {
		s.cookie, s.askCookie, s.playedCookie = "__Host-sid", "__Host-ask", "__Host-played"
	}
	s.limits.off, s.guard.off = cfg.Dev, cfg.Dev
	// A key pushed out of a full limiter means a flood of keys: the counts pushed out start again (limits.go).
	s.limits.onFull = func() { s.problems.add("limits: a flood of keys filled the limiter; counts were pushed out") }
	s.guard.onFull = func() { s.problems.add("limits: a flood of keys filled the guard's limiter; counts were pushed out") }
	s.bank.Store(d.Bank)
	s.game = play.New(d.DB, s.bank.Load)
	s.heldOut = func(id int64) bool { return play.HeldOut(play.HeldReminders, id) }
	s.nearestStep = s.stepOf
	if strings.HasPrefix(cfg.Version, "v") { // a release, not a developer's build
		s.game.Version = cfg.Version
		if err := s.released(context.Background()); err != nil {
			return nil, err
		}
	}
	if err := s.game.Keep(context.Background(), d.Bank); err != nil { // its versions, before anything is shown
		return nil, err
	}
	// Every panic stopped in the work done in the background (package safe), anywhere in the program, is told as
	// one of this server's problems: there is one server in the program.
	safe.Tell(s.problems.add)
	s.game.CrowdMin = cfg.CrowdMin
	s.push = cfg.Push
	s.game.DuelNews = s.duelNews
	d.Accounts.Merge = append(d.Accounts.Merge, s.game.Merge)
	d.Accounts.Forget = append(d.Accounts.Forget, play.Forget)
	s.handler = s.routes()
	return s, nil
}

// Count makes the game's first counts over every answer (play.Game.Count): how players answered each question and how
// hard each is; so that the first players after a start don't wait on them (later counts
// run by themselves, in the background, as they fall due).
func (s *Server) Count(ctx context.Context) error { return s.game.Count(ctx) }

// JudgeRuns judges the games a migration left for the bank to judge (play.JudgeRuns): which were played at a script's
// speed. Run as the server starts, before it serves; it says how many it marked.
func (s *Server) JudgeRuns(ctx context.Context) (int, error) { return s.game.JudgeRuns(ctx) }

// RanksDue counts the ranks a migration left to count (play.RanksDue): of the players with ink from before ranks.
func (s *Server) RanksDue(ctx context.Context) (int, error) { return s.game.RanksDue(ctx) }

// KeepDays draws the day's questions ahead, in transactions of their own (play.Game.KeepDays), until ctx ends.
func (s *Server) KeepDays(ctx context.Context) { s.game.KeepDays(ctx) }

func (s *Server) Handler() http.Handler { return s.handler }

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	api := func(pattern string, h func(http.ResponseWriter, *http.Request) error) {
		mux.Handle(pattern, s.apiHandler(h))
	}
	api("GET /api/health", s.health)
	api("GET /api/me", s.me)
	api("GET /api/mail-who", s.mailWho)
	api("PATCH /api/me", s.rename)
	api("DELETE /api/me", s.deleteAccount)
	api("GET /api/me/stats", s.stats)
	api("POST /api/me/news", s.news)
	api("POST /api/me/streak-told", s.streakTold)
	api("PATCH /api/me/look", s.setLook)
	api("PATCH /api/me/seal", s.setSeal)
	api("POST /api/me/used", s.used)
	api("POST /api/push", s.subscribe)
	api("DELETE /api/push", s.unsubscribe)
	api("GET /api/push/prefs", s.pushPrefs)
	api("PATCH /api/push/prefs", s.setPushPref)
	api("GET /api/mail/prefs", s.mailPrefs)
	api("PATCH /api/mail/prefs", s.setMailPrefs)
	api("POST /api/errors", s.clientError)
	api("POST /api/guest", s.guest)
	api("POST /api/tally", s.tally)
	api("POST /api/auth/code", s.sendCode)
	api("POST /api/auth/verify", s.verify)
	api("POST /api/auth/signout", s.signOut)
	api("POST /api/auth/signout-others", s.signOutOthers)
	api("POST /api/auth/handoff", s.handoff)
	api("POST /api/auth/handoff/copied", s.copiedHandoff)
	api("POST /api/auth/hand", s.takeHandoff)
	api("POST /api/auth/hand/look", s.lookHandoff)
	api("GET /api/day", s.today)
	api("POST /api/day", s.startDay)
	api("POST /api/topic", s.startTopic)
	api("GET /api/runs/left", s.left)
	api("GET /api/runs/{id}", s.runState)
	api("POST /api/runs/{id}/show", s.show)
	api("POST /api/runs/{id}/start", s.start)
	api("POST /api/runs/{id}/answer", s.answer)
	api("GET /api/runs/{id}/review", s.review)
	api("POST /api/runs/{id}/share", s.share)
	api("POST /api/questions/{id}/report", s.report)
	api("GET /api/duels", s.duels)
	api("POST /api/duels", s.newDuel)
	api("GET /api/duels/recording", s.recordingReady)
	api("GET /api/duels/{id}", s.duelOne)
	api("POST /api/duels/{id}/play", s.playDuel)
	api("GET /api/players/{tag}", s.profile)
	api("GET /api/almanac", s.almanac)
	api("GET /api/friends", s.friends)
	api("GET /api/friends/requests", s.requestsWaiting)
	api("POST /api/friends/requests", s.requestFriend)
	api("POST /api/friends/requests/{id}/accept", s.answerRequest(true))
	api("DELETE /api/friends/requests/{id}", s.answerRequest(false))
	api("DELETE /api/friends/{id}", s.unfriend)
	api("POST /api/told", s.told)
	mux.Handle("/api/", s.apiHandler(func(http.ResponseWriter, *http.Request) error { return errNotFound }))

	mux.HandleFunc("GET /qimg/{file}", s.picture)
	mux.HandleFunc("GET /card/{file}", s.card)
	mux.HandleFunc("GET /og.png", s.sitePicture)
	mux.HandleFunc("GET /assets/{file...}", s.asset)
	for _, f := range publicFiles {
		mux.HandleFunc("GET /"+f, s.publicFile)
	}
	mux.HandleFunc("GET /robots.txt", s.robots)
	mux.HandleFunc("GET /sitemap.xml", s.sitemap)
	mux.HandleFunc("GET /privacy", s.privacy)
	mux.HandleFunc("GET /mail/off", s.mailOff)
	mux.HandleFunc("POST /mail/off", s.mailOff)
	mux.HandleFunc("GET /admin", s.admin)
	mux.HandleFunc("GET /admin/questions", s.adminQuestions)
	mux.HandleFunc("POST /admin/reports/{id}/resolve", s.resolve)
	mux.HandleFunc("POST /admin/players/{id}/reports/resolve", s.resolvePlayer)
	mux.HandleFunc("POST /admin/players/{id}/{act}", s.adminPlayerAct)
	mux.HandleFunc("GET /.well-known/security.txt", s.securityTxt)
	mux.HandleFunc("/", s.page)

	var h http.Handler = mux
	h = http.NewCrossOriginProtection().Handler(h)
	h = s.headers(h)
	h = s.hosts(h)
	h = s.logged(h)
	h = s.recovered(h)
	// Outside the rest: the request it hands on is a copy, and they read the route the mux sets on theirs.
	return withWriter(h)
}

// Run serves until ctx ends, then stops taking requests, gives those under way up to grace to finish, and keeps the
// limits' counts for the next run.
func (s *Server) Run(ctx context.Context, grace time.Duration) error {
	srv := &http.Server{
		Addr:              s.cfg.Addr,
		Handler:           s.handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    32 << 10,
		ErrorLog:          slog.NewLogLogger(slog.Default().Handler(), slog.LevelWarn),
	}
	ln, err := listen(s.cfg.Addr)
	if err != nil {
		return err
	}
	if s.cfg.TLSCert != "" {
		cert, err := tls.LoadX509KeyPair(s.cfg.TLSCert, s.cfg.TLSKey)
		if err != nil {
			ln.Close()
			return err
		}
		ln = tls.NewListener(ln, &tls.Config{
			MinVersion:   tls.VersionTLS12,
			Certificates: []tls.Certificate{cert},
			NextProtos:   []string{"h2", "http/1.1"},
		})
	}
	slog.Info("serving", "addr", ln.Addr().String(), "url", s.cfg.PublicURL, "version", s.cfg.Version, "tls", s.cfg.TLSCert != "")
	s.restoreLimits()
	errs := make(chan error, 1)
	go func() { errs <- srv.Serve(ln) }() // a handler's panic is its request's alone (recovered)
	// The work done in the background: each round on its own, a panic in one stopped and told (package safe).
	go safe.Every(ctx, "duels: settling", time.Minute, func() {
		if err := s.game.SettleDue(ctx); err != nil && ctx.Err() == nil {
			slog.Error("duels", "err", err)
		}
	})
	go safe.Every(ctx, "fair play: the day's networks", 5*time.Minute, func() {
		n, err := s.game.JudgeNets(ctx)
		if err != nil && ctx.Err() == nil {
			slog.Error("fair play", "err", err)
		}
		if n > 0 {
			s.problems.add("fair play: a day's ten played after several throwaway guests from the same network (/admin)")
		}
	})
	go safe.Every(ctx, "measures: the weeks over", 15*time.Minute, func() {
		if err := s.freezeWeeks(ctx); err != nil && ctx.Err() == nil {
			slog.Error("measures", "err", err)
		}
	})
	go safe.Every(ctx, "after the runs", time.Minute, func() {
		if err := s.game.AfterDue(ctx); err != nil && ctx.Err() == nil {
			slog.Error("after the runs", "err", err)
		}
	})
	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	err = srv.Shutdown(shutdown)
	s.saveLimits()
	// What follows the runs the last requests finished, in the background: given the rest of the grace (one cut off is
	// the sweep's after the restart).
	s.game.AftersDone(shutdown)
	return err
}

// isAsset says whether a path is a static file (left out of the request log).
func isAsset(path string) bool {
	return strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/qimg/") || path == "/favicon.svg"
}
