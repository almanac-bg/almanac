package server

import (
	"encoding/json"
	"encoding/xml"
	"os"
	"slices"
	"strings"
	"testing"
)

// linked says whether an app link's path (appLinks) takes p.
func linked(link, p string) bool {
	if prefix, ok := strings.CutSuffix(link, "*"); ok {
		return strings.HasPrefix(p, prefix) && len(p) > len(prefix)
	}
	return p == link
}

// The app opens every page of the game, and none of the server's own: a link to /mail/off or /privacy opened in the
// app would be a page the app doesn't know.
func TestAppLinksAreTheGamePages(t *testing.T) {
	for _, re := range appPaths {
		p := example(t, re)
		if !slices.ContainsFunc(appLinks, func(l string) bool { return linked(l, p) }) {
			t.Errorf("%s (e.g. %s) is a page of the game no app link opens: add it to appLinks", re, p)
		}
	}
	for _, l := range appLinks {
		// A page under a link ending in *: one of these.
		probes := []string{l}
		if prefix, ok := strings.CutSuffix(l, "*"); ok {
			probes = nil
			for _, rest := range []string{"0", "2026", "000000", "a", "abc", "aaaaaaaa", strings.Repeat("a", 43)} {
				probes = append(probes, prefix+rest)
			}
		}
		page := false
		for _, re := range appPaths {
			for _, p := range probes {
				page = page || re.MatchString(p)
			}
		}
		if !page {
			t.Errorf("app link %s opens no page of the game (appPaths)", l)
		}
	}
	for _, p := range []string{"/mail/off", "/privacy", "/admin", "/api/day", "/assets/app.js", "/qimg/a.webp", "/robots.txt",
		"/sitemap.xml", "/.well-known/security.txt", "/og.png", "/playful"} {
		for _, l := range appLinks {
			if linked(l, p) {
				t.Errorf("app link %s takes %s, a page of the server's own", l, p)
			}
		}
	}
}

// The app's web view takes as its own (its bridge to the phone's notifications and the rest) every address that
// starts with its server's, letter for letter, on an iPhone: ending in / it is almanac.bg's pages, and not
// almanac.bg.example.com nor almanac.bg@example.com.
func TestAppServerEndsWithSlash(t *testing.T) {
	src, err := os.ReadFile("../../mobile/capacitor.config.json")
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Server struct {
			URL string `json:"url"`
		} `json:"server"`
	}
	if err := json.Unmarshal(src, &c); err != nil {
		t.Fatal(err)
	}
	if c.Server.URL != "https://almanac.bg/" {
		t.Fatalf("the app's server is %q: https://almanac.bg/, with its slash", c.Server.URL)
	}
}

// Android has the app links in the app's manifest, as paths (exact) and path prefixes (a link ending in *).
func TestAndroidHasTheAppLinks(t *testing.T) {
	src, err := os.ReadFile("../../mobile/android/app/src/main/AndroidManifest.xml")
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		Filters []struct {
			Data []struct {
				Host   string `xml:"host,attr"`
				Path   string `xml:"path,attr"`
				Prefix string `xml:"pathPrefix,attr"`
			} `xml:"data"`
		} `xml:"application>activity>intent-filter"`
	}
	if err := xml.Unmarshal(src, &m); err != nil {
		t.Fatal(err)
	}
	var got []string
	hosts := 0
	for _, f := range m.Filters {
		for _, d := range f.Data {
			if d.Host != "" {
				hosts++
			}
			if d.Path != "" {
				got = append(got, d.Path)
			}
			if d.Prefix != "" {
				got = append(got, d.Prefix+"*")
			}
		}
	}
	if hosts != 1 {
		t.Fatalf("the manifest names a host %d times: one intent filter, for almanac.bg", hosts)
	}
	want := slices.Clone(appLinks)
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Errorf("AndroidManifest.xml opens %v; appLinks are %v: make them the same", got, want)
	}
}
