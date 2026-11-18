// Command build turns the web client (web/) into the files the server serves (internal/assets/dist): the first
// screen's script and stylesheet (app.js, app.css), every screen a daily visit doesn't open as a script of its own
// (web/src/kit.ts), the illustrations, the game's feel, and the fonts, all minified and named by their content, each
// script and stylesheet beside a copy compressed ahead (brotli at its best, and gzip: the server sends the one the
// browser takes), plus web/public as it is. It writes a manifest of what each became (app.js → assets/app-3F2A9C.js;
// a font by its own name, sofia-sans.woff2 → assets/sofia-sans-7C1D0E.woff2), says how big each is as a browser
// gets it, and fails past three lines: the first screen's budget (what every visit after a release downloads before
// Начало draws), the fonts' ceiling and the whole client's. The ceilings are guards against an accident (a library
// pulled in, data built into the code), not limits to write around; the budget is the one to keep in mind.
//
// A release has no source maps: nobody but a developer reads one, and the build is the same from the same commit (to
// read a stack from production, build its release's commit with -maps: the files and their names come out the same).
//
//	go run ./cmd/build           a release build
//	go run ./cmd/build -maps     a release build with its source maps beside it (not for a release)
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

	"github.com/andybalholm/brotli"
	"github.com/evanw/esbuild/pkg/api"

	"github.com/almanac-bg/almanac/internal/assets"
)

// firstScreen is how big, brotli-compressed as it's sent, what Начало needs before it draws may be: app.js, app.css
// and the fonts the page preloads (assets.FirstFonts). Every daily player downloads it again after each release. A
// screen a daily visit doesn't open loads on its own (web/src/kit.ts) and doesn't count here.
const firstScreen = 110 << 10

// fontCeiling is how big the fonts a page of Bulgarian may need together may grow: each family's first file (the
// second, <family>-rest, loads only where a letter of another language shows: web/src/fonts/subset.sh).
const fontCeiling = 100 << 10

// ceiling is how big, brotli-compressed, every script and stylesheet together may grow: about two and a half times the
// game in November 2026. Growing with the game never reaches it; something pulled in by mistake does. Past it, find
// what grew; raise it only for something worth that much to every player.
const ceiling = 256 << 10

func main() {
	watch := flag.Bool("watch", false, "rebuild on every change")
	sourceMaps := flag.Bool("maps", false, "write source maps beside the files")
	flag.Parse()
	if err := build(*watch, *sourceMaps); err != nil {
		fmt.Fprintln(os.Stderr, "build:", err)
		os.Exit(1)
	}
}

func build(watch, sourceMaps bool) error {
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
		Splitting:     true, // each import() a file of its own
		Target:        api.ES2022,
		Engines:       []api.Engine{{Name: api.EngineChrome, Version: "111"}, {Name: api.EngineFirefox, Version: "115"}, {Name: api.EngineSafari, Version: "16.4"}},
		Charset:       api.CharsetUTF8,
		LegalComments: api.LegalCommentsNone,
		Loader:        map[string]api.Loader{".woff2": api.LoaderFile}, // the fonts: files of their own, named by content
		LogLevel:      api.LogLevelWarning,
	}
	if watch {
		// Fixed names while developing: the server reads files from disk and sends them uncached.
		opts.EntryNames = "[name]"
		opts.Sourcemap = api.SourceMapLinked
		opts.Plugins = []api.Plugin{{Name: "manifest", Setup: func(b api.PluginBuild) {
			b.OnEnd(func(r *api.BuildResult) (api.OnEndResult, error) {
				if len(r.Errors) == 0 {
					if err := writeManifest(out, r.Metafile); err != nil {
						fmt.Fprintln(os.Stderr, "build:", err)
					}
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
	if sourceMaps {
		opts.Sourcemap = api.SourceMapLinked
	}
	r := api.Build(opts)
	if len(r.Errors) > 0 {
		return fmt.Errorf("%d errors", len(r.Errors))
	}
	if p := os.Getenv("BUILD_META"); p != "" { // esbuild's account of what went where, for a closer look
		if err := os.WriteFile(p, []byte(r.Metafile), 0o644); err != nil {
			return err
		}
	}
	if err := writeManifest(out, r.Metafile); err != nil {
		return err
	}
	if err := compress(out); err != nil {
		return err
	}
	return checkSize(out)
}

// writeManifest records which file each entry became (app.js → assets/app-3F2A9C.js; a screen loaded on its own by
// its file's name, settings.js) and each font (sofia-sans.woff2 → assets/sofia-sans-7C1D0E.woff2).
func writeManifest(out, metafile string) error {
	var meta struct {
		Outputs map[string]struct {
			EntryPoint string                    `json:"entryPoint"`
			Inputs     map[string]map[string]any `json:"inputs"`
		} `json:"outputs"`
	}
	if err := json.Unmarshal([]byte(metafile), &meta); err != nil {
		return err
	}
	manifest := map[string]string{}
	for file, o := range meta.Outputs {
		from := o.EntryPoint
		if from == "" && filepath.Ext(file) == ".woff2" && len(o.Inputs) == 1 {
			from = slices.Collect(maps.Keys(o.Inputs))[0]
		}
		if from == "" {
			continue
		}
		rel, err := filepath.Rel(out, file)
		if err != nil {
			return err
		}
		name := strings.TrimSuffix(filepath.Base(from), filepath.Ext(from)) + filepath.Ext(file)
		if was, ok := manifest[name]; ok && filepath.Ext(file) != ".map" {
			return fmt.Errorf("%s and %s would both be %s in the manifest: give one of them another name", was, rel, name)
		}
		manifest[name] = filepath.ToSlash(rel)
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(out, assets.ManifestFile), data, 0o644)
}

// compress writes each script and stylesheet's compressed copies beside it (app-3F2A9C.js.br, .gz), which the
// server sends as they are (server/pages.go): at brotli's best, which a server compressing on the fly (Cloudflare's)
// never takes the time for.
func compress(out string) error {
	files, err := filepath.Glob(filepath.Join(out, "assets", "*"))
	if err != nil {
		return err
	}
	for _, f := range files {
		if ext := filepath.Ext(f); ext != ".js" && ext != ".css" {
			continue
		}
		body, err := os.ReadFile(f)
		if err != nil {
			return err
		}
		var br, gz bytes.Buffer
		bw := brotli.NewWriterLevel(&br, brotli.BestCompression)
		gw, _ := gzip.NewWriterLevel(&gz, gzip.BestCompression)
		for _, w := range []interface {
			Write([]byte) (int, error)
			Close() error
		}{bw, gw} {
			if _, err := w.Write(body); err != nil {
				return err
			}
			if err := w.Close(); err != nil {
				return err
			}
		}
		if err := os.WriteFile(f+".br", br.Bytes(), 0o644); err != nil {
			return err
		}
		if err := os.WriteFile(f+".gz", gz.Bytes(), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// sent is how many bytes a browser gets for one of the client's files: its brotli copy, or the file itself (a font,
// compressed already).
func sent(out, file string) (int, error) {
	if info, err := os.Stat(filepath.Join(out, file+".br")); err == nil {
		return int(info.Size()), nil
	}
	info, err := os.Stat(filepath.Join(out, file))
	if err != nil {
		return 0, err
	}
	return int(info.Size()), nil
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
	kb := func(n int) string { return fmt.Sprintf("%5.1f kB", float64(n)/1024) }
	names := slices.Sorted(maps.Keys(manifest))
	first, fonts, all := 0, 0, 0
	for _, name := range names {
		n, err := sent(out, manifest[name])
		if err != nil {
			return err
		}
		raw, err := os.Stat(filepath.Join(out, manifest[name]))
		if err != nil {
			return err
		}
		fmt.Printf("%-38s %s, %s as sent\n", name, kb(int(raw.Size())), kb(n))
		if filepath.Ext(name) == ".woff2" {
			if !strings.HasSuffix(name, "-rest.woff2") {
				fonts += n
			}
		} else {
			all += n
		}
		if name == "app.js" || name == "app.css" || slices.Contains(assets.FirstFonts, name) {
			first += n
		}
	}
	fmt.Printf("%-38s %s as sent (budget %d kB)\n", "the first screen", kb(first), firstScreen>>10)
	fmt.Printf("%-38s %s (ceiling %d kB)\n", "fonts for Bulgarian", kb(fonts), fontCeiling>>10)
	fmt.Printf("%-38s %s as sent (ceiling %d kB)\n", "scripts and styles", kb(all), ceiling>>10)
	for _, f := range assets.FirstFonts {
		if manifest[f] == "" {
			return fmt.Errorf("the page preloads %s (assets.FirstFonts), but no style uses it", f)
		}
	}
	switch {
	case first > firstScreen:
		return fmt.Errorf("the first screen is %d kB as sent, past its budget of %d kB: load what Начало doesn't draw on its own (web/src/kit.ts)", first>>10, firstScreen>>10)
	case fonts > fontCeiling:
		return fmt.Errorf("the fonts for Bulgarian are %d kB, past their ceiling of %d kB: cut them to what the texts use (web/src/fonts/subset.sh)", fonts>>10, fontCeiling>>10)
	case all > ceiling:
		return fmt.Errorf("the client is %d kB as sent, past its ceiling of %d kB: something grew by far more than a feature does", all>>10, ceiling>>10)
	}
	// A script that's no entry's is code a screen loaded on its own shares with app.js, split off for every page to
	// load first: the screen must take it from web/src/kit.ts instead.
	files, err := filepath.Glob(filepath.Join(out, "assets", "*.js"))
	if err != nil {
		return err
	}
	known := slices.Collect(maps.Values(manifest))
	for _, f := range files {
		if !slices.Contains(known, "assets/"+filepath.Base(f)) {
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
