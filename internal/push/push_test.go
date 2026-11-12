package push

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/sha256"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// RFC 8291's own example (section 5): the same keys and salt give the same body, byte for byte.
func TestTheRFCExample(t *testing.T) {
	d := func(s string) []byte {
		b, err := b64.DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	as, err := ecdh.P256().NewPrivateKey(d("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	ua, err := ecdh.P256().NewPublicKey(d("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"))
	if err != nil {
		t.Fatal(err)
	}
	body, err := seal(as, ua, d("BTBZMqHH6r4Tts7J_aSIgg"), d("DGv6ra1nlYgDCS1FRnbzlw"), []byte("When I grow up, I want to be a watermelon"))
	if err != nil {
		t.Fatal(err)
	}
	want := "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
	if got := b64.EncodeToString(body); got != want {
		t.Fatalf("body\n%s\nwant\n%s", got, want)
	}
}

// A browser's side: it decrypts what was sent to it.
func decrypt(t *testing.T, ua *ecdh.PrivateKey, auth, body []byte) []byte {
	t.Helper()
	salt, idlen := body[:16], int(body[20])
	asPub := body[21 : 21+idlen]
	as, err := ecdh.P256().NewPublicKey(asPub)
	if err != nil {
		t.Fatal(err)
	}
	shared, _ := ua.ECDH(as)
	ikm, _ := keyIKM(shared, auth, ua.PublicKey().Bytes(), asPub)
	cek, nonce, _ := cekAndNonce(ikm, salt)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, body[21+idlen:], nil)
	if err != nil {
		t.Fatal(err)
	}
	return plain[:len(plain)-1] // the record's delimiter
}

func TestSendToAPushService(t *testing.T) {
	pub, priv, err := NewKeys()
	if err != nil {
		t.Fatal(err)
	}
	keys, err := ParseKeys(pub, priv)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseKeys(pub, b64.EncodeToString(make([]byte, 31))); err == nil {
		t.Fatal("a short private key passed")
	}
	browser, _ := ecdh.P256().GenerateKey(nil)
	auth := []byte("0123456789abcdef")
	var got []byte
	var authz string
	status := http.StatusCreated
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authz = r.Header.Get("Authorization")
		got, _ = io.ReadAll(r.Body)
		if r.Header.Get("Content-Encoding") != "aes128gcm" || r.Header.Get("TTL") == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.WriteHeader(status)
	}))
	defer srv.Close()
	sub := Subscription{Endpoint: srv.URL + "/push/abc"}
	sub.Keys.P256dh = b64.EncodeToString(browser.PublicKey().Bytes())
	sub.Keys.Auth = b64.EncodeToString(auth)
	s := &Sender{Keys: keys, Subject: "mailto:privacy@almanac.bg", Client: srv.Client()}
	m := Message{Title: "АЛМАНАХ", Body: "Днешните въпроси те чакат.", URL: "/"}
	if err := s.Send(t.Context(), sub, m); err != nil {
		t.Fatal(err)
	}
	var back Message
	if err := json.Unmarshal(decrypt(t, browser, auth, got), &back); err != nil || back != m {
		t.Fatalf("the browser read %+v (%v)", back, err)
	}

	// The VAPID claim is signed by the game's key, for this push service.
	jwt, k, _ := strings.Cut(strings.TrimPrefix(authz, "vapid t="), ", k=")
	if k != pub {
		t.Fatalf("k=%s", k)
	}
	parts := strings.Split(jwt, ".")
	claims, _ := b64.DecodeString(parts[1])
	if !strings.Contains(string(claims), `"aud":"`+srv.URL+`"`) {
		t.Fatalf("claims %s", claims)
	}
	sig, _ := b64.DecodeString(parts[2])
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(&keys.private.PublicKey, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("the VAPID signature doesn't verify")
	}

	status = http.StatusGone
	if err := s.Send(t.Context(), sub, m); err != ErrGone {
		t.Fatalf("an unsubscribed browser: %v", err)
	}
	for _, bad := range []Subscription{{Endpoint: "http://insecure.example/x"}, {Endpoint: srv.URL}} {
		if bad.Check() == nil {
			t.Errorf("%+v passed", bad)
		}
	}
}
