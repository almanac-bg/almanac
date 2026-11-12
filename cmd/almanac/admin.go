package main

import (
	"fmt"
	"strings"

	"github.com/almanac-bg/almanac/internal/store"
)

// adminCommand makes a player an admin (or, with -remove, no longer one), by the email they sign in with.
func adminCommand(args []string) error {
	remove := len(args) == 2 && args[0] == "-remove"
	if remove {
		args = args[1:]
	}
	if len(args) != 1 {
		return fmt.Errorf("usage: almanac admin [-remove] <email>")
	}
	db, err := store.Open(dbPath())
	if err != nil {
		return err
	}
	defer db.Close()
	flag := 1
	if remove {
		flag = 0
	}
	res, err := db.Write.Exec(`UPDATE users SET admin = ? WHERE email = ?`, flag, strings.ToLower(strings.TrimSpace(args[0])))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("nobody signs in with %s: sign in with it on the site first", args[0])
	}
	fmt.Println("done: /admin")
	return nil
}
