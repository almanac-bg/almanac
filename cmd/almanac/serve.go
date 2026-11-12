package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/server"
	"github.com/almanac-bg/almanac/internal/store"
)

// serve runs the game, configured by the environment (deploy/almanac.env lists every setting):
//
//	DEV=1               development: the client from disk, mail to the log, a fixed secret
//	ADDR                where to listen (:8080)
//	PUBLIC_URL          the address players use (http://localhost:8080)
//	DB_PATH             the database file (almanac.db)
//	BANK_DIR            the question bank (private/ if there, else bank/sample)
//	SECRET              32+ random characters, for the codes' hashes (required outside development)
//	SMTP_URL            smtp://user:password@host:587 (required outside development)
//	MAIL_FROM           "АЛМАНАХ <no-reply@almanac.bg>"
//	TLS_CERT, TLS_KEY   serve HTTPS with this certificate (behind Cloudflare: its origin certificate)
//	TRUST_CLOUDFLARE=1  take players' addresses from Cloudflare's header (only if nothing else can reach the server)
//
// SIGHUP reloads the bank; SIGTERM or SIGINT stop the server after the requests under way finish.
func serve([]string) error {
	dev := os.Getenv("DEV") == "1"
	if dev {
		slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})))
	} else {
		slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	}
	env := func(key, fallback string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return fallback
	}
	cfg := server.Config{
		Addr:            env("ADDR", ":8080"),
		PublicURL:       strings.TrimSuffix(env("PUBLIC_URL", "http://localhost:8080"), "/"),
		TLSCert:         os.Getenv("TLS_CERT"),
		TLSKey:          os.Getenv("TLS_KEY"),
		TrustCloudflare: os.Getenv("TRUST_CLOUDFLARE") == "1",
		Dev:             dev,
		Version:         version,
	}
	secret := os.Getenv("SECRET")
	switch {
	case secret == "" && dev:
		secret = "development only, never in production"
	case len(secret) < 32:
		return errors.New("SECRET must be at least 32 characters")
	}
	key := sha256.Sum256([]byte(secret))

	var sender mail.Sender = mail.Log{}
	if u := os.Getenv("SMTP_URL"); u != "" {
		s, err := mail.NewSMTP(u)
		if err != nil {
			return err
		}
		sender = s
	} else if !dev {
		return errors.New("SMTP_URL is required (DEV=1 writes mail to the log instead)")
	}

	bankDir := defaultBankDir()
	b, problems := bank.Load(bankDir)
	if b == nil {
		for _, p := range problems {
			slog.Error("bank", "problem", p.String())
		}
		return fmt.Errorf("the bank in %s has problems", bankDir)
	}
	slog.Info("bank", "dir", bankDir, "questions", len(b.Questions), "live", len(b.Live("", "")))

	db, err := store.Open(env("DB_PATH", "almanac.db"))
	if err != nil {
		return err
	}
	defer db.Close()

	outbox := mail.NewOutbox(db, sender, env("MAIL_FROM", "АЛМАНАХ <no-reply@almanac.bg>"))
	accounts := &account.Accounts{DB: db, Outbox: outbox, Secret: key[:]}
	srv, err := server.New(cfg, db, accounts, outbox, b)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go outbox.Run(ctx)
	go every(ctx, time.Hour, func() {
		if err := accounts.CleanUp(ctx); err != nil && ctx.Err() == nil {
			slog.Error("clean-up", "err", err)
		}
	})
	go reloadOnHangup(ctx, bankDir, srv)

	err = srv.Run(ctx, 30*time.Second)
	flush, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	outbox.Flush(flush)
	slog.Info("stopped")
	return err
}

// reloadOnHangup loads the bank again on SIGHUP (after a pull of the private bank). A broken bank is logged and left
// out: the game keeps the one it has.
func reloadOnHangup(ctx context.Context, dir string, srv *server.Server) {
	hup := make(chan os.Signal, 1)
	signal.Notify(hup, syscall.SIGHUP)
	defer signal.Stop(hup)
	for {
		select {
		case <-ctx.Done():
			return
		case <-hup:
			b, problems := bank.Load(dir)
			if b == nil {
				for _, p := range problems {
					slog.Error("bank reload", "problem", p.String())
				}
				slog.Error("bank reload refused: keeping the bank as it was")
				continue
			}
			srv.SetBank(b)
			slog.Info("bank reloaded", "questions", len(b.Questions), "live", len(b.Live("", "")))
		}
	}
}

// every runs fn now and then every period, until ctx ends.
func every(ctx context.Context, period time.Duration, fn func()) {
	t := time.NewTicker(period)
	defer t.Stop()
	for {
		fn()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
