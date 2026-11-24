// Package assets holds the built web client (go run ./cmd/build writes it into dist/), inside the program itself:
// deploying the game is copying one file.
package assets

import (
	"embed"
	"encoding/json"
	"io/fs"
	"os"
)

//go:embed all:dist
var embedded embed.FS

// Dir is where the build writes, relative to the repository root.
const Dir = "internal/assets/dist"

// FS is the built client: read from disk in development, so a rebuild shows without restarting the server, and from
// the program otherwise.
func FS(dev bool) fs.FS {
	if dev {
		return os.DirFS(Dir)
	}
	sub, _ := fs.Sub(embedded, "dist")
	return sub
}

// ManifestFile maps each entry point to the file the build gave it (app.js → assets/app-3F2A9C.js), a screen loaded on
// its own by its file's name (settings.js), and each font by its own (sofia-sans.woff2).
const ManifestFile = "manifest.json"

// FirstFonts are the fonts the first paint of any page draws in, which the page asks for at once (server/pages.go),
// before its style says it needs them; the rest load as text in them shows. Днес's first paint has both: the text, and
// the cover's big date in the narrow numerals, which, asked for only once drawn, came 0.4 s after it and jumped from
// wide to narrow. cmd/build counts them in the first screen's budget.
var FirstFonts = []string{"sofia-sans.woff2", "sofia-sans-extra-condensed.woff2"}

// FirstScripts are the scripts every page loads as it starts besides the app's own (app.js), each a file of its own:
// the pictures (the cover's ten glyphs are theirs). The page asks for them at once (server/pages.go), beside the app,
// not only once the app has run and sent for them; cmd/build counts them in the first screen's budget.
var FirstScripts = []string{"pictures.js"}

// Manifest reads the build's manifest; empty if the client hasn't been built.
func Manifest(fsys fs.FS) map[string]string {
	m := map[string]string{}
	if data, err := fs.ReadFile(fsys, ManifestFile); err == nil {
		_ = json.Unmarshal(data, &m)
	}
	return m
}
