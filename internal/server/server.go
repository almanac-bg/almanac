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
	// Dev serves the client from disk, as the build rewrites it.
	Dev     bool
	Version string
}

// Server is the game's HTTP side.
type Server struct {
	cfg      Config
	db       *store.DB
	accounts *account.Accounts
	outbox   *mail.Outbox
	bank     atomic.Pointer[bank.Bank]
	client   fs.FS
	limits   *limiter
	secure   bool
	cookie   string
	handler  http.Handler
}

func New(cfg Config, db *store.DB, accounts *account.Accounts, outbox *mail.Outbox, b *bank.Bank) (*Server, error) {
	u, err := url.Parse(cfg.PublicURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, errors.New("PUBLIC_URL must be like https://almanac.bg")
	}
	s := &Server{
		cfg: cfg, db: db, accounts: accounts, outbox: outbox,
		client: assets.FS(cfg.Dev),
		limits: newLimiter(),
		secure: u.Scheme == "https",
	}
	// A __Host- cookie is bound to this exact host, over HTTPS, for the whole site: nothing else can set or read it.
	s.cookie = "sid"
	if s.secure {
		s.cookie = "__Host-sid"
	}
	s.bank.Store(b)
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
	api("POST /api/guest", s.guest)
	api("POST /api/auth/code", s.sendCode)
	api("POST /api/auth/verify", s.verify)
	api("POST /api/auth/signout", s.signOut)
	mux.Handle("/api/", s.apiHandler(func(http.ResponseWriter, *http.Request) error { return errNotFound }))

	mux.HandleFunc("GET /qimg/{file}", s.picture)
	mux.HandleFunc("GET /assets/{file...}", s.asset)
	for _, f := range publicFiles {
		mux.HandleFunc("GET /"+f, s.publicFile)
	}
	mux.HandleFunc("/", s.page)

	var h http.Handler = mux
	h = http.NewCrossOriginProtection().Handler(h)
	h = s.headers(h)
	h = s.logged(h)
	return recovered(h)
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
	errs := make(chan error, 1)
	go func() { errs <- srv.Serve(ln) }()
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
	return strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/qimg/") || path == "/favicon.svg"
}
