package safe

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// unguarded are the goroutines started outside this package that may run without it, each with why it can't panic or
// is stopped elsewhere: "<file>: <the goroutine's call>".
var unguarded = map[string]string{
	"internal/server/server.go: func() { errs <- srv.Serve(ln) }()": "net/http stops a handler's panic itself; Serve " +
		"doesn't panic",
}

// Every goroutine the program starts runs through this package (its doc): a `go` statement, or a WaitGroup's Go,
// outside it either calls into it (go safe.Loop(…)), or runs a body that does (defer safe.Recover, safe.Do), its own
// or that of the function it names; or it's one of unguarded, with the reason. A panic anywhere else ends the server
// and every game in it.
func TestGoroutinesGuarded(t *testing.T) {
	root := filepath.Join("..", "..")
	type pkg struct {
		files map[string]*ast.File
		funcs map[string][]*ast.FuncDecl // by name, methods and functions alike
	}
	pkgs := map[string]*pkg{}
	fset := token.NewFileSet()
	sources := map[string][]byte{}
	for _, dir := range []string{"internal", "cmd"} {
		err := filepath.WalkDir(filepath.Join(root, dir), func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return err
			}
			rel, _ := filepath.Rel(root, path)
			rel = filepath.ToSlash(rel)
			if filepath.Dir(rel) == "internal/safe" {
				return nil
			}
			src, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			f, err := parser.ParseFile(fset, rel, src, parser.SkipObjectResolution)
			if err != nil {
				return err
			}
			sources[rel] = src
			p := pkgs[filepath.Dir(rel)]
			if p == nil {
				p = &pkg{files: map[string]*ast.File{}, funcs: map[string][]*ast.FuncDecl{}}
				pkgs[filepath.Dir(rel)] = p
			}
			p.files[rel] = f
			for _, decl := range f.Decls {
				if fn, ok := decl.(*ast.FuncDecl); ok && fn.Body != nil {
					p.funcs[fn.Name.Name] = append(p.funcs[fn.Name.Name], fn)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	// callsSafe says whether n calls into this package, not counting the bodies of functions written in it.
	callsSafe := func(n ast.Node) bool {
		found := false
		ast.Inspect(n, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.FuncLit:
				return false
			case *ast.CallExpr:
				if sel, ok := n.Fun.(*ast.SelectorExpr); ok {
					if x, ok := sel.X.(*ast.Ident); ok && x.Name == "safe" {
						found = true
					}
				}
			}
			return !found
		})
		return found
	}
	// guarded says whether a goroutine's body runs through this package: a statement of its own calls into it.
	guarded := func(body *ast.BlockStmt) bool {
		for _, stmt := range body.List {
			if callsSafe(stmt) {
				return true
			}
		}
		return false
	}
	// runs says whether the function a goroutine runs is guarded: a literal, or one of the package's by name.
	runs := func(p *pkg, fn ast.Expr) bool {
		switch fn := fn.(type) {
		case *ast.FuncLit:
			return guarded(fn.Body)
		case *ast.SelectorExpr:
			if x, ok := fn.X.(*ast.Ident); ok && x.Name == "safe" {
				return true
			}
			fn2 := p.funcs[fn.Sel.Name]
			return len(fn2) > 0 && guarded(fn2[0].Body)
		case *ast.Ident:
			fn2 := p.funcs[fn.Name]
			return len(fn2) > 0 && guarded(fn2[0].Body)
		}
		return false
	}

	seen := map[string]bool{}
	for _, p := range pkgs {
		for name, f := range p.files {
			ast.Inspect(f, func(n ast.Node) bool {
				var call ast.Node
				ok := true
				switch n := n.(type) {
				case *ast.GoStmt:
					call = n.Call
					if fl, isLit := n.Call.Fun.(*ast.FuncLit); isLit {
						ok = guarded(fl.Body)
					} else if sel, isSel := n.Call.Fun.(*ast.SelectorExpr); isSel && isSafe(sel) {
						ok = true
					} else {
						ok = runs(p, n.Call.Fun)
					}
				case *ast.CallExpr: // a WaitGroup's Go (an errgroup's too)
					sel, isSel := n.Fun.(*ast.SelectorExpr)
					if !isSel || sel.Sel.Name != "Go" || isSafe(sel) || len(n.Args) != 1 {
						return true
					}
					call, ok = n.Args[0], runs(p, n.Args[0])
				default:
					return true
				}
				if ok {
					return true
				}
				src := sources[name][fset.Position(call.Pos()).Offset:fset.Position(call.End()).Offset]
				key := name + ": " + strings.Join(strings.Fields(string(src)), " ")
				if _, allowed := unguarded[key]; allowed {
					seen[key] = true
					return true
				}
				t.Errorf("%s: a goroutine outside package safe: run it through it (safe.Go, safe.Do, defer "+
					"safe.Recover), or add it to unguarded with why it can't panic\n\t%s", fset.Position(call.Pos()), key)
				return true
			})
		}
	}
	for key := range unguarded {
		if !seen[key] {
			t.Errorf("unguarded names a goroutine that's gone, or guarded now: %s", key)
		}
	}
}

func isSafe(sel *ast.SelectorExpr) bool {
	x, ok := sel.X.(*ast.Ident)
	return ok && x.Name == "safe"
}
