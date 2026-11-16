// Command build turns the web client (web/) into the files the server serves (internal/assets/dist): one script and
// one stylesheet, minified, the illustrations as a script of their own (loaded after the game starts), and the fonts,
// all named by their content, plus web/public as it is. It says how big each is, and fails only if all of them together
// pass a ceiling far above what the game is: a guard against an accident (a library pulled in, data built into the
// code), not a limit to write around.
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
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/evanw/esbuild/pkg/api"

	"github.com/almanac-bg/almanac/internal/assets"
)

// entries are what a player can download, each when its screen needs it: the game (app.js, app.css) first; the
// illustrations (avatars, topics, modes, frames, leagues) after the first screen, on their own; a room's, Роял's and a
// live duel's screens (web/src/kit.ts) when one opens, and the style of a room's big screen (host.css) when a host leads
// one; a duel's result with its style (outcome.js, outcome.css) as a duel starts; the game's feel (web/src/feel.ts: the
// sounds' voices, the result's moment, the sheet for big news) with the first touch.
var entries = []string{"app.js", "app.css", "pictures.js", "room.js", "royal.js", "live.js", "host.css", "feel.js",
	"outcome.js", "outcome.css"}

// ceiling is how big, gzipped, all the entries together may grow: about two and a half times the game in November 2026
// (about 100 kB, the first screen's share 63). Growing with the game never reaches it; something pulled in by mistake
// does. Past it, find what grew; raise it only for something worth that much to every player.
const ceiling = 256 << 10

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
		EntryPoints:   []string{"web/src/app.ts", "web/src/app.css", "web/src/host.css", "web/src/outcome.css"},
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
	return checkSize(out)
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

func checkSize(out string) error {
	data, err := os.ReadFile(filepath.Join(out, assets.ManifestFile))
	if err != nil {
		return err
	}
	var manifest map[string]string
	if err := json.Unmarshal(data, &manifest); err != nil {
		return err
	}
	total := 0
	for _, name := range entries {
		body, err := os.ReadFile(filepath.Join(out, manifest[name]))
		if err != nil {
			return err
		}
		var gz bytes.Buffer
		w, _ := gzip.NewWriterLevel(&gz, gzip.BestCompression)
		_, _ = w.Write(body)
		_ = w.Close()
		total += gz.Len()
		fmt.Printf("%-12s %6.1f kB, %5.1f kB gzipped\n", name, float64(len(body))/1024, float64(gz.Len())/1024)
	}
	fmt.Printf("%-12s %21.1f kB gzipped (ceiling %d kB)\n", "all", float64(total)/1024, ceiling>>10)
	if total > ceiling {
		return fmt.Errorf("the client is %d kB gzipped, past its ceiling of %d kB: something grew by far more than a feature does", total>>10, ceiling>>10)
	}
	// A file that's no entry's is code a screen loaded on its own shares with app.js, split off for every page to load
	// first: the screen must take it from web/src/kit.ts instead.
	files, err := filepath.Glob(filepath.Join(out, "assets", "*.js"))
	if err != nil {
		return err
	}
	for _, f := range files {
		if !slices.Contains(slices.Collect(maps.Values(manifest)), "assets/"+filepath.Base(f)) {
			return fmt.Errorf("%s is shared by app.js and a screen of its own: hand that screen what it needs in web/src/kit.ts", filepath.Base(f))
		}
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
