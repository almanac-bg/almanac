package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"

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
// days/12.db.gz) to a new database file.
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
		return backup.Restore(context.Background(), s, args[1], args[2])
	}
	return usage()
}

func dbPath() string {
	if p := os.Getenv("DB_PATH"); p != "" {
		return p
	}
	return "almanac.db"
}
