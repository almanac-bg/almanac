package main

import (
	"context"
	"flag"
	"fmt"
	"strings"

	"github.com/almanac-bg/almanac/internal/store"
)

// bankReports prints the players' open reports of questions, one question a line: its id, how many reports, and
// their words (" | " between them), the oldest first. With -resolve, it marks the named questions' reports resolved
// instead: what the bank's upkeep does once its fixes are live. Run it where the game's database is (DB_PATH).
func bankReports(args []string) error {
	fs := flag.NewFlagSet("bank reports", flag.ContinueOnError)
	resolve := fs.String("resolve", "", "mark these questions' open reports resolved (comma-separated ids)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	db, err := store.Open(dbPath())
	if err != nil {
		return err
	}
	defer db.Close()
	ctx := context.Background()
	if *resolve != "" {
		n := 0
		for _, id := range strings.Split(*resolve, ",") {
			res, err := db.Write.ExecContext(ctx, `UPDATE reports SET resolved_at = ? WHERE question_id = ? AND resolved_at IS NULL`,
				store.Now(), strings.TrimSpace(id))
			if err != nil {
				return err
			}
			k, _ := res.RowsAffected()
			n += int(k)
		}
		fmt.Printf("%d reports resolved\n", n)
		return nil
	}
	rows, err := db.Read.QueryContext(ctx, `SELECT question_id, count(*), group_concat(text, ' | ') FROM
		(SELECT question_id, text, at FROM reports WHERE resolved_at IS NULL ORDER BY at)
		GROUP BY question_id ORDER BY min(at)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, texts string
		var n int
		if err := rows.Scan(&id, &n, &texts); err != nil {
			return err
		}
		fmt.Printf("%s\t%d\t%s\n", id, n, strings.ReplaceAll(texts, "\t", " "))
	}
	return rows.Err()
}
