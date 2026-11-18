package server

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strings"
	"testing"
)

// A limit by address counts the request's network and its site together (allowFrom, guardFrom): counted by network
// alone, one /48 (or /24) is a thousand networks, each with a budget of its own. So a key built from the request's
// address (clientNet, clientIP, clientSite) never goes to a limiter's allow by hand, outside address.go, where from
// does it for them.
func TestLimitsByAddressCountTheSite(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") || name == "address.go" {
			continue
		}
		f, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "allow" || len(call.Args) == 0 {
				return true
			}
			ast.Inspect(call.Args[0], func(m ast.Node) bool {
				if c, ok := m.(*ast.CallExpr); ok {
					if s, ok := c.Fun.(*ast.SelectorExpr); ok {
						switch s.Sel.Name {
						case "clientNet", "clientIP", "clientSite":
							t.Errorf("%s: a limit keyed by the request's address (%s) by hand: use allowFrom or guardFrom, which count its site too",
								fset.Position(call.Pos()), s.Sel.Name)
						}
					}
				}
				return true
			})
			return true
		})
	}
}
