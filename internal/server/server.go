// Package server is the game over HTTP: the API, the app's page and its files, and the pictures.
//
// It listens on the socket systemd hands it (deploy/almanac.socket), if it's given one, else on Config.Addr: with the
// socket, connections that come while the server restarts wait for the new one instead of being refused. Before a
// restart, a deploy drains the server (drain.go), so that the restart cuts no live duel nor a room's game; the rooms
// themselves are kept over it (Config.RoomsFile), and so are the limits' counts (Config.LimitsFile, limits.go), which
// count by network, from the player's own address even behind Cloudflare (address.go). A bank reloaded while Роял is
// on waits for the evening to end (bank.go). Every API answer names the version (api.go), so that a page loaded before
// a deploy loads itself anew at a quiet moment (web/src/fresh.ts); the app on phones opens only the game's own pages
// (applinks.go).
//
// A panic in a request ends that request alone (middleware.go); one in the work done in the background (Роял's clock,
// the sweeps, the loops the program starts) is stopped there by package safe, and told as a problem, mailed to whoever
// runs the game (problems.go). A run that ends some other way (a crash, a kill, the machine) is told of by the next
// (running.go).
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
	"github.com/almanac-bg/almanac/internal/live"
	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/room"
	"github.com/almanac-bg/almanac/internal/royal"
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
	// Royal is when Роял's evenings are (royal.Evening when unset).
	Royal royal.Schedule
	// MistakesAfter is how long a missed question waits for its second chance (play.MistakesAfter when unset).
	MistakesAfter time.Duration
	// CrowdMin is how many answers a question needs before how players answered it shows (play.CrowdMin).
	CrowdMin int
	// Push sends notifications to browsers; nil: none.
	Push *push.Sender
	// Phones sends notifications to the game's app on phones; nil: none.
	Phones *push.Phones
	// Operator is who runs the game, and Contact their address (the privacy page, security.txt).
	Operator, Contact string
	// RoomsFile is where the rooms open are kept, every few seconds and as the server stops, for its next run to open
	// again ("": nowhere).
	RoomsFile string
	// RunningFile is where the server notes that it runs, to tell at its next start whether it stopped cleanly
	// (running.go; "": nowhere).
	RunningFile string
	// LimitsFile is where the limits' counts are kept as the server stops, for its next run to go on counting from
	// ("": nowhere; a restart then starts every count again).
	LimitsFile string
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
	cfg      Config
	db       *store.DB
	accounts *account.Accounts
	outbox   *mail.Outbox
	game     *play.Game
	rooms    *room.Hub
	live     *live.Hub
	royal    *royal.Hub
	push     *push.Sender
	phones   *push.Phones
	// closing ends the streams (rooms, Роял) when the server stops, so that it needn't wait for them.
	closing       chan struct{}
	drain         drain
	bank          atomic.Pointer[bank.Bank]
	banks         banks // a bank held for Роял, one refused (bank.go)
	client        fs.FS
	limits        *limiter // the limits on floods (limits.go)
	guard         *limiter // apart, the limits that keep players safe: codes, guests, room codes, reports
	problems      *problems
	roomsSaved    roomsSaved
	reminders     reminders     // who is due the day's reminder when, today (remind.go)
	pushq         pushQueue     // the notifications' queue, as Push sends it (pushes.go)
	streakMailing streakMailing // who is due the mail of a streak ended when, today (streakmail.go)
	secure        bool
	host          string
	cookie        string       // the session's
	askCookie     string       // the token of the browser a sign-in code is for (account.Asked)
	unlogged      atomic.Int64 // browsers' errors past clientErrorsAll not logged since the last one (problems.go)
	handler       http.Handler
}

func New(cfg Config, d Deps) (*Server, error) {
	u, err := url.Parse(cfg.PublicURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, errors.New("PUBLIC_URL must be like https://almanac.bg")
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
		limits: newLimiter(), guard: newLimiterOf(limitKeys / 2), problems: newProblems(),
		secure: u.Scheme == "https",
		host:   strings.ToLower(u.Hostname()),
	}
	// A __Host- cookie is bound to this exact host, over HTTPS, for the whole site: nothing else can set or read it.
	s.cookie, s.askCookie = "sid", "ask"
	if s.secure {
		s.cookie, s.askCookie = "__Host-sid", "__Host-ask"
	}
	s.limits.off, s.guard.off = cfg.Dev, cfg.Dev
	// A key pushed out of a full limiter means a flood of keys: the counts pushed out start again (limits.go).
	s.limits.onFull = func() { s.problems.add("limits: a flood of keys filled the limiter; counts were pushed out") }
	s.guard.onFull = func() { s.problems.add("limits: a flood of keys filled the guard's limiter; counts were pushed out") }
	s.bank.Store(d.Bank)
	s.game = play.New(d.DB, s.bank.Load)
	if err := s.game.Keep(context.Background(), d.Bank); err != nil { // its versions, before anything is shown
		return nil, err
	}
	// Every panic stopped in the work done in the background (package safe), anywhere in the program, is told as
	// one of this server's problems: there is one server in the program.
	safe.Tell(s.problems.add)
	s.game.DuelNews = s.duelNews
	s.game.RoyalNews = s.royalNews
	s.game.LeagueNews = s.leagueNews
	s.game.MistakesAfter = cfg.MistakesAfter
	s.game.CrowdMin = cfg.CrowdMin
	if cfg.Royal.Every == 0 && cfg.Royal.Hour == 0 {
		cfg.Royal = royal.Evening
	}
	if cfg.Royal.Every == 0 && cfg.Royal.On == nil {
		cfg.Royal.On = s.game.RoyalOn // Friday to Sunday, until the evenings fill
	}
	s.game.RoyalAt = cfg.Royal.Next
	s.royal = royal.NewHub(s.game, cfg.Royal)
	s.royal.News = s.royalNews
	s.royal.Opened = func(ctx context.Context, start time.Time) { s.callRoyal(ctx, start) }
	s.royal.Soon = func(ctx context.Context, start time.Time, away, in []int64) { s.callSoon(ctx, start, away, in) }
	s.push = cfg.Push
	s.phones = cfg.Phones
	s.rooms = room.NewHub(s.bank.Load)
	s.rooms.Crowd = s.game.Crowd
	s.rooms.Barred = s.game.DayQuestions
	s.rooms.Record = s.game.RecordRoom
	s.live = live.NewHub(s.game, s.livePlayer)
	s.closing = make(chan struct{})
	d.Accounts.Merge = append(d.Accounts.Merge, play.Merge)
	d.Accounts.Forget = append(d.Accounts.Forget, play.Forget)
	s.handler = s.routes()
	return s, nil
}

// Count makes the game's first counts over every answer (play.Game.Count): how players answered each question, how
// hard each is, the boards of knowledge; so that the first players after a start don't wait on them (later counts
// run by themselves, in the background, as they fall due).
func (s *Server) Count(ctx context.Context) error { return s.game.Count(ctx) }

// JudgeRuns judges the games a migration left for the bank to judge (play.JudgeRuns): which were played at a script's
// speed. Run as the server starts, before it serves; it says how many it marked.
func (s *Server) JudgeRuns(ctx context.Context) (int, error) { return s.game.JudgeRuns(ctx) }

// KeepDays draws the day's questions ahead, in transactions of their own (play.Game.KeepDays), until ctx ends.
func (s *Server) KeepDays(ctx context.Context) { s.game.KeepDays(ctx) }

func (s *Server) Handler() http.Handler { return s.handler }

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	api := func(pattern string, h func(http.ResponseWriter, *http.Request) error) {
		mux.Handle(pattern, s.apiHandler(h))
	}
	api("GET /api/health", s.health)
	api("POST /api/drain", s.drainHandler)
	api("DELETE /api/drain", s.drainHandler)
	api("GET /api/me", s.me)
	api("PATCH /api/me", s.rename)
	api("DELETE /api/me", s.deleteAccount)
	api("GET /api/me/stats", s.stats)
	api("GET /api/me/progress", s.progress)
	api("POST /api/me/news", s.news)
	api("POST /api/me/streak-told", s.streakTold)
	api("PATCH /api/me/look", s.setLook)
	api("POST /api/push", s.subscribe)
	api("DELETE /api/push", s.unsubscribe)
	api("POST /api/push/phone", s.addPhone)
	api("DELETE /api/push/phone", s.removePhone)
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
	api("POST /api/auth/hand", s.takeHandoff)
	api("GET /api/day", s.today)
	api("POST /api/day", s.startDay)
	api("GET /api/day/{day}/board", s.board)
	api("POST /api/topic", s.startTopic)
	api("GET /api/mistakes", s.mistakes)
	api("POST /api/mistakes", s.startMistakes)
	api("GET /api/runs/left", s.left)
	api("GET /api/playing", s.playingNow)
	api("GET /api/runs/{id}", s.runState)
	api("POST /api/runs/{id}/show", s.show)
	api("POST /api/runs/{id}/start", s.start)
	api("POST /api/runs/{id}/answer", s.answer)
	api("GET /api/runs/{id}/review", s.review)
	api("POST /api/questions/{id}/report", s.report)
	api("POST /api/rooms", s.openRoom)
	api("GET /api/rooms/{code}", s.roomOpen)
	api("POST /api/rooms/{code}/join", s.roomJoin)
	api("POST /api/rooms/{code}/settings", s.roomSettings)
	mux.HandleFunc("GET /api/rooms/{code}/events", s.roomEvents)
	api("POST /api/rooms/{code}/start", s.roomAct((*room.Room).Start))
	api("POST /api/rooms/{code}/next", s.roomAct((*room.Room).Next))
	api("POST /api/rooms/{code}/finish", s.roomAct((*room.Room).Finish))
	api("POST /api/rooms/{code}/hold", s.roomHold)
	api("POST /api/rooms/{code}/lock", s.roomLock)
	mux.HandleFunc("GET /api/rooms/{code}/qr", s.roomQR)
	api("POST /api/rooms/{code}/answer", s.roomAnswer)
	api("POST /api/rooms/{code}/remove", s.roomRemove)
	api("GET /api/rooms/{code}/people", s.roomPeople)
	api("POST /api/rooms/{code}/people", s.roomBefriend)
	api("GET /api/duels", s.duels)
	api("GET /api/duels/{id}", s.duelOne)
	mux.HandleFunc("GET /api/duels/live/events", s.liveEvents)
	api("POST /api/duels/live/{id}/answer", s.liveAnswer)
	api("POST /api/duels/live/{id}/leave", s.liveLeave)
	api("DELETE /api/duels/{id}", s.declineDuel)
	api("GET /api/ranks", s.ranks)
	api("GET /api/players/{tag}", s.profile)
	mux.HandleFunc("GET /api/royal/events", s.royalEvents)
	api("POST /api/royal", s.joinRoyal)
	api("DELETE /api/royal", s.leaveRoyal)
	api("POST /api/royal/answer", s.royalAnswer)
	api("GET /api/royal", s.royals)
	api("GET /api/royal/tonight", s.tonight)
	api("POST /api/royal/plan", s.planRoyal)
	api("DELETE /api/royal/plan", s.planRoyal)
	api("GET /api/almanac", s.almanac)
	api("GET /api/league", s.league)
	api("GET /api/year/{year}", s.year)
	api("GET /api/goals", s.goals)
	api("GET /api/friends", s.friends)
	api("GET /api/friends/invites", s.duelInvites)
	api("POST /api/friends/requests", s.requestFriend)
	api("POST /api/friends/requests/{id}/accept", s.answerRequest(true))
	api("DELETE /api/friends/requests/{id}", s.answerRequest(false))
	api("DELETE /api/friends/{id}", s.unfriend)
	api("POST /api/told", s.told)
	api("POST /api/challenges", s.challengeLink)
	api("POST /api/friends/{id}/challenge", s.challengeFriend)
	api("GET /api/challenges/{code}", s.challengeView)
	api("POST /api/challenges/{code}/play", s.takeChallenge)
	api("GET /api/invites/{code}", s.inviteInfo)
	api("POST /api/invites/{code}", s.acceptInvite)
	mux.Handle("/api/", s.apiHandler(func(http.ResponseWriter, *http.Request) error { return errNotFound }))

	mux.HandleFunc("GET /qimg/{file}", s.picture)
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
	mux.HandleFunc("POST /admin/reports/{id}/resolve", s.resolve)
	mux.HandleFunc("POST /admin/players/{id}/reports/resolve", s.resolvePlayer)
	mux.HandleFunc("GET /.well-known/security.txt", s.securityTxt)
	mux.HandleFunc("GET /.well-known/apple-app-site-association", s.appleAppSiteAssociation)
	mux.HandleFunc("GET /.well-known/assetlinks.json", s.assetLinks)
	mux.HandleFunc("/", s.page)

	var h http.Handler = mux
	h = http.NewCrossOriginProtection().Handler(h)
	h = s.headers(h)
	h = s.hosts(h)
	h = s.logged(h)
	return s.recovered(h)
}

// Run serves until ctx ends, then stops taking requests, gives those under way up to grace to finish, and keeps the
// rooms open for the next run. A run that ends otherwise is told of by the next (running.go).
func (s *Server) Run(ctx context.Context, grace time.Duration) error {
	s.noteRunning()
	err := s.run(ctx, grace)
	s.noteStopped() // not reached past a panic: the next run tells of it
	return err
}

// How often the work done in the background comes round.
const (
	// stepEvery moves Роял's clock on.
	stepEvery = 200 * time.Millisecond
	// roomsEvery saves the rooms, if they've changed: what a crash may lose of them.
	roomsEvery = 15 * time.Second
)

func (s *Server) run(ctx context.Context, grace time.Duration) error {
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
	// Live duels are played in memory: those the last run of the server left under way are over, without a result.
	if err := s.game.EndLive(ctx); err != nil {
		ln.Close()
		return err
	}
	slog.Info("serving", "addr", ln.Addr().String(), "url", s.cfg.PublicURL, "version", s.cfg.Version, "tls", s.cfg.TLSCert != "")
	srv.RegisterOnShutdown(func() {
		// Nothing new starts while the server stops; the streams end (the screens find the next server by themselves).
		s.live.Pause()
		s.rooms.Pause()
		close(s.closing)
	})
	s.restoreRooms()
	s.restoreLimits()
	// Роял's games under way before a restart go on. Should loading them panic, the site is served all the same, and
	// the problem told: a state that panics as it's read would otherwise stop every start, and the whole game with it.
	if !safe.Do("royal: loading the evening", func() { err = s.royal.Load(ctx) }) {
		err = nil
	}
	if err != nil {
		ln.Close()
		return err
	}
	errs := make(chan error, 1)
	go func() { errs <- srv.Serve(ln) }() // a handler's panic is its request's alone (recovered)
	// The work done in the background: each round on its own, a panic in one stopped and told (package safe).
	go safe.Every(ctx, "royal: the clock", stepEvery, func() { s.royal.Step(ctx) })
	go safe.Every(ctx, "the drain and the bank", time.Second, func() {
		s.drainStep(nil) // a drain whose deploy stopped asking ends; Роял coming stops one
		s.bankStep()     // a bank held for Роял goes in as it ends
	})
	go safe.Every(ctx, "rooms: saving", roomsEvery, s.saveRoomsChanged)
	go safe.Every(ctx, "rooms: sweeping", time.Minute, s.rooms.Sweep)
	go safe.Every(ctx, "live: sweeping", time.Minute, s.live.Sweep)
	go safe.Every(ctx, "duels: settling", time.Minute, func() {
		if err := s.game.SettleDue(ctx); err != nil && ctx.Err() == nil {
			slog.Error("duels", "err", err)
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
	s.saveRooms()
	s.saveLimits()
	return err
}

// isAsset says whether a path is a static file (left out of the request log).
func isAsset(path string) bool {
	if strings.HasSuffix(path, "/events") || path == "/api/drain" { // a stream, logged when it ends; a deploy waiting
		return true
	}
	return strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/qimg/") || path == "/favicon.svg"
}
