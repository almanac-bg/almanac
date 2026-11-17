package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
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

// Apple's and Google's answers, the same way; FCM forgets a token only when it names the token as what's wrong.
func TestPhoneAnswers(t *testing.T) {
	_, p8 := appleKey(t)
	a, _ := NewApple(p8, "KEY1234567", "TEAM123456", "bg.almanac.app")
	var collapse string
	apns := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		collapse = r.Header.Get("apns-collapse-id")
		switch strings.TrimPrefix(r.URL.Path, "/3/device/")[:2] {
		case "aa":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"reason":"DeviceTokenNotForTopic"}`))
		case "bb":
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"reason":"TooManyRequests"}`))
		case "cc":
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"reason":"InvalidProviderToken"}`))
		}
	}))
	defer apns.Close()
	a.Client, a.Hosts = apns.Client(), []string{apns.URL}
	for token, want := range map[string]string{"aa": "refused", "bb": "busy 0s", "cc": "ours", "dd": "ok"} {
		if got := is(a.Send(t.Context(), strings.Repeat(token, 32), Message{Title: "x", Tag: "n7"})); got != want {
			t.Errorf("apns %s: %s, want %s", token, got, want)
		}
	}
	if collapse != "n7" {
		t.Fatalf("the collapse id: %q", collapse)
	}

	k, _ := rsa.GenerateKey(rand.Reader, 2048)
	der, _ := x509.MarshalPKCS8PrivateKey(k)
	var android map[string]any
	fcm := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			_, _ = w.Write([]byte(`{"access_token":"ya29.fake","expires_in":3599}`))
			return
		}
		var body struct {
			Message map[string]any `json:"message"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		android, _ = body.Message["android"].(map[string]any)
		switch token, _ := body.Message["token"].(string); token[:4] {
		case "tokn":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"code":400,"status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"field":"message.token","description":"Invalid registration token"}]}]}}`))
		case "body":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"code":400,"status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"field":"message.android.ttl"}]}]}}`))
		case "send":
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":{"code":403,"status":"PERMISSION_DENIED","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"SENDER_ID_MISMATCH"}]}}`))
		case "busy":
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":{"code":503,"status":"UNAVAILABLE"}}`))
		}
	}))
	defer fcm.Close()
	creds, _ := json.Marshal(map[string]string{"project_id": "p", "client_email": "fcm@p.iam.gserviceaccount.com",
		"private_key": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), "token_uri": fcm.URL + "/token"})
	g, err := NewGoogle(creds)
	if err != nil {
		t.Fatal(err)
	}
	g.Client, g.Host = fcm.Client(), fcm.URL
	for token, want := range map[string]string{
		"tokn": "gone", "body": "ours", "send": "refused", "busy": "busy 30s", "good": "ok",
	} {
		if got := is(g.Send(t.Context(), token+"-of-an-android-phone", Message{Title: "x", Tag: "n8"})); got != want {
			t.Errorf("fcm %s: %s, want %s", token, got, want)
		}
	}
	if android["collapse_key"] != "n8" || android["notification"].(map[string]any)["tag"] != "n8" {
		t.Fatalf("the tag: %v", android)
	}
}
