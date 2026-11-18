package main

import (
	"path/filepath"
	"testing"
)

// Seeding is a developer's alone: never without DEV=1, in a release's build, with any of production's settings, or on
// the server's database.
func TestSeedOnlyInDevelopment(t *testing.T) {
	ok := func() {
		t.Setenv("DEV", "1")
		t.Setenv("DB_PATH", filepath.Join(t.TempDir(), "seeded.db"))
		for _, k := range []string{"TLS_CERT", "TLS_KEY", "TRUST_CLOUDFLARE", "SMTP_URL", "BACKUP_ENDPOINT",
			"PUSH_PRIVATE_KEY", "APNS_KEY_FILE", "FCM_CREDENTIALS_FILE"} {
			t.Setenv(k, "")
		}
	}
	ok()
	if err := seedAllowed("http://localhost:8080"); err != nil {
		t.Fatalf("refused in development: %v", err)
	}
	for name, c := range map[string]struct {
		env, value, url string
	}{
		"no DEV":           {"DEV", "", "http://localhost:8080"},
		"https":            {"DEV", "1", "https://almanac.bg"},
		"a certificate":    {"TLS_CERT", "/etc/almanac/cert.pem", "http://localhost:8080"},
		"Cloudflare":       {"TRUST_CLOUDFLARE", "1", "http://localhost:8080"},
		"mail":             {"SMTP_URL", "smtp://u:p@mail.example:587", "http://localhost:8080"},
		"backups":          {"BACKUP_ENDPOINT", "https://r2.example", "http://localhost:8080"},
		"the server's DB":  {"DB_PATH", "/var/lib/almanac/almanac.db", "http://localhost:8080"},
		"the server's DB2": {"DB_PATH", "/var/lib/almanac/x/../almanac.db", "http://localhost:8080"},
	} {
		ok()
		t.Setenv(c.env, c.value)
		if err := seedAllowed(c.url); err == nil {
			t.Errorf("%s: seeding allowed", name)
		}
	}
	ok()
	was := version
	version = "v3.9.0"
	defer func() { version = was }()
	if err := seedAllowed("http://localhost:8080"); err == nil {
		t.Error("a release's build seeds")
	}
}
