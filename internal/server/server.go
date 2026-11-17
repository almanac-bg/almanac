// Package server is the game over HTTP: the API, the app's page and its files, and the pictures.
//
// It listens on the socket systemd hands it (deploy/almanac.socket), if it's given one, else on Config.Addr: with the
// socket, connections that come while the server restarts wait for the new one instead of being refused. Before a
// restart, a deploy drains the server (drain.go), so that the restart cuts no live duel nor a room's game; the rooms
// themselves are kept over it (Config.RoomsFile).
package server

import (
	"context"
	"crypto/tls"
	"errors"
	"io/fs"
	"log/slog"
	"net"
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
	// TrustCloudflare takes the player's address from CF-Connecting-IP. Only when nothing but Cloudflare can reach the
	// server, or anyone could claim any address.
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
	// RoomsFile is where the rooms open as the server stops are kept, for its next run to open again ("": nowhere).
	RoomsFile string
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
	client        fs.FS
	limits        *limiter
	problems      *problems
	reminders     reminders     // who is due the day's reminder when, today (remind.go)
	streakMailing streakMailing // who is due the mail of a streak ended when, today (streakmail.go)
	secure        bool
	host          string
	cookie        string
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
		limits: newLimiter(), problems: newProblems(),
		secure: u.Scheme == "https",
		host:   strings.ToLower(u.Hostname()),
	}
	// A __Host- cookie is bound to this exact host, over HTTPS, for the whole site: nothing else can set or read it.
	s.cookie = "sid"
	if s.secure {
		s.cookie = "__Host-sid"
	}
	s.limits.off = cfg.Dev
	s.bank.Store(d.Bank)
	s.game = play.New(d.DB, s.bank.Load)
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

// SetBank swaps in a new bank (a reload): new plays use it, plays under way keep theirs.
func (s *Server) SetBank(b *bank.Bank) { s.bank.Store(b) }

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
	api("POST /api/auth/handoff", s.handoff)
	api("POST /api/auth/hand", s.takeHandoff)
	api("GET /api/day", s.today)
	api("POST /api/day", s.startDay)
	api("GET /api/day/{day}/board", s.board)
	api("POST /api/topic", s.startTopic)
	api("GET /api/mistakes", s.mistakes)
	api("POST /api/mistakes", s.startMistakes)
	api("GET /api/runs/{id}", s.runState)
	api("POST /api/runs/{id}/show", s.show)
	api("POST /api/runs/{id}/start", s.start)
	api("POST /api/runs/{id}/answer", s.answer)
	api("GET /api/runs/{id}/review", s.review)
	api("POST /api/questions/{id}/report", s.report)
	api("POST /api/rooms", s.openRoom)
	mux.HandleFunc("GET /api/rooms/{code}/events", s.roomEvents)
	api("POST /api/rooms/{code}/start", s.roomLead((*room.Room).Start))
	api("POST /api/rooms/{code}/next", s.roomLead((*room.Room).Next))
	api("POST /api/rooms/{code}/finish", s.roomLead((*room.Room).Finish))
	api("POST /api/rooms/{code}/hold", s.roomHold)
	mux.HandleFunc("GET /api/rooms/{code}/qr", s.roomQR)
	api("POST /api/rooms/{code}/answer", s.roomAnswer)
	api("POST /api/rooms/{code}/remove", s.roomRemove)
	api("GET /api/rooms/{code}/people", s.roomPeople)
	api("POST /api/rooms/{code}/people", s.roomBefriend)
	api("POST /api/duels", s.challenge)
	api("GET /api/duels", s.duels)
	api("GET /api/duels/{id}", s.duelOne)
	mux.HandleFunc("GET /api/duels/live/events", s.liveEvents)
	api("POST /api/duels/live/{id}/answer", s.liveAnswer)
	api("POST /api/duels/{id}/play", s.playDuel)
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
// rooms open for the next run.
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
	// Роял's games under way before a restart go on.
	if err := s.royal.Load(ctx); err != nil {
		ln.Close()
		return err
	}
	errs := make(chan error, 1)
	go func() { errs <- srv.Serve(ln) }()
	go func() {
		t := time.NewTicker(200 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.royal.Step(ctx)
			}
		}
	}()
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.drainStep(nil) // a drain whose deploy stopped asking ends; Роял coming stops one
			}
		}
	}()
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.rooms.Sweep()
				s.live.Sweep()
				if err := s.game.SettleDue(ctx); err != nil {
					slog.Error("duels", "err", err)
				}
			}
		}
	}()
	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	err = srv.Shutdown(shutdown)
	s.saveRooms()
	return err
}

// clientIP is the player's address, for rate limits and the log.
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustCloudflare {
		if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// isAsset says whether a path is a static file (left out of the request log).
func isAsset(path string) bool {
	if strings.HasSuffix(path, "/events") || path == "/api/drain" { // a stream, logged when it ends; a deploy waiting
		return true
	}
	return strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/qimg/") || path == "/favicon.svg"
}
