package main

import (
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/server"
)

// A server without alerts, backups or their heartbeat says so as it starts; one with them all says nothing.
func TestUnconfigured(t *testing.T) {
	if got := unconfigured(server.Alerts{Email: "a@b.bg"}, true, true); len(got) != 0 {
		t.Fatalf("all set: %v", got)
	}
	got := strings.Join(unconfigured(server.Alerts{}, false, false), "\n")
	if !strings.Contains(got, "ALERT_EMAIL") || !strings.Contains(got, "BACKUP_ENDPOINT") || strings.Contains(got, "HEARTBEAT") {
		t.Fatalf("none set: %v", got)
	}
	if got := unconfigured(server.Alerts{Email: "a@b.bg"}, true, false); len(got) != 1 || !strings.Contains(got[0], "BACKUP_HEARTBEAT") {
		t.Fatalf("no heartbeat: %v", got)
	}
}
