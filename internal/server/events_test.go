package server

import (
	"bufio"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// A stream stays open over HTTP/2 through a quiet spell longer than the write deadline (it used to be reset then,
// so the Роял lobby said „Връзката прекъсна“ every few seconds).
func TestStreamOutlivesWriteDeadline(t *testing.T) {
	was := writeWait
	writeWait = 100 * time.Millisecond
	t.Cleanup(func() { writeWait = was })

	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		send := sender(w)
		for _, line := range []string{"data: 1\n\n", "data: 2\n\n"} {
			if !send(line) {
				return
			}
			select {
			case <-time.After(4 * writeWait):
			case <-r.Context().Done():
				return
			}
		}
	}))
	srv.EnableHTTP2 = true
	srv.StartTLS()
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.ProtoMajor != 2 {
		t.Fatalf("got HTTP/%d, want HTTP/2", res.ProtoMajor)
	}
	var got []string
	sc := bufio.NewScanner(res.Body)
	for sc.Scan() {
		if line := sc.Text(); line != "" {
			got = append(got, line)
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("stream broke after %q: %v", got, err)
	}
	if len(got) != 3 || got[1] != "data: 1" || got[2] != "data: 2" {
		t.Fatalf("got %q, want how long to wait, and both lines", got)
	}
	// How long the browser waits to come back, should the line drop: a while of its own, not the same for all.
	var ms int
	if _, err := fmt.Sscanf(got[0], "retry: %d", &ms); err != nil || ms < 1500 || ms >= 6000 {
		t.Fatalf("the first line: %q", got[0])
	}
}

// The networks streams are counted by: an IPv4 address, an IPv6 one's /64.
func TestNetwork(t *testing.T) {
	for addr, want := range map[string]string{
		"203.0.113.7":          "203.0.113.7",
		"2001:db8:1:2:3:4:5:6": "2001:db8:1:2::/64",
		"2001:db8:1:2:ffff::1": "2001:db8:1:2::/64",
		"::ffff:203.0.113.7":   "::ffff:203.0.113.7",
		"not an address":       "not an address",
	} {
		if got := network(addr); got != want {
			t.Errorf("network(%q) = %q, want %q", addr, got, want)
		}
	}
}
