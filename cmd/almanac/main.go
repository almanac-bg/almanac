// Command almanac is the whole game in one program: the server, and the tools that look after it.
//
//	almanac serve                       run the game
//	almanac bank check [-sample] [-used file] [-live dir] [dir]  check a question bank (what a server would refuse), its runway
//	almanac bank fmt [dir]              rewrite a bank's files in their one format
//	almanac bank subjects [dir]         the subjects that come back, all of them (check shows the top)
//	almanac bank calibrate [dir]        the questions whose difficulty disagrees with what players got right (DB_PATH)
//	almanac bank suspects [dir]         the questions whose players' answers speak against the key (DB_PATH)
//	almanac bank reports [-resolve ids] the players' open reports of questions, as JSON lines; or mark them resolved (DB_PATH)
//	almanac bank used                   the question ids the days have had, for -used (DB_PATH; nothing of a player's)
//	almanac bank plan [-n N] [-json] [-used file] [dir]  plan a batch of N new questions a category, where the day needs them most
//	almanac bank add [-check] [-checked-by P] <batch> [dir]  add, change and retire a checked batch: all of it or nothing (-check: only check)
//	almanac backup now [-force]         copy the database to the backups at once
//	almanac backup list                 the copies, newest first
//	almanac backup restore [-identity F] [-unencrypted] [-into-place [-confirm KEY]] <key|latest> [path]  write a copy
//	                                    to a new database file, or in place of the game's (stopped; its key typed back);
//	                                    -identity: the key that opens it (- : input); -unencrypted: a copy that isn't, by name
//	almanac backup verify [-identity F] [key|latest]  bring a copy back and check it (the latest day's); with the key,
//	                                    its proof code
//	almanac backup proven <code>        record that the key kept off the server opened a copy (the code verify printed)
//	almanac backup keys                 make the key pair the copies are encrypted to (BACKUP_RECIPIENT) and opened with
//	almanac seed [-players N] [-days N] [-seed N] [-state dir]  development only (DEV=1): fill a new database (DB_PATH)
//	                                    with sixty days of play by two hundred players, and print personas to sign in as
//	almanac admin [-remove] <email>     make a player an admin (the /admin page), or no longer one
//	almanac push keys                   make a key pair for notifications (PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY)
//	almanac migrations                  the program's migrations: each one's SHA-256 and name (deploy/deploy.sh)
//	almanac version
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/store"
)

// version is set when a release is built (-ldflags "-X main.version=…").
var version = "dev"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "almanac:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return usage()
	}
	switch args[0] {
	case "serve":
		return serve(args[1:])
	case "bank":
		return bankCommand(args[1:])
	case "backup":
		return backupCommand(args[1:])
	case "admin":
		return adminCommand(args[1:])
	case "seed":
		return seedCommand(args[1:])
	case "push":
		if len(args) == 2 && args[1] == "keys" {
			pub, priv, err := push.NewKeys()
			if err != nil {
				return err
			}
			fmt.Printf("PUSH_PUBLIC_KEY=%s\nPUSH_PRIVATE_KEY=%s\n", pub, priv)
			return nil
		}
	case "migrations":
		if len(args) == 1 {
			lines, err := store.MigrationSums()
			if err != nil {
				return err
			}
			fmt.Println(strings.Join(lines, "\n"))
			return nil
		}
	case "version":
		fmt.Println(version)
		return nil
	}
	return usage()
}

func usage() error {
	return fmt.Errorf("usage: almanac serve | bank check [-sample] [-used file] [-live dir] [dir] | bank lint [-rule R,…] [-summary] [dir] | bank fmt [dir] | bank subjects [dir] | bank calibrate [dir] | bank suspects [dir] | bank reports [-resolve ids] | bank used | bank plan [-n N] [-json] [-used file] [dir] | bank add [-check] [-checked-by P] <batch> [dir] | backup now [-force] | backup list | backup restore [-identity F] [-unencrypted] [-into-place [-confirm KEY]] <key|latest> [path] | backup verify [-identity F] [key|latest] | backup proven <code> | backup keys | admin [-remove] <email> | seed [-players N] [-days N] [-seed N] [-state dir] (DEV=1, a new DB_PATH) | push keys | migrations | version")
}
