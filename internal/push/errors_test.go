package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// is says what kind of failure err is: "ok", "gone", "refused", "busy" (with its wait) or "ours".
func is(err error) string {
	var refused *Refused
	var busy *Busy
	switch {
	case err == nil:
		return "ok"
	case errors.Is(err, ErrGone):
		return "gone"
	case errors.As(err, &refused):
		return "refused"
	case errors.As(err, &busy):
		return "busy " + busy.After.String()
	}
	return "ours"
}

// Every way a push service can answer comes back as what to do with the browser: forget it, count it against it,
// try again later, or nothing (the game's own fault). A message's tag goes as the push's Topic.
func TestWebPushAnswers(t *testing.T) {
	pub, priv, _ := NewKeys()
	keys, _ := ParseKeys(pub, priv)
	var topic string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		topic = r.Header.Get("Topic")
		switch r.URL.Path {
		case "/ok":
			w.WriteHeader(http.StatusCreated)
		case "/gone":
			w.WriteHeader(http.StatusGone)
		case "/bad":
			w.WriteHeader(http.StatusBadRequest)
		case "/forbidden":
			w.WriteHeader(http.StatusForbidden)
		case "/slow-down":
			w.Header().Set("Retry-After", "120")
			w.WriteHeader(http.StatusTooManyRequests)
		case "/down":
			w.WriteHeader(http.StatusServiceUnavailable)
		case "/too-big":
			w.WriteHeader(http.StatusRequestEntityTooLarge)
		}
	}))
	defer srv.Close()
	browser, _ := ecdh.P256().GenerateKey(rand.Reader)
	sub := func(endpoint string) Subscription {
		s := Subscription{Endpoint: endpoint}
		s.Keys.P256dh = b64.EncodeToString(browser.PublicKey().Bytes())
		s.Keys.Auth = b64.EncodeToString([]byte("0123456789abcdef"))
		return s
	}
	s := &Sender{Keys: keys, Subject: "mailto:a@b.bg", Client: srv.Client(), Services: []string{srv.Listener.Addr().String(), ".invalid"}}
	for path, want := range map[string]string{
		"/ok": "ok", "/gone": "gone", "/bad": "refused", "/forbidden": "refused", "/slow-down": "busy 2m0s",
		"/down": "busy 0s", "/too-big": "ours",
	} {
		if got := is(s.Send(t.Context(), sub(srv.URL+path), Message{Title: "x", Tag: "n42"})); got != want {
			t.Errorf("%s: %s, want %s", path, got, want)
		}
	}
	if topic != "n42" {
		t.Fatalf("the topic: %q", topic)
	}
	// A host that doesn't exist never will; one that doesn't answer may.
	s.Client = &http.Client{Timeout: 5 * time.Second}
	if got := is(s.Send(t.Context(), sub("https://nobody.invalid/x"), Message{Title: "x"})); got != "refused" {
		t.Fatalf("a host that doesn't exist: %s", got)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Millisecond)
	defer cancel()
	time.Sleep(2 * time.Millisecond)
	s.Client = srv.Client()
	if got := is(s.Send(ctx, sub(srv.URL+"/ok"), Message{Title: "x"})); !strings.HasPrefix(got, "busy") {
		t.Fatalf("no answer in time: %s", got)
	}

	// A browser's key that isn't a point on the curve is no subscription: refused as it's told, gone if kept.
	bad := sub(srv.URL + "/ok")
	off := make([]byte, 65)
	off[0] = 4
	bad.Keys.P256dh = b64.EncodeToString(off)
	if bad.Check() == nil {
		t.Fatal("a key off the curve passed")
	}
	if got := is(s.Send(t.Context(), bad, Message{Title: "x"})); got != "gone" {
		t.Fatalf("a kept subscription with a bad key: %s", got)
	}
}
