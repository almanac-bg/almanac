package server

import (
	"fmt"
	"net/http/httptest"
	"testing"
	"time"
)

func addressServer(trust bool) *Server {
	return &Server{cfg: Config{TrustCloudflare: trust}, limits: newLimiter(), problems: newProblems()}
}

// CF-Connecting-IP is taken only from Cloudflare's own addresses; from anywhere else the connection's address is
// the player's, and the server hears of it.
func TestClientAddress(t *testing.T) {
	for _, c := range []struct {
		trust          bool
		peer, header   string
		want, net, ste string
		spoofed        bool
	}{
		{false, "162.158.1.2:443", "198.51.100.7", "162.158.1.2", "162.158.1.2", "", false},
		{true, "162.158.1.2:443", "198.51.100.7", "198.51.100.7", "198.51.100.7", "", false},
		{true, "[2a06:98c1::5]:443", "2001:db8:1:2:3:4:5:6", "2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64", "2001:db8:1::/48", false},
		{true, "203.0.113.9:5000", "198.51.100.7", "203.0.113.9", "203.0.113.9", "", true},
		{true, "162.158.1.2:443", "not an address", "162.158.1.2", "162.158.1.2", "", false},
		{true, "[::ffff:198.51.100.7]:5000", "", "198.51.100.7", "198.51.100.7", "", false},
		{true, "[2001:db8::1]:5000", "", "2001:db8::1", "2001:db8::/64", "2001:db8::/48", false},
	} {
		s := addressServer(c.trust)
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = c.peer
		if c.header != "" {
			r.Header.Set("CF-Connecting-IP", c.header)
		}
		if got := s.clientIP(r); got != c.want {
			t.Errorf("%s with %q: %s, want %s", c.peer, c.header, got, c.want)
		}
		if got := s.clientNet(r); got != c.net {
			t.Errorf("%s with %q: network %s, want %s", c.peer, c.header, got, c.net)
		}
		if got := s.clientSite(r); got != c.ste {
			t.Errorf("%s with %q: site %q, want %q", c.peer, c.header, got, c.ste)
		}
		news, _ := s.problems.take()
		if _, ok := news[spoofed]; ok != c.spoofed {
			t.Errorf("%s with %q: told of a forged address: %v", c.peer, c.header, ok)
		}
	}
}

// Addresses of one /64 are one network to a limit; /64s of one /48 are one site to its wider limit. IPv4 addresses
// are each their own.
func TestLimitsByNetwork(t *testing.T) {
	s := addressServer(true)
	from := func(addr string) bool {
		r := httptest.NewRequest("POST", "/api/guest", nil)
		r.RemoteAddr = "[2606:4700::1]:443"
		r.Header.Set("CF-Connecting-IP", addr)
		return s.allowFrom(r, "guest", 3, 5, time.Hour)
	}
	for i := range 3 {
		if !from(fmt.Sprintf("2001:db8:0:1::%x", i+1)) {
			t.Fatalf("address %d of a /64 refused", i+1)
		}
	}
	if from("2001:db8:0:1::ffff") {
		t.Fatal("a fourth address of the same /64 was let through")
	}
	if !from("2001:db8:0:2::1") || !from("2001:db8:0:3::1") {
		t.Fatal("another /64 of the /48 refused")
	}
	if from("2001:db8:0:4::1") {
		t.Fatal("past the /48's limit, a new /64 was let through")
	}
	if !from("2001:db8:1:1::1") {
		t.Fatal("another /48 refused")
	}
	for i := range 4 {
		if !from(fmt.Sprintf("198.51.100.%d", i+1)) {
			t.Fatalf("IPv4 address %d refused", i+1)
		}
	}
}
