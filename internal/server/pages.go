package server

import (
	"bytes"
	"encoding/json"
	"html/template"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/almanac-bg/almanac/internal/assets"
	"github.com/almanac-bg/almanac/internal/bank"
)

// The app is one page: the server sends it for every path the app knows (and a 404 with it for the rest, which the
// app shows as such), with what it needs to start in it, so it draws at once without asking for anything.
var appPaths = []*regexp.Regexp{
	regexp.MustCompile(`^/$`),
	regexp.MustCompile(`^/play(/[a-z]+)?$`),
	regexp.MustCompile(`^/me$`),
}

var shell = template.Must(template.New("shell").Parse(`<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>АЛМАНАХ</title>
<meta name="description" content="Десет въпроса на ден, игра по теми и предизвикателства към приятели. Всеки отговор носи по нещо ново.">
<meta name="theme-color" content="#f6f3ec" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#140f26" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
{{if .CSS}}<link rel="stylesheet" href="/{{.CSS}}">{{end}}
{{if .JS}}<script type="module" src="/{{.JS}}"></script>{{end}}
<script type="application/json" id="boot">{{.Boot}}</script>
</head>
<body>
<div id="app">{{if not .JS}}<p style="padding:2rem;font-family:system-ui">The client isn't built: go run ./cmd/build</p>{{end}}</div>
<noscript><p>АЛМАНАХ има нужда от JavaScript.</p></noscript>
</body>
</html>
`))

func (s *Server) page(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	status := http.StatusNotFound
	for _, p := range appPaths {
		if p.MatchString(r.URL.Path) {
			status = http.StatusOK
		}
	}
	u, err := s.user(r)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	b := s.bank.Load()
	boot, _ := json.Marshal(map[string]any{ // escapes <, > and &: safe inside the script element
		"user":       u,
		"categories": b.Categories,
		"version":    s.cfg.Version,
	})
	m := assets.Manifest(s.client)
	var out bytes.Buffer
	if err := shell.Execute(&out, map[string]any{
		"CSS": m["app.css"], "JS": m["app.js"], "Boot": template.JS(boot),
	}); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	w.WriteHeader(status)
	_, _ = w.Write(out.Bytes())
}

// asset serves the client's built files. Their names change with their content, so they're cached for good.
func (s *Server) asset(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Dev {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	serveFile(w, r, s.client, path.Join("assets", r.PathValue("file")))
}

// publicFiles are served from the site's root as they are (web/public).
var publicFiles = []string{"favicon.svg", "bimi.svg", "robots.txt", "manifest.webmanifest"}

func (s *Server) publicFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=3600")
	serveFile(w, r, s.client, strings.TrimPrefix(r.URL.Path, "/"))
}

var pictureName = regexp.MustCompile(`^[0-9a-f]{16}(-600)?\.webp$`)

// picture serves a question's picture. Names are hashes of the content: cached for good.
func (s *Server) picture(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if !pictureName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	serveFile(w, r, os.DirFS(filepath.Join(s.bank.Load().Dir, bank.ImagesDir)), name)
}

func serveFile(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) {
	if !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}
	if _, err := fs.Stat(fsys, name); err != nil {
		w.Header().Del("Cache-Control")
		http.NotFound(w, r)
		return
	}
	http.ServeFileFS(w, r, fsys, name)
}
