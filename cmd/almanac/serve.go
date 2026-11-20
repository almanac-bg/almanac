package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/royal"
	"github.com/almanac-bg/almanac/internal/safe"
	"github.com/almanac-bg/almanac/internal/server"
	"github.com/almanac-bg/almanac/internal/store"
)

// serve runs the game, configured by the environment (deploy/env.example shows the server's):
//
//	DEV=1               development: the client from disk, mail to the log (and to MAIL_DIR, if set), a fixed secret,
//	                    no limits, any host, reserve days by today's rules from the first day (play.ReserveRulesFrom);
//	                    refused with production's settings (devOnly)
//	ADDR                where to listen (:8080)
//	PUBLIC_URL          the address players use (http://localhost:8080)
//	DB_PATH             the database file (almanac.db); copies are made beside it
//	BANK_DIR            the question bank (private/ if there, else bank/sample)
//	SECRET              32+ random characters, for the codes' hashes (required outside development)
//	SMTP_URL            smtp://user:password@host:587 (required outside development)
//	MAIL_FROM           "АЛМАНАХ <no-reply@almanac.bg>"
//	TLS_CERT, TLS_KEY   serve HTTPS with this certificate (behind Cloudflare: its origin certificate)
//	TRUST_CLOUDFLARE=1  take players' addresses from Cloudflare's header, on connections from Cloudflare's addresses
//	ALERT_EMAIL         where new kinds of problems are mailed (hourly, each kind once a day)
//	PUSH_PUBLIC_KEY,    notifications (Web Push): the VAPID key pair `almanac push keys` makes; without them,
//	PUSH_PRIVATE_KEY    no notifications
//	BACKUP_ENDPOINT     S3-compatible storage for copies of the database every quarter of an hour (R2), with
//	                    BACKUP_BUCKET, BACKUP_ACCESS_KEY, BACKUP_SECRET_KEY, and BACKUP_HEARTBEAT (a monitor's URL,
//	                    fetched after each)
//	BACKUP_RECIPIENT    the age public key the copies are encrypted to (`almanac backup keys`); without it they go
//	                    unencrypted, and that's a problem told daily
//
// Outside development, a setting the game can run without but shouldn't (ALERT_*, BACKUP_ENDPOINT, BACKUP_HEARTBEAT)
// is a problem told as it starts (missing: unconfigured), or an error in the log when it's the alerts themselves.
//
//	OPERATOR_NAME       who runs the game, for the privacy page
//	CONTACT_EMAIL       where players write about their data (privacy@almanac.bg)
//	ROYAL_EVERY         development only: a Роял every this long (2m), its lobby open ROYAL_LOBBY (1m) before; else
//	                    every evening at 21:00
//	CROWD_FROM          development only: how many answers a question needs before how players answered it shows
//	                    (1); else 10 of the day's players for the day's ten, 20 for everyone's
//	MTA_STS_MX          the domain's mail servers, comma-separated, for its MTA-STS policy at mta-sts.<domain>;
//	                    MTA_STS_MODE testing (the default), enforce, or none (to take it away)
//
// The server plays a copy of BANK_DIR kept beside the database (banks.go: outside development), and starts on the
// last good copy when BANK_DIR has errors. SIGHUP reloads the bank (deploy/bank.sh), from the moment the program
// starts (one that comes during the start is taken once it's up); a new bank waits while Роял is on
// (internal/server/bank.go). SIGTERM or SIGINT stop the server after the requests under way finish (a deploy drains it
// first: internal/server/drain.go). A version that brings a migration copies the database as it first starts, before
// migrating it (store.KeepCopy); one without makes no copy, and starts at once. Started by systemd's socket
// (deploy/almanac.socket), it serves on that socket, and ADDR is left aside.
func serve([]string) error {
	// First of all: a reload asked while the server starts would kill it (the default for SIGHUP).
	hup := make(chan os.Signal, 1)
	signal.Notify(hup, syscall.SIGHUP)
	defer signal.Stop(hup)
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
		MTASTS:          strings.FieldsFunc(os.Getenv("MTA_STS_MX"), func(r rune) bool { return r == ',' || r == ' ' }),
		MTASTSMode:      os.Getenv("MTA_STS_MODE"),
		Operator:        os.Getenv("OPERATOR_NAME"),
		Contact:         env("CONTACT_EMAIL", "privacy@almanac.bg"),
		Alerts:          server.Alerts{Email: os.Getenv("ALERT_EMAIL")},
		LimitsFile:      filepath.Join(filepath.Dir(dbPath()), "limits.json"),
		RunningFile:     filepath.Join(filepath.Dir(dbPath()), "running.json"),
		DBPath:          dbPath(),
		Dev:             dev,
		Version:         version,
	}
	if err := devOnly(cfg); err != nil {
		return err
	}
	if every := os.Getenv("ROYAL_EVERY"); every != "" && dev {
		e, err := time.ParseDuration(every)
		if err != nil || e <= 0 {
			return errors.New("ROYAL_EVERY must be like 2m")
		}
		lobby, err := time.ParseDuration(env("ROYAL_LOBBY", "1m"))
		if err != nil || lobby <= 0 || lobby > e {
			return errors.New("ROYAL_LOBBY must be like 1m, and no longer than ROYAL_EVERY")
		}
		cfg.Royal = royal.Schedule{Every: e, Lobby: lobby}
	}
	if dev {
		play.ReserveRulesFrom = "" // no players from before today's rules of reserve days to keep theirs
	}
	if from := os.Getenv("CROWD_FROM"); from != "" && dev {
		n, err := strconv.Atoi(from)
		if err != nil || n < 1 {
			return errors.New("CROWD_FROM must be a number from 1")
		}
		cfg.CrowdMin = n
	}
	secret := os.Getenv("SECRET")
	switch {
	case secret == "" && dev:
		secret = "development only, never in production"
	case len(secret) < 32:
		return errors.New("SECRET must be at least 32 characters")
	}
	key := sha256.Sum256([]byte(secret))

	var sender mail.Sender = mail.Log{Dir: os.Getenv("MAIL_DIR")}
	if u := os.Getenv("SMTP_URL"); u != "" {
		s, err := mail.NewSMTP(u)
		if err != nil {
			return err
		}
		sender = s
	} else if !dev {
		return errors.New("SMTP_URL is required (DEV=1 writes mail to the log instead)")
	}

	banks := keptBanks{src: defaultBankDir()}
	if !dev {
		banks.dir = filepath.Join(filepath.Dir(dbPath()), "banks")
	}
	b, problems, commit := banks.take()
	var refused int // the errors of BANK_DIR's bank, left out for the last good copy
	if b == nil {
		logErrors("bank", problems)
		refused = bank.CountOf(problems).Errors
		if b = banks.fallback(); b == nil {
			return fmt.Errorf("the bank in %s has errors, and no good copy of an earlier one is kept", banks.src)
		}
		slog.Error("bank: BANK_DIR has errors, so the last good copy is played", "refused", commit, "played", b.Commit)
	}
	slog.Info("bank", "dir", b.Dir, "commit", b.Commit, "questions", len(b.Questions), "live", len(b.Live("", "")), "overdue", overdue(b))
	banks.prune([]*bank.Bank{b})

	backups, err := backupStore()
	if err != nil {
		return err
	}
	// A release's version copies the database if it has migrations to apply, to go back to if they went wrong.
	if !dev && strings.HasPrefix(version, "v") {
		if made, err := store.KeepCopy(dbPath(), version); err != nil {
			return fmt.Errorf("copying the database before %s: %w", version, err)
		} else if made {
			slog.Info("database copied before its migrations", "before", version)
		}
	}
	db, err := store.Open(dbPath())
	if err != nil {
		return err
	}
	defer db.Close()

	outbox := mail.NewOutbox(db, sender, env("MAIL_FROM", "АЛМАНАХ <no-reply@almanac.bg>"))
	accounts := &account.Accounts{DB: db, Outbox: outbox, Secret: key[:], Unlimited: dev}
	if pub, priv := os.Getenv("PUSH_PUBLIC_KEY"), os.Getenv("PUSH_PRIVATE_KEY"); pub != "" || priv != "" {
		keys, err := push.ParseKeys(pub, priv)
		if err != nil {
			return err
		}
		cfg.Push = &push.Sender{Keys: keys, Subject: "mailto:" + cfg.Contact}
	}
	srv, err := server.New(cfg, server.Deps{DB: db, Accounts: accounts, Outbox: outbox, Bank: b})
	if err != nil {
		return err
	}
	if refused > 0 {
		srv.RefuseBank(commit, refused)
		srv.Problem("bank: BANK_DIR has errors, so the server started on the last good copy")
	}
	outbox.Problem = srv.Problem // a dead mail server is told, not only logged
	if !dev {
		for _, p := range unconfigured(cfg.Alerts, backups != nil, os.Getenv("BACKUP_HEARTBEAT") != "") {
			slog.Error("settings", "problem", p)
			srv.Problem("settings: " + p)
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	// Before anything is served: the games played before each was judged as its answers came in (play/fair.go).
	if n, err := srv.JudgeRuns(ctx); err != nil {
		slog.Error("judging runs", "err", err)
	} else if n > 0 {
		slog.Info("judged runs", "scripted", n)
	}
	// The work done in the background, each loop started again if it panics (package safe: the panic is told, and
	// the process, with every game in it, goes on).
	go safe.Loop(ctx, "mail: the outbox", outbox.Run)
	go every(ctx, "accounts: the clean-up", time.Hour, func() {
		if err := accounts.CleanUp(ctx); err != nil && ctx.Err() == nil {
			slog.Error("clean-up", "err", err)
		}
		if !dev {
			if err := store.PruneCopies(dbPath()); err != nil {
				slog.Error("clean-up: the database's copies", "err", err)
			}
			if low, room := store.DiskLow(dbPath()); low {
				slog.Error("disk: running out of room", "room", room)
				srv.Problem(fmt.Sprintf("disk: under %.0f%% or 3× the database free: a release with migrations, the backups, "+
					"then every write will fail; free some (df -h; the log says how much: journalctl -u almanac | grep disk)", store.LowFree*100))
			}
		}
	})
	go safe.Loop(ctx, "bank: reloading", func(ctx context.Context) { reloadOnHangup(ctx, hup, banks, srv) })
	go safe.Loop(ctx, "push: the reminders", srv.Remind)
	pushed := make(chan struct{})
	go func() {
		safe.Loop(ctx, "push: sending", srv.Push) // notifications; stopping, it finishes the sends it has begun
		close(pushed)
	}()
	go safe.Loop(ctx, "days ahead", srv.KeepDays)
	safe.Go("counting", func() {
		if err := srv.Count(ctx); err != nil && ctx.Err() == nil {
			slog.Error("counting", "err", err)
		}
	})
	if cfg.Alerts != (server.Alerts{}) {
		go safe.Loop(ctx, "telling problems", func(ctx context.Context) { srv.TellProblems(ctx, time.Hour) })
	}
	if backups != nil {
		go safe.Loop(ctx, "backups", func(ctx context.Context) { runBackups(ctx, srv) })
	}

	err = srv.Run(ctx, 30*time.Second)
	flush, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	outbox.Flush(flush)
	select { // a send cut here is sent again by the next run, shown once (server/pushes.go)
	case <-pushed:
	case <-flush.Done():
	}
	slog.Info("stopped")
	return err
}

// reloadOnHangup loads the bank again on SIGHUP (after a pull of the private bank), through a new copy, and offers
// it to the server: in play at once, or held while Роял is on. A bank with errors is logged and left out: the game
// keeps the one it has.
func reloadOnHangup(ctx context.Context, hup <-chan os.Signal, banks keptBanks, srv *server.Server) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-hup:
			b, problems, commit := banks.take()
			if b == nil {
				logErrors("bank reload", problems)
				slog.Error("bank reload refused: keeping the bank as it was", "commit", commit)
				srv.RefuseBank(commit, bank.CountOf(problems).Errors)
				srv.Problem("bank reload refused: the bank has errors")
				continue
			}
			if !srv.OfferBank(b) {
				slog.Info("bank reloaded", "commit", b.Commit, "questions", len(b.Questions), "live", len(b.Live("", "")), "overdue", overdue(b))
			}
			banks.prune(srv.Banks())
		}
	}
}

// unconfigured says which settings the game runs without but shouldn't: no alerts (nothing it finds wrong is told to
// anyone; this very problem can only be logged), no backups, or no heartbeat (nothing outside the server hears when
// the copies stop, or the server with them).
func unconfigured(alerts server.Alerts, backups, heartbeat bool) []string {
	var out []string
	if alerts == (server.Alerts{}) {
		out = append(out, "no ALERT_EMAIL: what goes wrong is told to no one")
	}
	if !backups {
		out = append(out, "no BACKUP_ENDPOINT: the database is copied nowhere (README: Резервни копия)")
	} else if !heartbeat {
		out = append(out, "no BACKUP_HEARTBEAT: nothing outside the server hears when the copies stop (README: Наблюдение)")
	}
	return out
}

// logErrors logs a bank's errors (its warnings are bank lint's to list).
func logErrors(what string, problems []bank.Problem) {
	for _, p := range problems {
		if !p.Warning {
			slog.Error(what, "problem", p.String())
		}
	}
}

// overdue says how many of a bank's questions are due for review today (play.Overdue): no game deals them until the
// questions skill checks them and moves their date. A warning names them.
func overdue(b *bank.Bank) int {
	ids := play.Overdue(b, today())
	if len(ids) > 0 {
		slog.Warn("bank: questions due for review are left out of every game until they're checked", "ids", ids)
	}
	return len(ids)
}

// every runs fn now and then every period, until ctx ends: each round on its own, a panic in one stopped (safe).
func every(ctx context.Context, what string, period time.Duration, fn func()) {
	safe.Do(what, fn)
	safe.Every(ctx, what, period, fn)
}

// devOnly refuses development's freedoms (DEV=1: no limits, any host, the client from disk, a fixed secret when SECRET
// is empty) together with any of production's settings: an https PUBLIC_URL, a certificate, Cloudflare in front. A
// DEV=1 left in the server's environment would otherwise open the game to everyone's floods; this way it doesn't start
// (and a deploy goes back).
func devOnly(cfg server.Config) error {
	if !cfg.Dev {
		return nil
	}
	var prod []string
	if strings.HasPrefix(strings.ToLower(cfg.PublicURL), "https:") {
		prod = append(prod, "an https PUBLIC_URL")
	}
	if cfg.TLSCert != "" || cfg.TLSKey != "" {
		prod = append(prod, "TLS_CERT or TLS_KEY")
	}
	if cfg.TrustCloudflare {
		prod = append(prod, "TRUST_CLOUDFLARE")
	}
	if len(prod) > 0 {
		return fmt.Errorf("DEV=1 is for development, not with production's settings: %s", strings.Join(prod, ", "))
	}
	return nil
}
