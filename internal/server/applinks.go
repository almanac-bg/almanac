package server

import (
	"encoding/json"
	"net/http"
)

// The game's app on phones (mobile/) opens links to the game's pages itself, once the phone has checked that the site
// says so: an iPhone reads apple-app-site-association (the app by its team and bundle id), Android reads assetlinks.json
// (the app by its package and the certificate Google Play signs it with). The pages that aren't the game's (the API,
// files, the privacy page, admin) stay in the browser.
const (
	appleAppID     = "CA38SQWUTC.bg.almanac.app"
	androidPackage = "bg.almanac.app"
)

// androidCerts are the SHA-256 fingerprints of the certificates the app is signed with as phones get it: Google
// Play's app signing key (Play Console → App signing).
var androidCerts = []string{"87:68:23:BC:F3:84:76:EE:87:B4:A0:19:27:C9:50:E4:4D:EA:54:AB:0C:AA:63:F5:31:71:4D:DF:DA:1A:AF:02"}

func (s *Server) appleAppSiteAssociation(w http.ResponseWriter, _ *http.Request) {
	out := map[string]any{
		"applinks": map[string]any{"details": []any{map[string]any{
			"appIDs": []string{appleAppID},
			"components": []map[string]any{
				{"/": "/api/*", "exclude": true},
				{"/": "/assets/*", "exclude": true},
				{"/": "/qimg/*", "exclude": true},
				{"/": "/admin*", "exclude": true},
				{"/": "/privacy", "exclude": true},
				{"/": "/*"},
			},
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
