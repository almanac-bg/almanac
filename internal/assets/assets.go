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

// ManifestFile maps each entry point to the file the build gave it (app.js → assets/app-3F2A9C.js).
const ManifestFile = "manifest.json"

// Manifest reads the build's manifest; empty if the client hasn't been built.
func Manifest(fsys fs.FS) map[string]string {
	m := map[string]string{}
	if data, err := fs.ReadFile(fsys, ManifestFile); err == nil {
		_ = json.Unmarshal(data, &m)
	}
	return m
}
