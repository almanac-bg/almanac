package server

import (
	"bufio"
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
	if len(got) != 2 {
		t.Fatalf("got %q, want both lines", got)
	}
}
