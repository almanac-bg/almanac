package push

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const iphone = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// A fake APNs: it checks the signed claim and the headers, and answers as Apple does for the tokens it's told about.
func fakeApple(t *testing.T, pub *ecdsa.PublicKey, answers map[string]int) (*httptest.Server, *[]map[string]any) {
	t.Helper()
	var mu sync.Mutex
	var got []map[string]any
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jwt := strings.TrimPrefix(r.Header.Get("Authorization"), "bearer ")
		parts := strings.Split(jwt, ".")
		if len(parts) != 3 || r.Header.Get("apns-topic") != "bg.almanac.app" || r.Header.Get("apns-push-type") != "alert" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
		sig, _ := b64.DecodeString(parts[2])
		if len(sig) != 64 || !ecdsa.Verify(pub, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"reason":"InvalidProviderToken"}`))
			return
		}
		var claims map[string]any
		c, _ := b64.DecodeString(parts[1])
		_ = json.Unmarshal(c, &claims)
		if claims["iss"] != "TEAM123456" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		token := strings.TrimPrefix(r.URL.Path, "/3/device/")
		switch answers[token] {
		case http.StatusGone:
			w.WriteHeader(http.StatusGone)
			_, _ = w.Write([]byte(`{"reason":"Unregistered"}`))
			return
		case http.StatusBadRequest:
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"reason":"BadDeviceToken"}`))
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		got = append(got, body)
		mu.Unlock()
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func appleKey(t *testing.T) (*ecdsa.PrivateKey, []byte) {
	t.Helper()
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(k)
	return k, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}

func TestApple(t *testing.T) {
	k, p8 := appleKey(t)
	a, err := NewApple(p8, "KEY1234567", "TEAM123456", "bg.almanac.app")
	if err != nil {
		t.Fatal(err)
	}
	sandboxToken := strings.Repeat("ab", 32)
	goneToken := strings.Repeat("cd", 32)
	prod, prodGot := fakeApple(t, &k.PublicKey, map[string]int{sandboxToken: 400, goneToken: 410})
	sandbox, sandboxGot := fakeApple(t, &k.PublicKey, nil)
	a.Client, a.Hosts = prod.Client(), []string{prod.URL, sandbox.URL}

	m := Message{Title: "АЛМАНАХ", Body: "Десетте въпроса чакат.", URL: "/"}
	if err := a.Send(context.Background(), iphone, m); err != nil {
		t.Fatal(err)
	}
	if len(*prodGot) != 1 || (*prodGot)[0]["url"] != "/" {
		t.Fatalf("Apple got %v", *prodGot)
	}
	alert := (*prodGot)[0]["aps"].(map[string]any)["alert"].(map[string]any)
	if alert["title"] != "АЛМАНАХ" || alert["body"] != "Десетте въпроса чакат." {
		t.Fatalf("the alert: %v", alert)
	}
	// A build from Xcode has a sandbox token: Apple's own says it's bad, the sandbox takes it.
	if err := a.Send(context.Background(), sandboxToken, m); err != nil || len(*sandboxGot) != 1 {
		t.Fatalf("a sandbox token: %v, %d at the sandbox", err, len(*sandboxGot))
	}
	if err := a.Send(context.Background(), goneToken, m); !errors.Is(err, ErrGone) {
		t.Fatalf("an unregistered token: %v", err)
	}
	if err := a.Send(context.Background(), "not-a-token", m); !errors.Is(err, ErrGone) {
		t.Fatalf("a token that isn't one: %v", err)
	}
	// The claim is made once and kept.
	first, _ := a.token()
	if again, _ := a.token(); again != first {
		t.Fatal("a new claim for each push")
	}
}

func TestAppleKey(t *testing.T) {
	if _, err := NewApple([]byte("nonsense"), "K", "T", "bg.almanac.app"); err == nil {
		t.Fatal("not a key, taken")
	}
	_, p8 := appleKey(t)
	if _, err := NewApple(p8, "", "T", "bg.almanac.app"); err == nil {
		t.Fatal("a key without its id, taken")
	}
}

// A fake Google: its token endpoint checks the service account's signed claim; FCM checks the access token and
// answers for the tokens it's told about.
func fakeGoogle(t *testing.T, pub *rsa.PublicKey, unregistered string) (*httptest.Server, *[]map[string]any, *int) {
	t.Helper()
	var mu sync.Mutex
	var got []map[string]any
	tokens := 0
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			_ = r.ParseForm()
			parts := strings.Split(r.PostForm.Get("assertion"), ".")
			if len(parts) != 3 || r.PostForm.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
			sig, _ := b64.DecodeString(parts[2])
			if rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest[:], sig) != nil {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			mu.Lock()
			tokens++
			mu.Unlock()
			_, _ = w.Write([]byte(`{"access_token":"ya29.fake","expires_in":3599,"token_type":"Bearer"}`))
		case "/v1/projects/almanac-test/messages:send":
			if r.Header.Get("Authorization") != "Bearer ya29.fake" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["message"].(map[string]any)["token"] == unregistered {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":{"code":404,"status":"NOT_FOUND","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}`))
				return
			}
			mu.Lock()
			got = append(got, body)
			mu.Unlock()
			_, _ = w.Write([]byte(`{"name":"projects/almanac-test/messages/1"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &got, &tokens
}

func TestGoogle(t *testing.T) {
	k, _ := rsa.GenerateKey(rand.Reader, 2048)
	der, _ := x509.MarshalPKCS8PrivateKey(k)
	srv, got, tokens := fakeGoogle(t, &k.PublicKey, "gone-token-of-an-android-phone")
	creds, _ := json.Marshal(map[string]string{
		"type": "service_account", "project_id": "almanac-test", "client_email": "fcm@almanac-test.iam.gserviceaccount.com",
		"private_key": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), "token_uri": srv.URL + "/token",
	})
	g, err := NewGoogle(creds)
	if err != nil {
		t.Fatal(err)
	}
	g.Client, g.Host = srv.Client(), srv.URL

	m := Message{Title: "Дуел", Body: "Твой ред е.", URL: "/duel/12"}
	for range 2 {
		if err := g.Send(context.Background(), "token-of-an-android-phone:APA91b", m); err != nil {
			t.Fatal(err)
		}
	}
	if len(*got) != 2 || *tokens != 1 {
		t.Fatalf("%d messages with %d access tokens, want 2 with 1", len(*got), *tokens)
	}
	msg := (*got)[0]["message"].(map[string]any)
	if msg["data"].(map[string]any)["url"] != "/duel/12" || msg["notification"].(map[string]any)["title"] != "Дуел" {
		t.Fatalf("the message: %v", msg)
	}
	if err := g.Send(context.Background(), "gone-token-of-an-android-phone", m); !errors.Is(err, ErrGone) {
		t.Fatalf("an unregistered token: %v", err)
	}
	if _, err := NewGoogle([]byte(`{"project_id":"x"}`)); err == nil {
		t.Fatal("credentials without a key, taken")
	}
}

func TestPhones(t *testing.T) {
	var none *Phones
	if len(none.Platforms()) != 0 {
		t.Fatal("platforms without senders")
	}
	_, p8 := appleKey(t)
	a, _ := NewApple(p8, "K", "T", "bg.almanac.app")
	p := &Phones{Apple: a}
	if got := p.Platforms(); len(got) != 1 || got[0] != "ios" {
		t.Fatalf("platforms: %v", got)
	}
	if p.CheckPhone("ios", iphone) != nil || p.CheckPhone("ios", "x") == nil || p.CheckPhone("android", "token-of-an-android-phone") == nil {
		t.Fatal("CheckPhone")
	}
	if err := p.Send(context.Background(), "android", "token-of-an-android-phone", Message{}); !errors.Is(err, ErrGone) {
		t.Fatalf("a platform without a sender: %v", err)
	}
}
