// Command build turns the web client (web/) into the files the server serves (internal/assets/dist): the first
// client's script and stylesheet (app.js, app.css: every screen, the illustrations and the game's feel in one file)
// and the fonts, all minified and named by their content, each
// script and stylesheet beside a copy compressed ahead (brotli at its best, and gzip: the server sends the one the
// browser takes), plus web/public as it is. It writes a manifest of what each became (app.js → assets/app-3F2A9C.js;
// a font by its own name, sofia-sans.woff2 → assets/sofia-sans-7C1D0E.woff2), says how big each is as a browser
// gets it, and fails past two lines: the first screen's budget (what every visit after a release downloads before
// Днес draws: the player's whole client, the one size to keep in mind) and the fonts' ceiling, a guard against an
// accident (a font's whole alphabet built in), not a limit to write around.
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

// firstScreen is how big, brotli-compressed as it's sent, what Днес needs before it draws may be: firstFiles and the
// fonts the page preloads (assets.FirstFonts). Every daily player downloads it again after each release. About 137 kB
// in November 2026, 60 of them the two fonts (each cached until it changes).
//
// Raised once, from 136 kB, by what one file costs (10 kB), on 25 November 2026: until then the screens a daily visit
// doesn't open (Алманах, Приятели, Профил…) and the pictures loaded as files of their own, kept off this budget by a
// hand-kept registry of what each used (a new screen touched six places, and nothing could be shared with app.js).
// Timed cold before and after, all the split saved was 46 ms of a 2-second first paint on slow 4G and 10 ms on a fair
// line: one file is worth that. Past the budget, find what grew; don't split the client again to make room.
const firstScreen = 146 << 10

// firstFiles are the script and style Днес draws with: the whole client's.
var firstFiles = []string{"app.js", "app.css"}

// fontCeiling is how big the fonts a page of Bulgarian may need together may grow: each face's first file (the
// second, <face>-rest, loads only where a letter of another language shows: web/src/fonts/subset.sh). Two faces
// since the bright almanac (Sofia Sans and its Extra Condensed numerals): about 60 kB in November 2026.
const fontCeiling = 80 << 10

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
		EntryPoints: []string{"web/src/app.ts", "web/src/app.css", "web/src/admin.css"},
		Outdir:      filepath.Join(out, "assets"),
		Bundle:      true,
		Write:       true,
		Metafile:    true,
		Format:      api.FormatESModule,
		Splitting:   false, // one file: every screen in app.js
		Target:      api.ES2022,
		// The oldest browsers the game is for: what it uses (CSS, JS, the DOM) must be in all three, held by
		// web/src/engines.test.ts for what tsc can't see.
		Engines:       []api.Engine{{Name: api.EngineChrome, Version: "111"}, {Name: api.EngineFirefox, Version: "121"}, {Name: api.EngineSafari, Version: "16.4"}},
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

// writeManifest records which file each entry became (app.js → assets/app-3F2A9C.js) and each font (sofia-sans.woff2 → assets/sofia-sans-7C1D0E.woff2).
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
	first, fonts := 0, 0
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
		if filepath.Ext(name) == ".woff2" && !strings.HasSuffix(name, "-rest.woff2") {
			fonts += n
		}
		if slices.Contains(firstFiles, name) || slices.Contains(assets.FirstFonts, name) {
			first += n
		}
	}
	fmt.Printf("%-38s %s as sent (budget %d kB)\n", "the first screen", kb(first), firstScreen>>10)
	fmt.Printf("%-38s %s (ceiling %d kB)\n", "fonts for Bulgarian", kb(fonts), fontCeiling>>10)
	for _, f := range assets.FirstFonts {
		if manifest[f] == "" {
			return fmt.Errorf("the page preloads %s (assets.FirstFonts), but no style uses it", f)
		}
	}
	for _, f := range firstFiles {
		if manifest[f] == "" {
			return fmt.Errorf("the first screen counts %s (firstFiles), but the build made none: name what it is now", f)
		}
	}
	switch {
	case first > firstScreen:
		return fmt.Errorf("the first screen is %d kB as sent, past its budget of %d kB: find what grew, and what it's worth to every player", first>>10, firstScreen>>10)
	case fonts > fontCeiling:
		return fmt.Errorf("the fonts for Bulgarian are %d kB, past their ceiling of %d kB: cut them to what the texts use (web/src/fonts/subset.sh)", fonts>>10, fontCeiling>>10)
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
