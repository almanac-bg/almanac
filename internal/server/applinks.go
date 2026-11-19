package server

import (
	"encoding/json"
	"net/http"
)

// The game's app on phones (mobile/) opens links to the game's pages itself, once the phone has checked that the site
// says so: an iPhone reads apple-app-site-association (the app by its team and bundle id), Android reads assetlinks.json
// (the app by its package and the certificate Google Play signs it with). Only the game's own pages go to the app
// (appLinks); the rest (the API, files, the privacy page, a mail's „no more of these“, admin) stay in the browser.
const (
	appleAppID     = "CA38SQWUTC.bg.almanac.app"
	androidPackage = "bg.almanac.app"
)

// androidCerts are the SHA-256 fingerprints of the certificates the app is signed with as phones get it: Google
// Play's app signing key (Play Console → App signing).
var androidCerts = []string{"87:68:23:BC:F3:84:76:EE:87:B4:A0:19:27:C9:50:E4:4D:EA:54:AB:0C:AA:63:F5:31:71:4D:DF:DA:1A:AF:02"}

// appLinks are the paths a link opens in the app: each a page of appPaths (pages.go), or, ending in *, the pages under
// it. An iPhone has them from here, Android from the app's AndroidManifest.xml; applinks_test.go keeps the three lists
// one. A page the server draws itself is none of them, or the app would show it as a page it doesn't know.
var appLinks = []string{
	"/", "/play/*", "/duel", "/duel/*", "/challenge", "/challenge/*", "/c/*", "/r/*", "/f/*", "/hand/*",
	"/games/*", "/players/*", "/royal", "/room", "/ranks", "/rewards", "/wardrobe", "/me", "/friends",
	"/settings", "/almanac", "/mistakes",
}

func (s *Server) appleAppSiteAssociation(w http.ResponseWriter, _ *http.Request) {
	components := make([]map[string]any, 0, len(appLinks))
	for _, p := range appLinks {
		components = append(components, map[string]any{"/": p})
	}
	out := map[string]any{
		"applinks": map[string]any{"details": []any{map[string]any{
			"appIDs":     []string{appleAppID},
			"components": components,
		}}},
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_ = json.NewEncoder(w).Encode(out)
}

func (s *Server) assetLinks(w http.ResponseWriter, _ *http.Request) {
	out := []any{map[string]any{
		"relation": []string{"delegate_permission/common.handle_all_urls"},
		"target":   map[string]any{"namespace": "android_app", "package_name": androidPackage, "sha256_cert_fingerprints": androidCerts},
	}}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_ = json.NewEncoder(w).Encode(out)
}
