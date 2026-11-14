// Command build turns the web client (web/) into the files the server serves (internal/assets/dist): one script and
// one stylesheet, minified, the illustrations as a script of their own (loaded after the game starts), and the fonts,
// all named by their content, plus web/public as it is. It fails if any outgrows its budget: the game must stay light.
//
//	go run ./cmd/build           a release build
//	go run ./cmd/build -watch    rebuild on every change (with DEV=1 on the server)
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"

	"github.com/almanac-bg/almanac/internal/assets"
)

// Budgets, gzipped: what a player downloads the first time.
// The budgets grew with the game, from one quiz to a platform (five places, medals and emblems drawn in code, seven
// kinds of question, weekly leagues, a second chance, a year's look back): still small enough to arrive at once on a
// slow phone. The illustrations (avatars, topics, modes, frames, leagues) come after the first screen, on their own.
var budgets = map[string]int{"app.js": 46 << 10, "app.css": 15 << 10, "pictures.js": 24 << 10}

func main() {
	watch := flag.Bool("watch", false, "rebuild on every change")
	flag.Parse()
	if err := build(*watch); err != nil {
		fmt.Fprintln(os.Stderr, "build:", err)
		os.Exit(1)
	}
}

func build(watch bool) error {
	out := assets.Dir
	if err := os.RemoveAll(filepath.Join(out, "assets")); err != nil {
		return err
	}
	if err := copyPublic("web/public", out); err != nil {
		return err
	}
	opts := api.BuildOptions{
		EntryPoints:   []string{"web/src/app.ts", "web/src/app.css"},
		Outdir:        filepath.Join(out, "assets"),
		Bundle:        true,
		Write:         true,
		Metafile:      true,
		Format:        api.FormatESModule,
		Splitting:     true, // the illustrations (web/src/art/pictures.ts) load as a file of their own
		Target:        api.ES2022,
		Engines:       []api.Engine{{Name: api.EngineChrome, Version: "111"}, {Name: api.EngineFirefox, Version: "115"}, {Name: api.EngineSafari, Version: "16.4"}},
		Charset:       api.CharsetUTF8,
		LegalComments: api.LegalCommentsNone,
		Sourcemap:     api.SourceMapLinked,
		Loader:        map[string]api.Loader{".woff2": api.LoaderFile}, // the fonts: files of their own, named by content
		LogLevel:      api.LogLevelWarning,
	}
	if watch {
		// Fixed names while developing: the server reads files from disk and sends them uncached.
		opts.EntryNames = "[name]"
		opts.Plugins = []api.Plugin{{Name: "manifest", Setup: func(b api.PluginBuild) {
			b.OnEnd(func(r *api.BuildResult) (api.OnEndResult, error) {
				if len(r.Errors) == 0 {
					_ = writeManifest(out, r.Metafile)
					fmt.Println("built")
				}
				return api.OnEndResult{}, nil
			})
		}}}
		ctx, cerr := api.Context(opts)
		if cerr != nil {
			return errors.New(cerr.Errors[0].Text)
		}
		if err := ctx.Watch(api.WatchOptions{}); err != nil {
			return err
		}
		fmt.Println("watching web/ (ctrl-c to stop)")
		select {}
	}
	opts.EntryNames = "[name]-[hash]"
	opts.MinifyWhitespace, opts.MinifySyntax, opts.MinifyIdentifiers = true, true, true
	r := api.Build(opts)
	if len(r.Errors) > 0 {
		return fmt.Errorf("%d errors", len(r.Errors))
	}
	if err := writeManifest(out, r.Metafile); err != nil {
		return err
	}
	return checkBudgets(out)
}

// writeManifest records which file each entry became (app.js → assets/app-3F2A9C.js).
func writeManifest(out, metafile string) error {
	var meta struct {
		Outputs map[string]struct {
			EntryPoint string `json:"entryPoint"`
		} `json:"outputs"`
	}
	if err := json.Unmarshal([]byte(metafile), &meta); err != nil {
		return err
	}
	manifest := map[string]string{}
	for file, o := range meta.Outputs {
		if o.EntryPoint == "" {
			continue
		}
		rel, err := filepath.Rel(out, file)
		if err != nil {
			return err
		}
		name := strings.TrimSuffix(filepath.Base(o.EntryPoint), filepath.Ext(o.EntryPoint))
		manifest[name+filepath.Ext(file)] = filepath.ToSlash(rel)
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(out, assets.ManifestFile), data, 0o644)
}

func checkBudgets(out string) error {
	data, err := os.ReadFile(filepath.Join(out, assets.ManifestFile))
	if err != nil {
		return err
	}
	var manifest map[string]string
	if err := json.Unmarshal(data, &manifest); err != nil {
		return err
	}
	var over []string
	for name, budget := range budgets {
		body, err := os.ReadFile(filepath.Join(out, manifest[name]))
		if err != nil {
			return err
		}
		var gz bytes.Buffer
		w, _ := gzip.NewWriterLevel(&gz, gzip.BestCompression)
		_, _ = w.Write(body)
		_ = w.Close()
		fmt.Printf("%-8s %6.1f kB, %5.1f kB gzipped (budget %d kB)\n", name, float64(len(body))/1024, float64(gz.Len())/1024, budget>>10)
		if gz.Len() > budget {
			over = append(over, name)
		}
	}
	if len(over) > 0 {
		return fmt.Errorf("over budget: %s", strings.Join(over, ", "))
	}
	return nil
}

// copyPublic copies web/public into the output as it is.
func copyPublic(from, to string) error {
	return filepath.WalkDir(from, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(from, path)
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		dst := filepath.Join(to, rel)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		return os.WriteFile(dst, data, 0o644)
	})
}
