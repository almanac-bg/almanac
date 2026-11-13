package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/assets"
	"github.com/almanac-bg/almanac/internal/bank"
)

// The app is one page: the server sends it for every path the app knows (and a 404 with it for the rest, which the
// app shows as such), with what it needs to start in it, so it draws at once without asking for anything.
var appPaths = []*regexp.Regexp{
	regexp.MustCompile(`^/$`),
	regexp.MustCompile(`^/play(/[a-z]+)?$`),
	regexp.MustCompile(`^/(duel|royal|room|ranks|rewards|me|friends|settings|almanac)$`),
	regexp.MustCompile(`^/duel/[0-9]{1,12}$`),
	regexp.MustCompile(`^/c/[a-z0-9]{6}$`),
	regexp.MustCompile(`^/r/[0-9]{6}$`),
	regexp.MustCompile(`^/together$`),
	regexp.MustCompile(`^/f/[a-z0-9]{8}$`),
	regexp.MustCompile(`^/players/[A-Za-z0-9_]{3,20}$`),
}

var shell = template.Must(template.New("shell").Parse(`<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>АЛМАНАХ</title>
<meta name="description" content="{{.Description}}">
<meta property="og:site_name" content="АЛМАНАХ">
<meta property="og:type" content="website">
<meta property="og:title" content="{{.Title}}">
<meta property="og:description" content="{{.Description}}">
<meta property="og:url" content="{{.URL}}">
<meta property="og:image" content="{{.Image}}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="bg_BG">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f5f3fa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#110c20" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
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
		"push":       s.pushKey(),
	})
	m := assets.Manifest(s.client)
	title, description := s.preview(r)
	var out bytes.Buffer
	if err := shell.Execute(&out, map[string]any{
		"CSS": m["app.css"], "JS": m["app.js"], "Boot": template.JS(boot),
		"Title": title, "Description": description,
		"URL": s.cfg.PublicURL + r.URL.Path, "Image": s.cfg.PublicURL + "/og.png",
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

// preview is what a link to this page shows when it's shared (Viber, Messenger, WhatsApp): an invite says whose it
// is; a room, its code.
func (s *Server) preview(r *http.Request) (title, description string) {
	title, description = "АЛМАНАХ", "Десет въпроса на ден, игра по теми, дуели и стаи с приятели. Всеки отговор носи по нещо ново."
	switch path := r.URL.Path; {
	case strings.HasPrefix(path, "/f/"):
		if _, name, err := s.game.Inviter(r.Context(), strings.TrimPrefix(path, "/f/")); err == nil {
			title = name + " те кани в АЛМАНАХ"
			description = "Приеми и сте приятели: виждате резултатите си за деня и се каните на дуел."
		}
	case strings.HasPrefix(path, "/players/"):
		if tag, err := account.NormalTag(strings.TrimPrefix(path, "/players/")); err == nil {
			if p, err := s.game.ProfileOf(r.Context(), tag, 0); err == nil {
				title = p.Name + " (@" + p.Tag + ") в АЛМАНАХ"
				description = fmt.Sprintf("Ниво %d · %s · %d изиграни игри.", p.Level, p.Standing.Division.Name, p.Games)
			}
		}
	case strings.HasPrefix(path, "/r/"):
		code := strings.TrimPrefix(path, "/r/")
		if _, err := s.rooms.Get(code); err == nil {
			title = "Ела в стая " + code[:3] + " " + code[3:]
			description = "Играем АЛМАНАХ заедно: един и същ въпрос за всички, в един и същ момент."
		}
	}
	return title, description
}

// The client's fonts are its own files: say what they are, wherever the server runs (not every system's MIME table
// knows woff2).
func init() { _ = mime.AddExtensionType(".woff2", "font/woff2") }

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
var publicFiles = []string{
	"favicon.svg", "bimi.svg", "robots.txt", "manifest.webmanifest", "sw.js", "og.png",
	"icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "badge-96.png",
}

func (s *Server) publicFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=3600")
	if r.URL.Path == "/sw.js" { // a new service worker reaches every browser at once
		w.Header().Set("Cache-Control", "no-cache")
	}
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
