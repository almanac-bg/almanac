package server

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"regexp/syntax"
	"strings"
	"testing"
)

// The client's router (web/src/app.ts) and appPaths are two lists of the same paths: one draws a screen for a path, the
// other sends the app for it. A path only the client knows is a 404 on a reload or a shared link; one only the server
// knows is a page with nothing on it. Each path of either list must be a path of the other.
func TestAppPathsMatchTheClient(t *testing.T) {
	src, err := os.ReadFile("../../web/src/app.ts")
	if err != nil {
		t.Fatal(err)
	}
	var client []*regexp.Regexp
	for _, m := range regexp.MustCompile(`\{ path: /(.+?)/, view:`).FindAllStringSubmatch(string(src), -1) {
		client = append(client, regexp.MustCompile(m[1]))
	}
	if len(client) < 10 {
		t.Fatalf("found %d routes in app.ts: has the router's table changed shape? Change this test with it", len(client))
	}
	matchesAny := func(list []*regexp.Regexp, path string) bool {
		for _, re := range list {
			if re.MatchString(path) {
				return true
			}
		}
		return false
	}
	for _, re := range client {
		if p := example(t, re); !matchesAny(appPaths, p) {
			t.Errorf("the client has %s (e.g. %s), which the server doesn't send the app for: add it to appPaths in pages.go", re, p)
		}
	}
	for _, re := range appPaths {
		if p := example(t, re); !matchesAny(client, p) {
			t.Errorf("appPaths has %s (e.g. %s), which no screen of the client draws: remove it, or add the screen", re, p)
		}
	}
}

// example is the shortest path a pattern matches, made of the first thing each part allows.
func example(t *testing.T, re *regexp.Regexp) string {
	t.Helper()
	tree, err := syntax.Parse(re.String(), syntax.Perl)
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	var walk func(*syntax.Regexp)
	walk = func(r *syntax.Regexp) {
		switch r.Op {
		case syntax.OpLiteral:
			b.WriteString(string(r.Rune))
		case syntax.OpCharClass:
			b.WriteRune(r.Rune[0])
		case syntax.OpCapture, syntax.OpConcat:
			for _, s := range r.Sub {
				walk(s)
			}
		case syntax.OpAlternate:
			walk(r.Sub[0])
		case syntax.OpPlus:
			walk(r.Sub[0])
		case syntax.OpRepeat:
			for range max(r.Min, 1) {
				walk(r.Sub[0])
			}
		case syntax.OpStar, syntax.OpQuest, syntax.OpBeginText, syntax.OpEndText, syntax.OpBeginLine, syntax.OpEndLine:
		default:
			t.Fatalf("%s: example doesn't know %v; teach it", re, r.Op)
		}
	}
	walk(tree)
	return b.String()
}

// The client calls the API by paths written by hand (api("GET", "/api/day"), a stream, a picture's src), and the
// server's routes (routes, in server.go) are another list of the same paths: a call to a path the server doesn't have,
// or with a method it doesn't take there, is a 404 or a 405 found only once it's live. Each of the client's calls must
// be one of the server's routes: by its method where the call says it ("GET" before the path, or "POST" : "DELETE"),
// by any method where it doesn't (a stream, a picture, a fetch). A part of a path the client fills in (`${id}`) stands
// for a segment; what it adds after one (`${rematch ? "?…" : ""}`), and a query, are left out.
func TestAPIPathsMatchTheServer(t *testing.T) {
	src, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	routes := 0
	for _, m := range regexp.MustCompile(`(?:\bapi|mux\.Handle(?:Func)?)\("((?:GET|POST|PATCH|DELETE) /api/[^"]*)"`).
		FindAllStringSubmatch(string(src), -1) {
		mux.HandleFunc(m[1], func(http.ResponseWriter, *http.Request) {})
		routes++
	}
	if routes < 50 {
		t.Fatalf("found %d API routes in server.go: has the way routes are made changed? Change this test with it", routes)
	}

	calls := clientCalls(t)
	if len(calls) < 80 {
		t.Fatalf("found %d API calls in web/src: has the way the client calls the API changed? Change this test with it", len(calls))
	}
	for _, c := range calls {
		methods := c.methods
		if len(methods) == 0 {
			methods = []string{"GET", "POST", "PATCH", "DELETE"}
		}
		found := false
		for _, m := range methods {
			_, pattern := mux.Handler(httptest.NewRequest(m, c.path, nil))
			ok := pattern != ""
			if len(c.methods) > 0 && !ok {
				t.Errorf("%s: %s %s is no route of the server's (server.go, routes)", c.where, m, c.path)
			}
			found = found || ok
		}
		if len(c.methods) == 0 && !found {
			t.Errorf("%s: %s is no route of the server's, by any method (server.go, routes)", c.where, c.path)
		}
	}
}

// apiCall is a call of the client's to the API: where it is, its path (each part filled in as "1"), and its methods
// (none: the call doesn't say them beside the path).
type apiCall struct {
	where, path string
	methods     []string
}

var (
	oneMethod  = regexp.MustCompile(`"(GET|POST|PATCH|DELETE)"\s*,\s*$`)
	twoMethods = regexp.MustCompile(`"(GET|POST|PATCH|DELETE)"\s*:\s*"(GET|POST|PATCH|DELETE)"\s*,\s*$`)
)

// clientCalls finds every path of the API's written in the client's code (web/src, its tests left out).
func clientCalls(t *testing.T) []apiCall {
	t.Helper()
	var calls []apiCall
	root := "../../web/src"
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".ts") || strings.HasSuffix(path, ".test.ts") {
			return err
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		src := string(b)
		for i := 0; ; {
			at := strings.Index(src[i:], "/api/")
			if at < 0 {
				break
			}
			at += i
			i = at + 1
			if at == 0 || (src[at-1] != '"' && src[at-1] != '`') {
				continue // not where a string starts: a comment's words, a path inside another
			}
			p, ok := literalPath(src[at-1:])
			if !ok {
				t.Errorf("%s: a path of the API's this test can't read; teach literalPath", path)
				continue
			}
			c := apiCall{where: filepath.ToSlash(strings.TrimPrefix(path, root+"/")), path: p}
			before := src[max(0, at-1-120) : at-1]
			if m := twoMethods.FindStringSubmatch(before); m != nil {
				c.methods = []string{m[1], m[2]}
			} else if m := oneMethod.FindStringSubmatch(before); m != nil {
				c.methods = []string{m[1]}
			}
			calls = append(calls, c)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return calls
}

// literalPath reads the string (in quotes) or template (in backticks) that s starts with, as a path: a part filled in
// that is a segment of its own (after a "/") as "1"; one that adds to a segment, and a query, left out.
func literalPath(s string) (string, bool) {
	quote := s[0]
	var b strings.Builder
	for i := 1; i < len(s); i++ {
		switch {
		case s[i] == quote:
			p, _, _ := strings.Cut(b.String(), "?")
			return p, true
		case quote == '`' && strings.HasPrefix(s[i:], "${"):
			depth, j := 0, i+1
			for ; j < len(s); j++ {
				if s[j] == '{' {
					depth++
				} else if s[j] == '}' {
					if depth--; depth == 0 {
						break
					}
				}
			}
			if j == len(s) {
				return "", false
			}
			if strings.HasSuffix(b.String(), "/") {
				b.WriteString("1")
			}
			i = j
		case s[i] == '\n':
			return "", false
		default:
			b.WriteByte(s[i])
		}
	}
	return "", false
}
