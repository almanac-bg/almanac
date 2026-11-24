package server

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// Днес's title is the server's and the client's both (the page's head, then the router's title() as it draws Днес):
// one changed alone, the client would set the tab and what a search shows back to the other as the page draws.
func TestHomeTitleMatchesTheClient(t *testing.T) {
	src, err := os.ReadFile("../../web/src/lib/router.ts")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`export const homeTitle = "([^"]+)";`).FindSubmatch(src)
	if m == nil {
		t.Fatal("router.ts has no homeTitle: has it changed shape? Change this test with it")
	}
	if string(m[1]) != homeTitle {
		t.Fatalf("the client's Днес is titled %q, the server's page %q: make them one", m[1], homeTitle)
	}
}

// The front page says what the game is to whoever reads it without running it (a search's crawler, an AI's reader):
// its title and description, the site's name as structured data, a paragraph in its <noscript> with the ten topics,
// and its picture's words. Other pages keep the one line.
func TestFrontPageSaysWhatTheGameIs(t *testing.T) {
	g := start(t)
	get := func(path string) string {
		res, err := http.Get(g.url + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return string(body)
	}
	const ld = `<script type="application/ld+json">`
	home := get("/")
	for _, want := range []string{
		"<title>" + homeTitle + "</title>",
		`<meta property="og:title" content="` + homeTitle + `">`,
		`<meta name="description" content="` + siteDescription + `">`,
		`<meta property="og:image:alt" content="АЛМАНАХ: десет въпроса на ден`,
		ld,
		"обща култура, наука, история", // the sample bank's chapters, in its order
		`<a href="/privacy">`,
	} {
		if !strings.Contains(home, want) {
			t.Errorf("/ has no %s", want)
		}
	}
	var site map[string]any
	if i := strings.Index(home, ld); i >= 0 {
		data, _, _ := strings.Cut(home[i+len(ld):], "</script>")
		if err := json.Unmarshal([]byte(data), &site); err != nil {
			t.Fatalf("the site's structured data isn't JSON: %v %.300s", err, data)
		}
	}
	if site["@type"] != "WebSite" || site["name"] != "АЛМАНАХ" || site["url"] != g.url+"/" || site["inLanguage"] != "bg" {
		t.Errorf("the site's structured data: %v", site)
	}
	friends := get("/friends")
	if strings.Contains(friends, "ld+json") || strings.Contains(friends, "обща култура") ||
		!strings.Contains(friends, "<title>"+homeTitle+"</title>") {
		t.Errorf("/friends has the front page's words, or not its title")
	}
}

// Every file of web/public is served from the site's root (publicFiles): one added there and not here is a 404.
func TestPublicFilesServed(t *testing.T) {
	entries, err := os.ReadDir("../../web/public")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !slices.Contains(publicFiles, e.Name()) {
			t.Errorf("web/public/%s isn't served: add it to publicFiles in pages.go", e.Name())
		}
	}
	g := start(t)
	g.srv.client = fstest.MapFS{
		"favicon.ico":          {Data: []byte("\x00\x00\x01\x00icon")},
		"manifest.webmanifest": {Data: []byte(`{"name":"АЛМАНАХ"}`)},
	}
	for file, kind := range map[string]string{"favicon.ico": "image/x-icon", "manifest.webmanifest": "application/manifest+json"} {
		res, err := http.Get(g.url + "/" + file)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 200 || res.Header.Get("Content-Type") != kind {
			t.Errorf("/%s: %d %q", file, res.StatusCode, res.Header.Get("Content-Type"))
		}
	}
}

// bootOf is the boot data of the page at path, as p's browser gets it.
func bootOf(t *testing.T, p *player, path string) map[string]any {
	t.Helper()
	res, err := p.client.Get(p.g.url + path)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	const open = `<script type="application/json" id="boot">`
	start := strings.Index(string(body), open)
	end := strings.Index(string(body)[start:], "</script>")
	var v map[string]any
	if err := json.Unmarshal(body[start+len(open):start+end], &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// The day's board names its players only to one who has finished the day: a visitor, a new player's cover and the
// page a shared day's link opens carry how many played, never who (a score shared beside the names would say whose
// it is).
func TestDayBoardNamesOnlyThoseWhoPlayedIt(t *testing.T) {
	g := start(t)
	ana, _ := g.guest()
	_, run := ana.call("POST", "/api/day", map[string]any{})
	playRun(ana, run)
	top := func(day map[string]any) []any {
		b, _ := day["board"].(map[string]any)
		if b == nil {
			t.Fatalf("no board: %v", day)
		}
		list, _ := b["top"].([]any)
		return list
	}
	visitor := g.player()
	if day, _ := bootOf(t, visitor, "/")["day"].(map[string]any); len(top(day)) != 0 {
		t.Fatalf("a visitor's Днес names who played: %v", top(day))
	}
	_, day := visitor.call("GET", "/api/day", nil)
	if len(top(day)) != 0 || day["board"].(map[string]any)["players"] != float64(1) {
		t.Fatalf("a visitor's day: %v", day["board"])
	}
	bo, _ := g.guest()
	if _, day := bo.call("GET", "/api/day", nil); len(top(day)) != 0 {
		t.Fatalf("before the day is played: %v", top(day))
	}
	if _, day := ana.call("GET", "/api/day", nil); len(top(day)) != 1 {
		t.Fatalf("once it's played: %v", top(day))
	}
}

// Днес's page has the day in it, as GET /api/day has it: the page draws it without asking first. Other pages don't
// carry it. Every page has the server's clock, for the page's own until an answer comes.
func TestNachaloHasTheDayInItsPage(t *testing.T) {
	g := start(t)
	visitor := g.player()
	if day, ok := bootOf(t, visitor, "/")["day"].(map[string]any); !ok || day["day"] != g.srv.game.Today() || day["board"] == nil {
		t.Fatalf("a visitor's Днес: %v", day)
	}
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	p.call("POST", "/api/day", map[string]any{})
	_, want := p.call("GET", "/api/day", nil)
	boot := bootOf(t, p, "/")
	got, _ := boot["day"].(map[string]any)
	a, _ := json.Marshal(got)
	b, _ := json.Marshal(want)
	if string(a) != string(b) {
		t.Errorf("the day in the page:\n%s\nGET /api/day:\n%s", a, b)
	}
	if now, _ := boot["now"].(float64); time.Since(time.UnixMilli(int64(now))).Abs() > time.Minute {
		t.Errorf("the page's clock: %v", boot["now"])
	}
	if day, ok := bootOf(t, p, "/friends")["day"]; ok {
		t.Errorf("/friends has the day in it: %v", day)
	}
	// Nothing of the game waits to be met: no page says what's open (play/progress.go).
	for _, who := range []*player{p, visitor} {
		if open, ok := bootOf(t, who, "/friends")["open"]; ok {
			t.Errorf("a page says what's open: %v", open)
		}
	}
}

// A page asks at once for its style, its script (the whole client) and its first fonts: in its head, and in a Link
// header. The player's Night or Day is on it before its first paint (scheme.js).
func TestPagesAskForTheirFilesAtOnce(t *testing.T) {
	g := start(t)
	g.srv.client = fstest.MapFS{
		"manifest.json": {Data: []byte(`{"app.css": "assets/app-C.css", "app.js": "assets/app-J.js",
			"sofia-sans.woff2": "assets/sofia-sans-F.woff2"}`)},
	}
	get := func(path string) (*http.Response, string) {
		res, err := http.Get(g.url + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res, string(body)
	}
	res, body := get("/settings")
	for _, want := range []string{
		`<script src="/scheme.js"></script>`,
		`<link rel="preload" href="/assets/sofia-sans-F.woff2" as="font" type="font/woff2" crossorigin>`,
		`<link rel="stylesheet" href="/assets/app-C.css">`,
		`<script type="module" src="/assets/app-J.js"></script>`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("/settings has no %s", want)
		}
	}
	link := res.Header.Get("Link")
	for _, want := range []string{
		"</assets/app-C.css>; rel=preload; as=style", "</assets/app-J.js>; rel=modulepreload",
		`</assets/sofia-sans-F.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin`,
	} {
		if !strings.Contains(link, want) {
			t.Errorf("/settings's Link header %q has no %s", link, want)
		}
	}
}

// A script or a stylesheet goes out as the build compressed it, in the encoding the browser takes; anything else, and
// a browser that takes neither, get the file as it is.
func TestAssetsGoOutCompressed(t *testing.T) {
	g := start(t)
	g.srv.client = fstest.MapFS{
		"assets/app-J.js":        {Data: []byte("plain")},
		"assets/app-J.js.br":     {Data: []byte("brotli")},
		"assets/app-J.js.gz":     {Data: []byte("gzip")},
		"assets/app-C.css":       {Data: []byte("plain css")},
		"assets/app-C.css.gz":    {Data: []byte("gzip css")},
		"assets/font-F.woff2":    {Data: []byte("font")},
		"assets/font-F.woff2.br": {Data: []byte("never")},
	}
	for _, c := range []struct{ path, accept, body, encoding, kind string }{
		{"/assets/app-J.js", "gzip, deflate, br, zstd", "brotli", "br", "text/javascript; charset=utf-8"},
		{"/assets/app-J.js", "gzip", "gzip", "gzip", "text/javascript; charset=utf-8"},
		{"/assets/app-J.js", "br;q=0, gzip;q=0.5", "gzip", "gzip", "text/javascript; charset=utf-8"},
		{"/assets/app-J.js", "identity", "plain", "", "text/javascript; charset=utf-8"},
		{"/assets/app-C.css", "br, gzip", "gzip css", "gzip", "text/css; charset=utf-8"},
		{"/assets/font-F.woff2", "br, gzip", "font", "", "font/woff2"},
		{"/assets/app-J.js.map", "br, gzip", "404 page not found\n", "", "text/plain; charset=utf-8"},
		// A folder is no file: nothing lists the client's files.
		{"/assets/", "br, gzip", "404 page not found\n", "", "text/plain; charset=utf-8"},
	} {
		req, _ := http.NewRequest("GET", g.url+c.path, nil)
		req.Header.Set("Accept-Encoding", c.accept) // set by hand: Go's client then leaves the body as it came
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if string(body) != c.body || res.Header.Get("Content-Encoding") != c.encoding || res.Header.Get("Content-Type") != c.kind {
			t.Errorf("%s (%s): %q, %q, %q; want %q, %q, %q", c.path, c.accept, body, res.Header.Get("Content-Encoding"),
				res.Header.Get("Content-Type"), c.body, c.encoding, c.kind)
		}
		if js := strings.HasSuffix(c.path, ".js") || strings.HasSuffix(c.path, ".css"); js != (res.Header.Get("Vary") == "Accept-Encoding") {
			t.Errorf("%s: Vary %q", c.path, res.Header.Get("Vary"))
		}
		// A miss is kept by no cache between (it may be there in a moment, around a rollback).
		if res.StatusCode == http.StatusNotFound && res.Header.Get("Cache-Control") != "no-store" {
			t.Errorf("%s: a 404 with Cache-Control %q", c.path, res.Header.Get("Cache-Control"))
		}
	}
}

// The frame's avatar is the player's face alone (the owner, 2026-11-22): from the page's first draw (its boot) its
// animal, and no seal on it in the boot or in GET /api/me, whatever their ranks; never one to choose (no way to set it).
func TestNoSealOnTheFrame(t *testing.T) {
	g := start(t)
	ana, id := g.guest()
	if _, err := g.db.Write.Exec(`INSERT INTO ranks (user_id, chapter, level, quarter, ink, told)
		VALUES (?1, 'history', 2, 1, 7, 2), (?1, 'science', 1, 0, 2, 1)`, id); err != nil {
		t.Fatal(err)
	}
	boot := bootOf(t, ana, "/friends")
	if _, ok := boot["seal"]; ok || boot["avatar"] == nil {
		t.Fatalf("the page's boot: avatar %v, seal %v", boot["avatar"], boot["seal"])
	}
	if _, out := ana.call("GET", "/api/me", nil); out["seal"] != nil || out["user"] == nil {
		t.Fatalf("/api/me: %v", out)
	}
	if status, _ := ana.call("PATCH", "/api/me/seal", map[string]any{"chapter": "science"}); status != 404 &&
		status != 405 {
		t.Fatalf("a seal chosen: %d, want no such way", status)
	}
}

// An old personal invite link (/f/<code>, removed 21 Nov 2026), opened from a chat, goes to the day.
func TestOldInviteLinkGoesToTheDay(t *testing.T) {
	g := start(t)
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, path := range []string{"/f/abcdefghij", "/f/"} {
		res, err := c.Get(g.url + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusMovedPermanently || res.Header.Get("Location") != "/" {
			t.Errorf("%s: %d to %q", path, res.StatusCode, res.Header.Get("Location"))
		}
	}
}
