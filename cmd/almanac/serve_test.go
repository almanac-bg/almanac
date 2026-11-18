package main

import (
	"log/slog"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/server"
)

// DEV=1 starts only as development: with any of production's settings it refuses, and says which.
func TestDevOnly(t *testing.T) {
	t.Parallel()
	local := server.Config{Dev: true, PublicURL: "http://localhost:8080"}
	for _, tc := range []struct {
		name string
		cfg  server.Config
		says string // "" if it starts
	}{
		{"development", local, ""},
		{"a phone on the network", server.Config{Dev: true, PublicURL: "http://192.168.1.5:8080"}, ""},
		{"production without DEV", server.Config{PublicURL: "https://almanac.bg", TLSCert: "c", TLSKey: "k",
			TrustCloudflare: true}, ""},
		{"https", server.Config{Dev: true, PublicURL: "HTTPS://almanac.bg"}, "an https PUBLIC_URL"},
		{"a certificate", server.Config{Dev: true, PublicURL: local.PublicURL, TLSCert: "/etc/almanac/origin.pem"},
			"TLS_CERT"},
		{"a key", server.Config{Dev: true, PublicURL: local.PublicURL, TLSKey: "/etc/almanac/origin.key"}, "TLS_KEY"},
		{"Cloudflare", server.Config{Dev: true, PublicURL: local.PublicURL, TrustCloudflare: true}, "TRUST_CLOUDFLARE"},
		{"the server's env", server.Config{Dev: true, PublicURL: "https://almanac.bg", TLSCert: "c", TLSKey: "k",
			TrustCloudflare: true}, "an https PUBLIC_URL, TLS_CERT or TLS_KEY, TRUST_CLOUDFLARE"},
	} {
		err := devOnly(tc.cfg)
		switch {
		case tc.says == "" && err != nil:
			t.Errorf("%s: refused: %v", tc.name, err)
		case tc.says != "" && (err == nil || !strings.Contains(err.Error(), tc.says)):
			t.Errorf("%s: %v, want it refused for %q", tc.name, err, tc.says)
		}
	}
}

// serve itself refuses before it opens anything: the database, the bank, the port.
func TestServeRefusesDevInProduction(t *testing.T) {
	t.Setenv("DEV", "1")
	t.Setenv("PUBLIC_URL", "https://almanac.bg")
	t.Setenv("DB_PATH", t.TempDir()+"/almanac.db")
	defer slog.SetDefault(slog.Default()) // serve sets its own
	err := serve(nil)
	if err == nil || !strings.Contains(err.Error(), "DEV=1 is for development") {
		t.Fatalf("serve: %v", err)
	}
}
