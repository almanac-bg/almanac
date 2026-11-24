package main

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/server"
	"github.com/almanac-bg/almanac/internal/store"
)

// playerCommand deletes a player at their request, made by mail (the privacy page: theirs, or a parent's for a
// child's profile): `almanac player delete <email|@tag>` lists who it is and what of theirs the database holds, and
// changes nothing; with -yes, it deletes them as their own deletion does (DELETE /api/me: account.Accounts.Delete, on
// server.NewAccounts, so every part of the game forgets them). It never migrates the database (store.Open), nor makes
// one (openDB). On the server, run it as the service, like the backup commands (README).
func playerCommand(args []string) error {
	const usage = "usage: almanac player delete [-yes] <email|@tag>"
	if len(args) < 2 || args[0] != "delete" {
		return errors.New(usage)
	}
	args = args[1:]
	yes := args[0] == "-yes"
	if yes {
		args = args[1:]
	}
	if len(args) != 1 {
		return errors.New(usage)
	}
	db, err := openDB()
	if err != nil {
		return err
	}
	defer db.Close()
	return deletePlayer(context.Background(), db, args[0], yes, os.Stdout)
}

// deletePlayer finds the one player who (an email address, or a tag after @), says who they are and what the database
// holds of them, and with yes deletes them.
func deletePlayer(ctx context.Context, db *store.DB, who string, yes bool, out io.Writer) error {
	who = strings.TrimSpace(who)
	var column, value string
	var err error
	switch {
	case strings.HasPrefix(who, "@"):
		column = "tag"
		value, err = account.NormalTag(who)
	case strings.Contains(who, "@"):
		column = "email"
		value, err = account.NormalEmail(who)
	default:
		return fmt.Errorf("%q is neither an email address nor a tag: give one, a tag after @ (@ivan.1234)", who)
	}
	if err != nil {
		return fmt.Errorf("%q: %w", who, err)
	}
	var id, created, seen int64
	var name, tag string
	var email sql.NullString
	err = db.Read.QueryRowContext(ctx, `SELECT id, name, tag, email, created_at, seen_at FROM users WHERE `+column+` = ?`,
		value).Scan(&id, &name, &tag, &email, &created, &seen)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("no player has the %s %s", column, value)
	}
	if err != nil {
		return err
	}
	date := func(ms int64) string { return time.UnixMilli(ms).Format(time.DateOnly) }
	fmt.Fprintf(out, "player %d: %s (@%s), %s, since %s, last seen %s\n", id, name, tag,
		cmp.Or(email.String, "a guest (no email)"), date(created), date(seen))
	held, err := heldOf(ctx, db, id, email.String)
	if err != nil {
		return err
	}
	for _, h := range held {
		fmt.Fprintln(out, "  "+h)
	}
	if !yes {
		fmt.Fprintln(out, "nothing deleted: run again with -yes to delete this player")
		return nil
	}
	accounts := server.NewAccounts(db, nil, nil)
	if err := accounts.Delete(ctx, id); err != nil {
		return err
	}
	fmt.Fprintf(out, "deleted player %d: their own rows went with them, others' history kept without them (play.Forget), "+
		"their address gone from the mail and the codes\n", id)
	return nil
}

// heldOf is what the database holds of a player, a line for each table that has any: rows that name them (each
// column that refers to users, with what a deletion does to it), and rows under their address.
func heldOf(ctx context.Context, db *store.DB, id int64, email string) ([]string, error) {
	var lines []string
	refs, err := db.Read.QueryContext(ctx, `SELECT m.name, f."from", f.on_delete FROM sqlite_schema m,
		pragma_foreign_key_list(m.name) f WHERE m.type = 'table' AND f."table" = 'users' ORDER BY m.name, f."from"`)
	if err != nil {
		return nil, err
	}
	type ref struct{ table, column, onDelete string }
	var rs []ref
	for refs.Next() {
		var r ref
		if err := refs.Scan(&r.table, &r.column, &r.onDelete); err != nil {
			refs.Close()
			return nil, err
		}
		rs = append(rs, r)
	}
	refs.Close()
	if err := refs.Err(); err != nil {
		return nil, err
	}
	what := map[string]string{"CASCADE": "deleted", "SET NULL": "kept for the others without them, but what play.Forget deletes (a duel not over)"}
	for _, r := range rs {
		var n int
		if err := db.Read.QueryRowContext(ctx, `SELECT count(*) FROM "`+r.table+`" WHERE "`+r.column+`" = ?`, id).
			Scan(&n); err != nil {
			return nil, err
		}
		if n > 0 {
			lines = append(lines, fmt.Sprintf("%s.%s: %d (%s)", r.table, r.column, n, cmp.Or(what[r.onDelete], r.onDelete)))
		}
	}
	var days int
	if err := db.Read.QueryRowContext(ctx, `SELECT count(*) FROM active_days WHERE user_id = ?`, id).Scan(&days); err != nil {
		return nil, err
	}
	if days > 0 {
		lines = append(lines, fmt.Sprintf("active_days.user_id: %d (the counted ones kept as nobody's, for the retention counts)", days))
	}
	if email == "" {
		return lines, nil
	}
	cols, err := db.Read.QueryContext(ctx, `SELECT m.name, c.name FROM sqlite_schema m, pragma_table_info(m.name) c
		WHERE m.type = 'table' AND m.name <> 'users' AND (c.name = 'email' OR c.name LIKE '%\_email' ESCAPE '\')
		ORDER BY m.name`)
	if err != nil {
		return nil, err
	}
	var at [][2]string
	for cols.Next() {
		var t, c string
		if err := cols.Scan(&t, &c); err != nil {
			cols.Close()
			return nil, err
		}
		at = append(at, [2]string{t, c})
	}
	cols.Close()
	if err := cols.Err(); err != nil {
		return nil, err
	}
	for _, tc := range at {
		var n int
		if err := db.Read.QueryRowContext(ctx, `SELECT count(*) FROM "`+tc[0]+`" WHERE "`+tc[1]+`" = ?`, email).
			Scan(&n); err != nil {
			return nil, err
		}
		if n > 0 {
			lines = append(lines, fmt.Sprintf("%s.%s: %d under their address (deleted)", tc[0], tc[1], n))
		}
	}
	var mails int
	if err := db.Read.QueryRowContext(ctx, `SELECT count(*) FROM outbox WHERE message ->> 'to' = ?`, email).
		Scan(&mails); err != nil {
		return nil, err
	}
	if mails > 0 {
		lines = append(lines, fmt.Sprintf("outbox: %d mails waiting to go to them (deleted)", mails))
	}
	return lines, nil
}
