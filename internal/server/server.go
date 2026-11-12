// Package server is the game over HTTP: the API, the app's page and its files, and the pictures.
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
	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/room"
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
	// Push sends notifications; nil: none.
	Push *push.Sender
	// Operator is who runs the game, and Contact their address (the privacy page, security.txt).
	Operator, Contact string
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
	push     *push.Sender
	// closing ends the streams (rooms) when the server stops, so that it needn't wait for them.
	closing chan struct{}
	// duelWait is how long a duel search waits for someone else (DuelWait; tests make it short).
	duelWait time.Duration
	bank     atomic.Pointer[bank.Bank]
	client   fs.FS
	limits   *limiter
	problems *problems
	secure   bool
	host     string
	cookie   string
	handler  http.Handler
}

func New(cfg Config, d Deps) (*Server, error) {
	u, err := url.Parse(cfg.PublicURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, errors.New("PUBLIC_URL must be like https://almanac.bg")
	}
	if cfg.Operator == "" {
		cfg.Operator = "екипът на АЛМАНАХ"
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
	s.push = cfg.Push
	s.game.Finished = s.challengeDone
	s.rooms = room.NewHub(s.bank.Load)
	s.rooms.Recording = s.game.RecordingFor
	s.rooms.Kept = func(d play.Duel) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := s.game.SaveDuel(ctx, d); err != nil {
			slog.Error("keeping a duel", "err", err)
			s.problems.add("keeping a duel: " + err.Error())
		}
	}
	s.closing = make(chan struct{})
	s.duelWait = DuelWait
	d.Accounts.Merge = append(d.Accounts.Merge, play.Merge)
	s.handler = s.routes()
	return s, nil
}

// SetBank swaps in a new bank (a reload): new plays use it, plays under way keep theirs.
func (s *Server) SetBank(b *bank.Bank) { s.bank.Store(b) }

func (s *Server) Handler() http.Handler { return s.handler }

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	api := func(pattern string, h func(http.ResponseWriter, *http.Request) error) {
		mux.Handle(pattern, s.apiHandler(h))
	}
	api("GET /api/health", s.health)
	api("GET /api/me", s.me)
	api("PATCH /api/me", s.rename)
	api("DELETE /api/me", s.deleteAccount)
	api("GET /api/me/stats", s.stats)
	api("POST /api/push", s.subscribe)
	api("DELETE /api/push", s.unsubscribe)
	api("POST /api/errors", s.clientError)
	api("POST /api/guest", s.guest)
	api("POST /api/auth/code", s.sendCode)
	api("POST /api/auth/verify", s.verify)
	api("POST /api/auth/signout", s.signOut)
	api("GET /api/day", s.today)
	api("POST /api/day", s.startDay)
	api("GET /api/day/{day}/board", s.board)
	api("POST /api/topic", s.startTopic)
	api("GET /api/runs/{id}", s.runState)
	api("POST /api/runs/{id}/show", s.show)
	api("POST /api/runs/{id}/answer", s.answer)
	api("GET /api/runs/{id}/review", s.review)
	api("POST /api/runs/{id}/challenge", s.challenge)
	api("GET /api/challenges/{code}", s.challengeInfo)
	api("POST /api/challenges/{code}", s.startChallenge)
	api("POST /api/questions/{id}/report", s.report)
	api("POST /api/rooms", s.openRoom)
	api("POST /api/duel", s.duel)
	mux.HandleFunc("GET /api/rooms/{code}/events", s.roomEvents)
	api("POST /api/rooms/{code}/start", s.roomStart)
	api("POST /api/rooms/{code}/next", s.roomNext)
	api("POST /api/rooms/{code}/answer", s.roomAnswer)
	api("POST /api/rooms/{code}/decline", s.roomDecline)
	api("GET /api/friends", s.friends)
	api("GET /api/friends/invites", s.duelInvites)
	api("DELETE /api/friends/{id}", s.unfriend)
	api("POST /api/friends/{id}/duel", s.duelFriend)
	api("GET /api/invites/{code}", s.inviteInfo)
	api("POST /api/invites/{code}", s.acceptInvite)
	mux.Handle("/api/", s.apiHandler(func(http.ResponseWriter, *http.Request) error { return errNotFound }))

	mux.HandleFunc("GET /qimg/{file}", s.picture)
	mux.HandleFunc("GET /assets/{file...}", s.asset)
	for _, f := range publicFiles {
		mux.HandleFunc("GET /"+f, s.publicFile)
	}
	mux.HandleFunc("GET /privacy", s.privacy)
	mux.HandleFunc("GET /admin", s.admin)
	mux.HandleFunc("POST /admin/reports/{id}/resolve", s.resolve)
	mux.HandleFunc("GET /.well-known/security.txt", s.securityTxt)
	mux.HandleFunc("/", s.page)

	var h http.Handler = mux
	h = http.NewCrossOriginProtection().Handler(h)
	h = s.headers(h)
	h = s.hosts(h)
	h = s.logged(h)
	return s.recovered(h)
}

// Run serves until ctx ends, then stops taking requests and gives those under way up to drain to finish.
func (s *Server) Run(ctx context.Context, drain time.Duration) error {
	srv := &http.Server{
		Addr:              s.cfg.Addr,
		Handler:           s.handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    32 << 10,
		ErrorLog:          slog.NewLogLogger(slog.Default().Handler(), slog.LevelWarn),
	}
	ln, err := net.Listen("tcp", s.cfg.Addr)
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
	srv.RegisterOnShutdown(func() { close(s.closing) })
	errs := make(chan error, 1)
	go func() { errs <- srv.Serve(ln) }()
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.rooms.Sweep()
			}
		}
	}()
	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), drain)
	defer cancel()
	return srv.Shutdown(shutdown)
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
	if strings.HasSuffix(path, "/events") { // a room's stream: logged when it ends, which says nothing
		return true
	}
	return strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/qimg/") || path == "/favicon.svg"
}
