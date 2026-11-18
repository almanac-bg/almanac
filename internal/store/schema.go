package store

import (
	"database/sql"
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strings"
)

// The schema's parts and shape: what the migrations check themselves by (store.go, migrate).

type querier interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

// part is one thing of the schema a migration could take away: a table, a column ("table.column"), an index, a
// trigger or a view, and the table it belongs to.
type part struct{ kind, table string }

// partsOf are the schema's parts, by name; SQLite's own (sqlite_*) and the migrations' (schema_migrations) left out.
func partsOf(q querier) (map[string]part, error) {
	rows, err := q.Query(`SELECT m.type, m.name, m.tbl_name FROM sqlite_schema m
		WHERE m.name NOT LIKE 'sqlite_%' AND m.name <> 'schema_migrations'
		UNION ALL
		SELECT 'column', m.name || '.' || c.name, m.name FROM sqlite_schema m, pragma_table_info(m.name) c
		WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name <> 'schema_migrations'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	parts := map[string]part{}
	for rows.Next() {
		var name string
		var p part
		if err := rows.Scan(&p.kind, &name, &p.table); err != nil {
			return nil, err
		}
		parts[name] = p
	}
	return parts, rows.Err()
}

// dropsLine names, in a migration, what it takes away on purpose: "-- drops: runs.opponent, runs_board". A table
// named takes its columns, indexes and triggers along.
var dropsLine = regexp.MustCompile(`(?m)^--\s*drops:(.*)$`)

// mayDrop is a migration that could take something away: only DROP (a table, an index, a trigger, a view, a column)
// and RENAME (a table, a column) do. The others are spared looking (it doubled the time a new database took).
var mayDrop = regexp.MustCompile(`(?i)\b(drop|rename)\b`)

// lost is what of the schema's parts before a migration (`before`) are gone after it and not named in its drops
// lines, sorted.
func lost(body string, before, after map[string]part) []string {
	named := map[string]bool{}
	for _, m := range dropsLine.FindAllStringSubmatch(body, -1) {
		for _, name := range strings.FieldsFunc(m[1], func(r rune) bool { return r == ',' || r == ' ' || r == '\t' }) {
			named[name] = true
		}
	}
	var gone []string
	for name, p := range before {
		if _, ok := after[name]; !ok && !named[name] && !(p.kind != "table" && named[p.table]) {
			gone = append(gone, p.kind+" "+name)
		}
	}
	slices.Sort(gone)
	return gone
}

// shapeOf is the schema as a new database migrated in name order and one migrated in another order would share it
// when they're alike: each table, index, trigger and view by its kind and name, with its SQL without comments or
// extra spaces, and a table's columns and constraints in a sorted order (ALTER TABLE ADD COLUMN puts a column last,
// so two orders of adding them differ there, and nowhere that matters).
func shapeOf(q querier) (map[string]string, error) {
	rows, err := q.Query(`SELECT type, name, coalesce(sql, '') FROM sqlite_schema
		WHERE name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	shape := map[string]string{}
	for rows.Next() {
		var kind, name, text string
		if err := rows.Scan(&kind, &name, &text); err != nil {
			return nil, err
		}
		text = plain(text)
		if kind == "table" {
			text = sortedTable(text)
		}
		shape[kind+" "+name] = text
	}
	return shape, rows.Err()
}

// plain is SQL without its comments, its spaces each one.
func plain(text string) string {
	var b strings.Builder
	var quote rune
	for i := 0; i < len(text); i++ {
		c := rune(text[i])
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			}
		case c == '\'' || c == '"' || c == '`':
			quote = c
		case c == '-' && strings.HasPrefix(text[i:], "--"):
			for i < len(text) && text[i] != '\n' {
				i++
			}
			c = ' '
		case c == '/' && strings.HasPrefix(text[i:], "/*"):
			end := strings.Index(text[i+2:], "*/")
			if end < 0 {
				end = len(text) - i - 4
			}
			i += end + 3
			c = ' '
		}
		b.WriteByte(byte(c))
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// sortedTable is a CREATE TABLE with its columns and constraints (what's between its outer parentheses, split at the
// commas outside any inner ones or quotes) sorted.
func sortedTable(text string) string {
	open, end := strings.IndexByte(text, '('), strings.LastIndexByte(text, ')')
	if open < 0 || end < open {
		return text
	}
	var items []string
	depth, from := 0, open+1
	var quote byte
	for i := open + 1; i < end; i++ {
		switch c := text[i]; {
		case quote != 0:
			if c == quote {
				quote = 0
			}
		case c == '\'' || c == '"' || c == '`':
			quote = c
		case c == '(':
			depth++
		case c == ')':
			depth--
		case c == ',' && depth == 0:
			items = append(items, strings.TrimSpace(text[from:i]))
			from = i + 1
		}
	}
	items = append(items, strings.TrimSpace(text[from:end]))
	slices.Sort(items)
	return text[:open] + "(" + strings.Join(items, ", ") + ")" + text[end+1:]
}

// unlike says how two shapes differ: each kind and name whose SQL isn't the same in both, or is in only one.
func unlike(have, want map[string]string) []string {
	var out []string
	for _, key := range slices.Sorted(maps.Keys(want)) {
		switch got, ok := have[key]; {
		case !ok:
			out = append(out, key+" missing")
		case got != want[key]:
			out = append(out, fmt.Sprintf("%s is %q, not %q", key, got, want[key]))
		}
	}
	for _, key := range slices.Sorted(maps.Keys(have)) {
		if _, ok := want[key]; !ok {
			out = append(out, key+" extra")
		}
	}
	return out
}

// memory is an empty database in memory, with the game's settings that matter to a migration (foreign keys on): to
// try migrations on.
func memory() (*DB, error) {
	w, err := sql.Open("sqlite", "file::memory:?_pragma=foreign_keys(ON)&_txlock=immediate")
	if err != nil {
		return nil, err
	}
	// One connection, kept: each one to :memory: is a database of its own.
	w.SetMaxOpenConns(1)
	w.SetMaxIdleConns(1)
	w.SetConnMaxIdleTime(0)
	w.SetConnMaxLifetime(0)
	return &DB{Write: w, Read: w, Scan: w}, nil
}

// copySchema makes the schema of from (its tables, indexes, triggers and views, without a row) in to, an empty
// database.
func copySchema(from querier, to *sql.DB) error {
	rows, err := from.Query(`SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
		ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid`)
	if err != nil {
		return err
	}
	var all []string
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			rows.Close()
			return err
		}
		all = append(all, text)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, text := range all {
		if _, err := to.Exec(text); err != nil {
			return fmt.Errorf("copying the schema: %w", err)
		}
	}
	return nil
}
