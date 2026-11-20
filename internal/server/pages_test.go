package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

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

// Начало's page has the day in it, as GET /api/day has it: the page draws it without asking first. Other pages don't
// carry it. Every page has the server's clock, for the page's own until an answer comes.
func TestNachaloHasTheDayInItsPage(t *testing.T) {
	g := start(t)
	visitor := g.player()
	if day, ok := bootOf(t, visitor, "/")["day"].(map[string]any); !ok || day["day"] != g.srv.game.Today() || day["board"] == nil {
		t.Fatalf("a visitor's Начало: %v", day)
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
	if day, ok := bootOf(t, p, "/ranks")["day"]; ok {
		t.Errorf("/ranks has the day in it: %v", day)
	}
	// Nothing of the game waits to be met: no page says what's open (play/progress.go).
	for _, who := range []*player{p, visitor} {
		if open, ok := bootOf(t, who, "/ranks")["open"]; ok {
			t.Errorf("a page says what's open: %v", open)
		}
	}
}

// A page asks at once for its style, its script, its first font and, where its screen loads on its own, that screen's
// file: in its head, and in a Link header.
func TestPagesAskForTheirFilesAtOnce(t *testing.T) {
	g := start(t)
	g.srv.client = fstest.MapFS{
		"manifest.json": {Data: []byte(`{"app.css": "assets/app-C.css", "app.js": "assets/app-J.js",
			"sofia-sans.woff2": "assets/sofia-sans-F.woff2", "settings.js": "assets/settings-S.js"}`)},
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
		`<link rel="preload" href="/assets/sofia-sans-F.woff2" as="font" type="font/woff2" crossorigin>`,
		`<link rel="stylesheet" href="/assets/app-C.css">`,
		`<script type="module" src="/assets/app-J.js"></script>`,
		`<link rel="modulepreload" href="/assets/settings-S.js">`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("/settings has no %s", want)
		}
	}
	link := res.Header.Get("Link")
	for _, want := range []string{
		"</assets/app-C.css>; rel=preload; as=style", "</assets/app-J.js>; rel=modulepreload",
		"</assets/settings-S.js>; rel=modulepreload", `</assets/sofia-sans-F.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin`,
	} {
		if !strings.Contains(link, want) {
			t.Errorf("/settings's Link header %q has no %s", link, want)
		}
	}
	if res, body := get("/"); strings.Contains(body, "modulepreload") || strings.Contains(res.Header.Get("Link"), "settings") {
		t.Errorf("Начало asks for a screen of its own: %q", res.Header.Get("Link"))
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
	}
}
