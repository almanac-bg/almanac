package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/seed"
	"github.com/almanac-bg/almanac/internal/server"
	"github.com/almanac-bg/almanac/internal/store"
)

// seedCommand fills a new development database (DB_PATH) with sixty days of a game played by two hundred players
// (package seed), and prints the personas a reviewer can sign in as: each one's cookie, and with -state, a Playwright
// storage state per persona in that folder (test.use({ storageState }), or `npx playwright open --load-storage`).
//
//	DEV=1 DB_PATH=/tmp/seeded.db go run ./cmd/almanac seed [-players N] [-days N] [-seed N] [-state dir]
//	DEV=1 DB_PATH=/tmp/seeded.db go run ./cmd/almanac serve
//
// It refuses without DEV=1, in a release's build, with production's settings (as serve's devOnly, and SMTP_URL or
// BACKUP_ENDPOINT), with the server's database path, and on a database that isn't new and empty (seed.Fresh).
func seedCommand(args []string) error {
	fs := flag.NewFlagSet("seed", flag.ContinueOnError)
	players := fs.Int("players", 200, "how many players")
	days := fs.Int("days", 60, "how many days of history")
	draw := fs.Uint64("seed", 1, "the random draw of the players and what they do")
	state := fs.String("state", "", "a folder to write a Playwright storage state per persona into")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return errors.New("usage: almanac seed [-players N] [-days N] [-seed N] [-state dir]")
	}
	publicURL := strings.TrimSuffix(os.Getenv("PUBLIC_URL"), "/")
	if publicURL == "" {
		publicURL = "http://localhost:8080"
	}
	if err := seedAllowed(publicURL); err != nil {
		return err
	}
	// The game's own warnings (a small bank's days drawn short) aren't the seed's: errors only.
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))
	b, problems := bank.Load(defaultBankDir())
	if b == nil {
		logErrors("bank", problems)
		return fmt.Errorf("the bank in %s has errors", defaultBankDir())
	}
	path := dbPath()
	db, err := store.Open(path)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx := context.Background()
	if err := seed.Fresh(ctx, db); err != nil {
		return fmt.Errorf("%s: %w (seed a new file: DB_PATH=/tmp/seeded.db)", path, err)
	}
	fmt.Fprintf(os.Stderr, "seeding %s from %s: %d players, %d days…\n", path, b.Dir, *players, *days)
	personas, err := seed.Seed(ctx, db, b, seed.Options{Players: *players, Days: *days, Seed: *draw,
		Progress: func(line string) { fmt.Fprintln(os.Stderr, line) }})
	if err != nil {
		return err
	}
	u, _ := url.Parse(publicURL)
	fmt.Printf("Seeded %s. Serve it: DEV=1 DB_PATH=%s go run ./cmd/almanac serve\n\n", path, path)
	fmt.Printf("Be a persona: a cookie named sid on %s with the token below (Playwright: context.addCookies([{ name: "+
		"\"sid\", value: TOKEN, url: %q }])).\n\n", u.Host, publicURL)
	for _, p := range personas {
		fmt.Printf("%-8s %s (@%s, id %d)", p.Key, p.Name, p.Tag, p.ID)
		if p.Email != "" {
			fmt.Printf(" %s", p.Email)
		}
		fmt.Printf("\n         %s\n         sid=%s\n", p.About, p.Token)
	}
	if *state != "" {
		if err := os.MkdirAll(*state, 0o700); err != nil {
			return err
		}
		for _, p := range personas {
			data, _ := json.MarshalIndent(map[string]any{
				"cookies": []map[string]any{{"name": "sid", "value": p.Token, "domain": u.Hostname(), "path": "/",
					"expires": -1, "httpOnly": true, "secure": false, "sameSite": "Lax"}},
				"origins": []any{},
			}, "", "  ")
			if err := os.WriteFile(filepath.Join(*state, p.Key+".json"), data, 0o600); err != nil {
				return err
			}
		}
		fmt.Printf("\nPlaywright storage states: %s/<persona>.json\n", *state)
	}
	return nil
}

// seedAllowed refuses to seed anywhere but a developer's machine: without DEV=1, in a release's build (production
// runs nothing else), with any of production's settings, or with the server's own database path.
func seedAllowed(publicURL string) error {
	if os.Getenv("DEV") != "1" {
		return errors.New("seed is for development only: DEV=1")
	}
	if version != "dev" {
		return fmt.Errorf("seed is for development only: this is the release %s", version)
	}
	cfg := server.Config{Dev: true, PublicURL: publicURL, TLSCert: os.Getenv("TLS_CERT"), TLSKey: os.Getenv("TLS_KEY"),
		TrustCloudflare: os.Getenv("TRUST_CLOUDFLARE") == "1"}
	if err := devOnly(cfg); err != nil {
		return err
	}
	for _, key := range []string{"SMTP_URL", "BACKUP_ENDPOINT", "PUSH_PRIVATE_KEY"} {
		if os.Getenv(key) != "" {
			return fmt.Errorf("seed is for development only, not with %s set", key)
		}
	}
	if abs, err := filepath.Abs(dbPath()); err != nil || strings.HasPrefix(abs, "/var/lib/almanac") {
		return errors.New("seed is for development only, not on the server's database (/var/lib/almanac)")
	}
	return nil
}
