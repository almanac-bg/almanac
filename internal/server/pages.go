package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/assets"
	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
)

// The app is one page: the server sends it for every path the app knows (and a 404 with it for the rest, which the
// app shows as such), with what it needs to start in it, so it draws at once without asking for anything: Днес's
// page has the day in it too (GET /api/day's answer), and every page asks for its style, its script and the font its
// first paint is in at once, in its head and in a Link header (files.link).
var appPaths = []*regexp.Regexp{
	regexp.MustCompile(`^/$`),
	regexp.MustCompile(`^/play/[a-z]+$`),
	regexp.MustCompile(`^/almanac/[a-z]+$`),
	regexp.MustCompile(`^/(me|friends|settings|almanac)$`),
	regexp.MustCompile(`^/signin$`),
	regexp.MustCompile(`^/duel/[0-9]{1,12}$`),
	regexp.MustCompile(`^/players/[A-Za-z0-9_.]{3,20}$`),
	sharePath, // a shared day (share.go)
}

// isAppPath is whether a path is one of the app's pages (appPaths).
func isAppPath(path string) bool {
	for _, p := range appPaths {
		if p.MatchString(path) {
			return true
		}
	}
	return false
}

// screens are the pages whose screen loads on its own (web/src/kit.ts), and the file it's in (the build's manifest
// names it): the page asks for it with app.js, so that one opened by its link (a notification's, a bookmark's) waits
// for no second round trip. TestScreensMatchTheClient holds it to the client's router.
var screens = []struct {
	path *regexp.Regexp
	file string
}{
	{regexp.MustCompile(`^/me$`), "me.js"},
	{regexp.MustCompile(`^/settings$`), "settings.js"},
	{regexp.MustCompile(`^/almanac(/[a-z]+)?$`), "almanac.js"},
	{regexp.MustCompile(`^/friends$`), "friends.js"},
	{regexp.MustCompile(`^/players/[A-Za-z0-9_.]{3,20}$`), "player.js"},
}

// screenOf is the file of path's screen, if it loads on its own ("" if it's in app.js).
func screenOf(path string) string {
	for _, s := range screens {
		if s.path.MatchString(path) {
			return s.file
		}
	}
	return ""
}

// files are what a page asks for at once: its style, its script, the scripts every page loads as it starts
// (assets.FirstScripts) and its screen's (if it loads on its own), and the fonts its first paint is in; each as the
// build named it.
type files struct {
	CSS, JS, Screen string
	Scripts, Fonts  []string
}

func filesOf(m map[string]string, path string) files {
	f := files{CSS: m["app.css"], JS: m["app.js"], Screen: m[screenOf(path)]}
	for _, js := range assets.FirstScripts {
		if m[js] != "" {
			f.Scripts = append(f.Scripts, m[js])
		}
	}
	for _, font := range assets.FirstFonts {
		if m[font] != "" {
			f.Fonts = append(f.Fonts, m[font])
		}
	}
	return f
}

// link is the Link header that asks for a page's files as its head does: a browser may start on them before the page's
// body has come. It isn't sent ahead of the page (103 Early Hints): none came from production (November 2026), and
// Cloudflare would hint only its preload and preconnect links, never a modulepreload.
func (f files) link() string {
	var links []string
	if f.CSS != "" {
		links = append(links, "</"+f.CSS+">; rel=preload; as=style")
	}
	for _, js := range append([]string{f.JS, f.Screen}, f.Scripts...) {
		if js != "" {
			links = append(links, "</"+js+">; rel=modulepreload")
		}
	}
	for _, font := range f.Fonts {
		links = append(links, "</"+font+`>; rel=preload; as=font; type="font/woff2"; crossorigin`)
	}
	return strings.Join(links, ", ")
}

var shell = template.Must(template.New("shell").Parse(`<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{{.HomeTitle}}</title>
<meta name="description" content="{{.Description}}">
{{if .Canonical}}<link rel="canonical" href="{{.Canonical}}">{{end}}
<meta property="og:site_name" content="АЛМАНАХ">
<meta property="og:type" content="website">
<meta property="og:title" content="{{.Title}}">
<meta property="og:description" content="{{.Description}}">
<meta property="og:url" content="{{.URL}}">
<meta property="og:image" content="{{.Image}}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{{.ImageAlt}}">
<meta property="og:locale" content="bg_BG">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f3f4fa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e0c1d" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<script src="/scheme.js"></script>
{{with .Files}}{{range .Fonts}}<link rel="preload" href="/{{.}}" as="font" type="font/woff2" crossorigin>
{{end}}{{if .CSS}}<link rel="stylesheet" href="/{{.CSS}}">{{end}}
{{if .JS}}<script type="module" src="/{{.JS}}"></script>{{end}}
{{range .Scripts}}<link rel="modulepreload" href="/{{.}}">
{{end}}{{if .Screen}}<link rel="modulepreload" href="/{{.Screen}}">{{end}}{{end}}
<script type="application/json" id="boot">{{.Boot}}</script>
{{with .Site}}<script type="application/ld+json">{{.}}</script>
{{end}}</head>
<body>
<div id="app">{{if not .Files.JS}}<p style="padding:2rem;font-family:system-ui">The client isn't built: go run ./cmd/build</p>{{end}}</div>
<noscript>{{if .Topics}}<p>АЛМАНАХ е безплатна игра с въпроси на български. Всеки ден излизат нови десет въпроса, едни
и същи за цяла България: по един от всяка от десетте теми ({{.Topics}}), от лесен към труден. Всеки верен отговор в броя
на деня вписва факта си с мастило в твоя Алманах. Играеш без регистрация, сравняваш резултата си с приятелите си и
ги предизвикваш на дуел.</p>
<p>За да играеш, включи JavaScript в браузъра си. <a href="/privacy">Какво пазим и защо</a></p>{{else}}<p>За да играеш АЛМАНАХ, включи JavaScript в браузъра си.</p>{{end}}</noscript>
</body>
</html>
`))

// private is how a page drawn for one person is cached: by their own browser only, and asked again each time it's
// shown, so that no cache between (Cloudflare's, a proxy's) ever keeps one player's page to give another (review
// 2026-11-18, S25).
const private = "private, no-cache"

func (s *Server) page(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	// A page reads what the API does (the day, a player, a duel): within the same budget (mayCall).
	if !s.mayCall(r) {
		http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
		return
	}
	// A page of the app's with a slash after it (/almanac/) is that page (the client's router drops the slash, and the
	// page's canonical link is without it): served in place, never sent elsewhere by a redirect.
	if p := strings.TrimSuffix(r.URL.Path, "/"); p != r.URL.Path && p != "" && isAppPath(p) {
		u, req := *r.URL, *r
		u.Path, u.RawPath = p, ""
		req.URL = &u
		r = &req
	}
	status := http.StatusNotFound
	if isAppPath(r.URL.Path) {
		status = http.StatusOK
	}
	// A shared day's link (share.go), looked up once for all the page says of it.
	shared, isShared := s.sharedOf(r)
	if status == http.StatusOK && (!s.there(r) || sharePath.MatchString(r.URL.Path) && !isShared) {
		status = http.StatusNotFound
	}
	u, err := s.user(r)
	if err != nil {
		// The browser went away before the answer (a reload over a page still coming: one held through a restart):
		// nobody to answer, nothing wrong.
		if r.Context().Err() != nil {
			w.WriteHeader(499)
			return
		}
		slog.Error("page", "route", route(r), "err", err)
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	b := s.bank.Load()
	m := s.files()
	start := map[string]any{
		"user":     u,
		"chapters": b.Categories,
		"version":  s.cfg.Version,
		"push":     s.pushKey(),
		"now":      time.Now().UnixMilli(), // the clock the page keeps until the API's first answer (lib/api.ts)
	}
	// The player's avatar, in the corner of every page (web/src/app.ts): without it, the corner would wait on a
	// question.
	if u != nil {
		if look, err := s.game.LookOf(r.Context(), u.ID); err == nil {
			start["avatar"] = look.Avatar
		}
	}
	// Днес draws the day as the page comes, without asking for it first: a round trip less on every visit. Should
	// it fail, the page asks for it as any other.
	// A shared day's link is Днес too, with the day shared: its issue, its date and its shape.
	if (r.URL.Path == "/" || isShared) && r.Method == http.MethodGet {
		if day, err := s.todayOf(r.Context(), u); err == nil {
			start["day"] = day
		}
	}
	if isShared {
		// With its link (to ask whoever shared it to be friends, and to count a new player who came by it: share.go),
		// and whether it's the player's own: never whose it is.
		start["shared"] = struct {
			play.Share
			Link string `json:"link"`
			Mine bool   `json:"mine,omitempty"`
		}{shared, fmt.Sprintf("%d-%s", shared.Issue, shared.Code), u != nil && u.ID == shared.Owner}
	}
	boot, _ := json.Marshal(start) // escapes <, > and &: safe inside the script element
	files := filesOf(m, r.URL.Path)
	pv := s.preview(r, shared)
	if pv.missing {
		status = http.StatusNotFound
	}
	page := map[string]any{
		"Files": files, "Boot": template.JS(boot), "HomeTitle": homeTitle,
		"Title": pv.title, "Description": pv.description, "Canonical": "",
		"URL": s.cfg.PublicURL + r.URL.Path, "Image": s.cfg.PublicURL + pv.image, "ImageAlt": pv.alt,
	}
	// The front page, the one search engines are given (indexed): its address, the site's name for them, and for a
	// reader that doesn't run the page (an AI's, a crawler's), what the game is in words.
	if r.URL.Path == "/" {
		page["Canonical"] = s.cfg.PublicURL + "/"
		site, _ := json.Marshal(map[string]any{
			"@context": "https://schema.org", "@type": "WebSite", "name": "АЛМАНАХ",
			"alternateName": []string{"Алманах", "almanac.bg"}, "url": s.cfg.PublicURL + "/", "inLanguage": "bg",
			"description": siteDescription,
		})
		page["Site"] = template.JS(site) // a data block, never run: the CSP's script-src doesn't apply to it
		page["Topics"] = topicWords(b.Categories)
	}
	var out bytes.Buffer
	if err := shell.Execute(&out, page); err != nil {
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", private) // the boot JSON has the player in it: their email, whether they're an admin
	h.Set("Vary", "Cookie")
	if link := files.link(); link != "" {
		h.Set("Link", link)
	}
	if r.URL.Path != "/" {
		h.Set("X-Robots-Tag", "noindex") // see robots
	}
	w.WriteHeader(status)
	_, _ = w.Write(out.Bytes())
}

// there is whether what a page of the app is of is there, where the server can tell: a chapter's games, a duel, a
// player's well-formed tag (whether it's someone's, preview says). One that isn't is a 404 (as for a path the app doesn't know), which its screen says in words. A failure to
// tell is taken as there: the screen finds out.
func (s *Server) there(r *http.Request) bool {
	p, ctx := r.URL.Path, r.Context()
	var yes bool
	var err error
	switch {
	case strings.HasPrefix(p, "/play/"):
		return s.game.IsChapter(strings.TrimPrefix(p, "/play/"))
	case strings.HasPrefix(p, "/almanac/"):
		// A chapter of the book: one of the bank's chapters.
		return s.game.IsChapter(strings.TrimPrefix(p, "/almanac/"))
	case strings.HasPrefix(p, "/duel/"):
		id, _ := strconv.ParseInt(strings.TrimPrefix(p, "/duel/"), 10, 64)
		yes, err = s.game.DuelExists(ctx, id)
	case strings.HasPrefix(p, "/players/"):
		// Whether the tag is someone's is for the page's one counted lookup to say (preview: profileOf, whose misses
		// a network may make only so many of), never an uncounted one here.
		_, e := account.NormalTag(strings.TrimPrefix(p, "/players/"))
		return e == nil
	default:
		return true
	}
	return yes || err != nil
}

// preview is what a link to this page shows when it's sent (Viber, Messenger, WhatsApp), and its picture: a player's
// page, whose it is, and nothing it would have to claim of them (never a rank's word beside a name: DECISIONS.md, the
// seal); a shared day, its score and its card (share.go), never whose it was.
func (s *Server) preview(r *http.Request, shared play.Share) linkPreview {
	p := linkPreview{title: homeTitle, description: siteDescription, image: "/og.png",
		alt: "АЛМАНАХ: десет въпроса на ден, едни и същи за цяла България"}
	switch path := r.URL.Path; {
	case shared.Code != "":
		p.title = fmt.Sprintf("%d от %d · АЛМАНАХ, Брой %d", shared.Rights(), shared.Counted(), shared.Issue)
		p.description = "Десет въпроса на ден, едни и същи за цяла България. Колко ще познаеш ти?"
		p.image = cardOf(shared, s.cfg.Version)
		p.alt = fmt.Sprintf("АЛМАНАХ, Брой %d: %d от %d", shared.Issue, shared.Rights(), shared.Counted())
	case strings.HasPrefix(path, "/players/"):
		if tag, err := account.NormalTag(strings.TrimPrefix(path, "/players/")); err == nil {
			pr, err := s.profileOf(r, tag, 0)
			if err == nil {
				p.title = pr.Name + " (@" + pr.Tag + ") в АЛМАНАХ"
				p.description = "Профил в АЛМАНАХ. Десет въпроса на ден, едни и същи за цяла България."
			}
			p.missing = errors.Is(err, play.ErrNoPlayer)
		}
	}
	return p
}

// homeTitle is the front page's title, the words a search shows and a tab or a bookmark keeps: the game's name and
// what it is, since „алманах“ alone is a common word (and a book's title). Every page starts with it, and a link to
// any page but a shared day's or a player's shows it; the client's router sets each screen's own as it draws it
// (web/src/lib/router.ts, title: TestHomeTitleMatchesTheClient holds the two equal).
const homeTitle = "АЛМАНАХ · Десет въпроса на ден за цяла България"

// siteDescription is the front page's description, the line under its title in a search and under a link to it in a
// chat: what the game is in plain words, for someone who has never heard of it.
const siteDescription = "Игра с въпроси: десет на ден, едни и същи за цяла България. История, география, наука, кино, " +
	"музика, спорт и още. Безплатно, без регистрация."

// topicWords are the bank's chapters as a sentence names them: „обща култура, наука, …“.
func topicWords(chapters []bank.Category) string {
	names := make([]string, len(chapters))
	for i, c := range chapters {
		names[i] = strings.ToLower(c.Name)
	}
	return strings.Join(names, ", ")
}

// linkPreview is what a link to a page shows when it's sent: its title, its line, its picture and the picture's words;
// and whether the player a page is of is nobody (a 404).
type linkPreview struct {
	title, description, image, alt string
	missing                        bool
}

// Search engines get the front page and the privacy notice, and nothing else: every other page is the game itself,
// the same empty page until it starts, or something of one player's or one game's (a duel, a profile), so those say "noindex". The API is closed to them. Both files carry the site's own address, so they're
// drawn here, not kept in web/public.
var indexed = []string{"/", "/privacy"}

func (s *Server) robots(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = fmt.Fprintf(w, "User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: %s/sitemap.xml\n", s.cfg.PublicURL)
}

func (s *Server) sitemap(w http.ResponseWriter, _ *http.Request) {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n" + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	for _, p := range indexed {
		b.WriteString("  <url><loc>" + template.HTMLEscapeString(s.cfg.PublicURL+p) + "</loc></url>\n")
	}
	b.WriteString("</urlset>\n")
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write([]byte(b.String()))
}

// files is the build's manifest (assets.Manifest): read once in a release, where it's in the program, and every time
// in development, where the build rewrites it.
func (s *Server) files() map[string]string {
	if s.cfg.Dev {
		return assets.Manifest(s.client)
	}
	return s.built()
}

// The client's fonts, its icon and its manifest are its own files: say what they are, wherever the server runs (not every system's
// MIME table knows woff2 or ico).
func init() {
	_ = mime.AddExtensionType(".woff2", "font/woff2")
	_ = mime.AddExtensionType(".ico", "image/x-icon")
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

// asset serves the client's built files. Their names change with their content, so they're cached for good. A script
// or a stylesheet goes out as the build compressed it (cmd/build: brotli at its best, else gzip), in the encoding the
// browser takes; one that takes neither gets it as it is. There are no source maps (cmd/build).
func (s *Server) asset(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Dev {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	name := path.Join("assets", r.PathValue("file"))
	if ext := path.Ext(name); ext == ".js" || ext == ".css" {
		w.Header().Add("Vary", "Accept-Encoding")
		for _, c := range []struct{ encoding, suffix string }{{"br", ".br"}, {"gzip", ".gz"}} {
			if accepts(r, c.encoding) && servePacked(w, r, s.client, name, c.suffix, c.encoding) {
				return
			}
		}
	}
	serveFile(w, r, s.client, name)
}

// servePacked sends name's copy compressed ahead (name+suffix), if there is one, as name in that encoding.
func servePacked(w http.ResponseWriter, r *http.Request, fsys fs.FS, name, suffix, encoding string) bool {
	if !fs.ValidPath(name) {
		return false
	}
	f, err := fsys.Open(name + suffix)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	content, seeks := f.(io.ReadSeeker)
	if err != nil || !seeks {
		return false
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
	w.Header().Set("Content-Encoding", encoding)
	http.ServeContent(w, r, name, info.ModTime(), content)
	return true
}

// accepts says whether a request's Accept-Encoding takes encoding (and not at q=0).
func accepts(r *http.Request, encoding string) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		token, params, _ := strings.Cut(part, ";")
		if !strings.EqualFold(strings.TrimSpace(token), encoding) {
			continue
		}
		q, weighed := strings.CutPrefix(strings.ReplaceAll(params, " ", ""), "q=")
		if !weighed {
			return true
		}
		v, err := strconv.ParseFloat(q, 64)
		return err == nil && v > 0
	}
	return false
}

// publicFiles are served from the site's root as they are (web/public).
var publicFiles = []string{
	"favicon.svg", "favicon.ico", "bimi.svg", "manifest.webmanifest", "sw.js", "scheme.js",
	"icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "badge-96.png",
}

func (s *Server) publicFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=3600")
	switch r.URL.Path {
	case "/sw.js": // a new service worker reaches every browser at once
		w.Header().Set("Cache-Control", "no-cache")
	case "/scheme.js": // in every page's head, before its first paint: a day's player never waits on asking for it again
		w.Header().Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=2592000")
	}
	serveFile(w, r, s.client, strings.TrimPrefix(r.URL.Path, "/"))
}

var pictureName = regexp.MustCompile(`^[0-9a-f]{16}(-600|-900)?\.webp$`)

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
	// A folder is no file (/assets/ lists nothing), and a miss is never kept by a cache between: a file missing now (a
	// release's script asked of the one before it, around a rollback) may be there in a moment.
	if info, err := fs.Stat(fsys, name); err != nil || info.IsDir() {
		w.Header().Set("Cache-Control", "no-store")
		http.NotFound(w, r)
		return
	}
	http.ServeFileFS(w, r, fsys, name)
}
