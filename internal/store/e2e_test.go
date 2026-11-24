package store_test

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/store/storetest"
)

// The browser tests write straight into the test server's database (e2e/play.ts): every statement they prepare must
// prepare against the schema of today, or a migration that renames or drops a column they use breaks them only after
// the merge, on main. Each prepare's statement is a string written in place, or factsRule (play.factsRule's text:
// TestE2EFactsRule); anything else is one this test can't read, and fails it.
func TestE2EStatementsPrepare(t *testing.T) {
	src, err := os.ReadFile("../../e2e/play.ts")
	if err != nil {
		t.Fatal(err)
	}
	text := string(src)
	_, after, _ := strings.Cut(text, "const factsRule = `")
	factsRule, _, ok := strings.Cut(after, "`;")
	if !ok {
		t.Fatal("e2e/play.ts has no factsRule")
	}
	db := storetest.Open(t)
	literal := regexp.MustCompile("^\\s*(`[^`]*`|\"[^\"]*\")")
	parts := strings.Split(text, ".prepare(")[1:]
	if len(parts) == 0 {
		t.Fatal("no statements found in e2e/play.ts")
	}
	for _, p := range parts {
		var q string
		if m := literal.FindStringSubmatch(p); m != nil {
			q = m[1][1 : len(m[1])-1]
		} else if strings.HasPrefix(strings.TrimSpace(p), "factsRule)") {
			q = factsRule
		} else {
			t.Fatalf("a statement this test can't read: .prepare(%.60s", p)
		}
		stmt, err := db.Write.Prepare(q)
		if err != nil {
			t.Errorf("%v:\n%s", err, q)
			continue
		}
		stmt.Close()
	}
}
