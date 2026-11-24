package account

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/store/storetest"
)

// Every column that holds an address by its name (email, …_email, …address…) is cleared when its player is deleted:
// users' by the row going, any other's by a statement of the deletion (remove, mail.Unqueue or play.Forget) that
// deletes from its table by that column. A new table keyed by an address must be wired into the deletion, or this
// fails. It sees names only: an address inside a value (outbox.message's JSON, which mail.Unqueue clears) or in a
// column named otherwise is for the deletion's own tests (TestDeleteForgetsTheAddress, play's TestForgetKeepsOthersHistory).
func TestDeletionClearsAddressColumns(t *testing.T) {
	var deletion strings.Builder
	for _, f := range []struct{ file, fn string }{
		{"account.go", "func (a *Accounts) remove("},
		{"../mail/mail.go", "func Unqueue("},
		{"../play/merge.go", "func Forget("},
	} {
		src, err := os.ReadFile(f.file)
		if err != nil {
			t.Fatal(err)
		}
		_, body, ok := strings.Cut(string(src), "\n"+f.fn)
		body, _, ok2 := strings.Cut(body, "\n}\n")
		if !ok || !ok2 {
			t.Fatalf("%s has no %s…}", f.file, f.fn)
		}
		deletion.WriteString(body)
	}
	db := storetest.Open(t)
	rows, err := db.Read.Query(`SELECT m.name, c.name FROM sqlite_schema m, pragma_table_info(m.name) c
		WHERE m.type = 'table' AND (c.name = 'email' OR c.name LIKE '%\_email' ESCAPE '\' OR c.name LIKE '%addr%')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var table, column string
		if err := rows.Scan(&table, &column); err != nil {
			t.Fatal(err)
		}
		n++
		if table == "users" {
			continue
		}
		cleared := regexp.MustCompile(`DELETE FROM ` + table + ` WHERE [^` + "`" + `]*\b` + column + `\b`)
		if !cleared.MatchString(deletion.String()) {
			t.Errorf("%s.%s holds an address, and deleting its player doesn't clear it: add it to remove (account.go)",
				table, column)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if n < 2 {
		t.Fatalf("%d address columns found: the query no longer reads the schema", n)
	}
}
