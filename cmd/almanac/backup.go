package main

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/backup"
	"github.com/almanac-bg/almanac/internal/store"
)

// backupStore is the bucket the environment names (BACKUP_ENDPOINT, BACKUP_BUCKET, BACKUP_ACCESS_KEY,
// BACKUP_SECRET_KEY), or nil if it names none.
func backupStore() (*backup.Store, error) {
	s := &backup.Store{
		Endpoint:  os.Getenv("BACKUP_ENDPOINT"),
		Bucket:    os.Getenv("BACKUP_BUCKET"),
		AccessKey: os.Getenv("BACKUP_ACCESS_KEY"),
		SecretKey: os.Getenv("BACKUP_SECRET_KEY"),
		Region:    "auto",
	}
	if s.Endpoint == "" {
		return nil, nil
	}
	if s.Bucket == "" || s.AccessKey == "" || s.SecretKey == "" {
		return nil, errors.New("BACKUP_ENDPOINT needs BACKUP_BUCKET, BACKUP_ACCESS_KEY and BACKUP_SECRET_KEY too")
	}
	return s, nil
}

// backupCommand: `backup now` makes a copy at once; `backup restore <key> <path>` writes a copy (hours/07.db.gz,
// days/12.db.gz) to a new database file and checks it; `backup verify [key]` brings a copy back to a temporary file and
// checks it, the latest day's copy if no key is given.
func backupCommand(args []string) error {
	s, err := backupStore()
	if err != nil {
		return err
	}
	if s == nil {
		return errors.New("no backups configured (BACKUP_ENDPOINT)")
	}
	switch {
	case len(args) == 1 && args[0] == "now":
		path := dbPath()
		db, err := store.Open(path)
		if err != nil {
			return err
		}
		defer db.Close()
		b := &backup.Backer{Store: s, DB: db.Read, Dir: filepath.Dir(path)}
		return b.Once(context.Background())
	case len(args) == 3 && args[0] == "restore":
		ctx := context.Background()
		if err := backup.Restore(ctx, s, args[1], args[2]); err != nil {
			return err
		}
		counts, err := backup.Check(ctx, args[2])
		if err != nil {
			return fmt.Errorf("restored to %s, but the copy is damaged: %w", args[2], err)
		}
		printCounts(args[2]+" restored and whole", counts)
		return nil
	case len(args) >= 1 && len(args) <= 2 && args[0] == "verify":
		return verifyBackup(s, args[1:])
	}
	return usage()
}

// verifyBackup brings back the copy under key (the latest day's: today's, else yesterday's) and checks it.
func verifyBackup(s *backup.Store, key []string) error {
	ctx := context.Background()
	keys := key
	if len(keys) == 0 {
		now := time.Now()
		keys = []string{backup.Keys(now)[1], backup.Keys(now.AddDate(0, 0, -1))[1]}
	}
	for i, k := range keys {
		counts, err := backup.Drill(ctx, s, k, os.TempDir())
		if errors.Is(err, backup.ErrMissing) && i < len(keys)-1 {
			continue
		}
		if err != nil {
			return fmt.Errorf("%s: %w", k, err)
		}
		printCounts(k+" brought back and whole", counts)
		return nil
	}
	return nil
}

func printCounts(what string, counts map[string]int64) {
	fmt.Println(what + ":")
	for _, t := range slices.Sorted(maps.Keys(counts)) {
		fmt.Printf("  %-18s %d rows\n", t, counts[t])
	}
}

func dbPath() string {
	if p := os.Getenv("DB_PATH"); p != "" {
		return p
	}
	return "almanac.db"
}
