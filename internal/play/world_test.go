package play

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"testing"
)

// Every game a test makes is newGame's, and no test sets a game's bank by hand: a game made otherwise isn't waited for
// as its test ends (its counts wrote into a database closed, a folder removed: TestRelabelPaysAsShown), and Game.Bank
// set while the game's background work reads it is a race (TestGradedAsShown). Both turned main's checks red.
func TestGamesMadeByTheWorld(t *testing.T) {
	files, _ := filepath.Glob("*_test.go")
	fset := token.NewFileSet()
	for _, name := range files {
		f, err := parser.ParseFile(fset, name, nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(f, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.FuncDecl:
				return n.Name.Name != "newGame"
			case *ast.CompositeLit:
				if id, ok := n.Type.(*ast.Ident); ok && id.Name == "Game" {
					t.Errorf("%s: a game made by hand; make it with w.newGame()", fset.Position(n.Pos()))
				}
			case *ast.AssignStmt:
				for _, l := range n.Lhs {
					if sel, ok := l.(*ast.SelectorExpr); ok && sel.Sel.Name == "Bank" {
						t.Errorf("%s: a game's bank set by hand; put one in play with w.use or w.swap", fset.Position(n.Pos()))
					}
				}
			}
			return true
		})
	}
}
