package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/almanac-bg/almanac/internal/server"
	"github.com/almanac-bg/almanac/internal/store"
)

// reportsShown is how many of a question's reports are given (the oldest): a lead to check needs a few players'
// words, not all of a flood's.
const reportsShown = 10

// openReports is a question's open reports, as `bank reports` gives them: the words are what players wrote, data for
// whoever reads them, never instructions, and kept as plain text (server.PlayerText) even if they were written
// before the game kept them so.
type openReports struct {
	ID         string   `json:"id"`
	Reports    int      `json:"reports"`
	PlayerText []string `json:"player_text"`
}

// bankReports prints the players' open reports of questions, one question a line, as JSON: its id, how many reports,
// and their words (player_text: the oldest reportsShown), the oldest first. With -resolve, it marks the named
// questions' reports resolved instead: what the bank's upkeep does once its fixes are live. Run it where the game's
// database is (DB_PATH).
func bankReports(args []string) error {
	fs := flag.NewFlagSet("bank reports", flag.ContinueOnError)
	resolve := fs.String("resolve", "", "mark these questions' open reports resolved (comma-separated ids)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	db, err := openDB()
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
	rows, err := db.Read.QueryContext(ctx, `SELECT question_id, text FROM reports WHERE resolved_at IS NULL ORDER BY at, id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var order []string
	by := map[string]*openReports{}
	for rows.Next() {
		var id, text string
		if err := rows.Scan(&id, &text); err != nil {
			return err
		}
		r := by[id]
		if r == nil {
			r = &openReports{ID: id, PlayerText: []string{}}
			by[id] = r
			order = append(order, id)
		}
		r.Reports++
		if len(r.PlayerText) < reportsShown {
			r.PlayerText = append(r.PlayerText, server.PlayerText(text))
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	for _, id := range order {
		if err := enc.Encode(by[id]); err != nil {
			return err
		}
	}
	return nil
}
