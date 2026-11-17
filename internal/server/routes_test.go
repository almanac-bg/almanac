package server

import (
	"os"
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
