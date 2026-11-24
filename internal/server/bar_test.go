package server

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// The browser's own bar (a phone's, over the page) and an installed app's first frame are the page's colour, by day
// and by night: app.css's --bg, in the shell's theme-color, the client's (lib/prefs.ts, for a look chosen in
// Настройки) and the manifest's. They were once a cream of an older look, on a cool grey page.
func TestBrowserBarIsThePage(t *testing.T) {
	read := func(path string) string {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	var bgs []string
	for _, m := range regexp.MustCompile(`--bg: (#[0-9a-f]{6});`).FindAllStringSubmatch(read("../../web/src/app.css"), -1) {
		if !slices.Contains(bgs, m[1]) {
			bgs = append(bgs, m[1])
		}
	}
	if len(bgs) != 2 {
		t.Fatalf("app.css has --bg %v: one by day (first), one by night, was expected; change this test with it", bgs)
	}
	day, night := bgs[0], bgs[1]
	pages := read("pages.go")
	for scheme, c := range map[string]string{"light": day, "dark": night} {
		if want := `content="` + c + `" media="(prefers-color-scheme: ` + scheme + `)"`; !strings.Contains(pages, want) {
			t.Errorf("pages.go's theme-color by %s isn't %s", scheme, c)
		}
	}
	if want := `{ night: "` + night + `", day: "` + day + `" }`; !strings.Contains(read("../../web/src/lib/prefs.ts"), want) {
		t.Errorf("lib/prefs.ts's barColour isn't %s", want)
	}
	manifest := read("../../web/public/manifest.webmanifest")
	for _, key := range []string{"background_color", "theme_color"} {
		if want := `"` + key + `": "` + day + `"`; !strings.Contains(manifest, want) {
			t.Errorf("the manifest's %s isn't %s", key, day)
		}
	}
}
