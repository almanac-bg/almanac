// Package push sends notifications to players' browsers (Web Push): a message encrypted for the browser that asked
// for it (RFC 8291, aes128gcm), sent to its push service with the game's signed name (VAPID, RFC 8292). Only the
// push services browsers use are posted to (Services), never a redirect: a subscription is whatever a player sends.
// Standard library only.
package push

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var b64 = base64.RawURLEncoding

// Keys are the game's VAPID key pair: the public one goes to browsers when they subscribe; the private one signs.
type Keys struct {
	Public  string // base64url, the uncompressed point (65 bytes)
	private *ecdsa.PrivateKey
}

// NewKeys makes a key pair, as `almanac push keys` prints it: public, then private (base64url).
func NewKeys() (public, private string, err error) {
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}
	ek, err := k.ECDH()
	if err != nil {
		return "", "", err
	}
	priv := make([]byte, 32)
	k.D.FillBytes(priv)
	return b64.EncodeToString(ek.PublicKey().Bytes()), b64.EncodeToString(priv), nil
}

// ParseKeys reads a key pair from its two base64url halves.
func ParseKeys(public, private string) (*Keys, error) {
	d, err := b64.DecodeString(private)
	if err != nil || len(d) != 32 {
		return nil, errors.New("PUSH_PRIVATE_KEY must be 32 bytes, base64url")
	}
	k, err := ecdh.P256().NewPrivateKey(d)
	if err != nil {
		return nil, err
	}
	if b64.EncodeToString(k.PublicKey().Bytes()) != public {
		return nil, errors.New("PUSH_PUBLIC_KEY isn't PUSH_PRIVATE_KEY's")
	}
	pub := k.PublicKey().Bytes()
	priv := &ecdsa.PrivateKey{
		PublicKey: ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(pub[1:33]), Y: new(big.Int).SetBytes(pub[33:])},
		D:         new(big.Int).SetBytes(d),
	}
	return &Keys{Public: public, private: priv}, nil
}

// Subscription is where a browser receives pushes, and its keys (as PushSubscription.toJSON() gives them).
type Subscription struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// Check says whether a subscription is one a push service gave (an https endpoint, keys of the right size).
func (s Subscription) Check() error {
	u, err := url.Parse(s.Endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || len(s.Endpoint) > 2000 {
		return errors.New("not a push endpoint")
	}
	if p, err := b64.DecodeString(s.Keys.P256dh); err != nil || len(p) != 65 {
		return errors.New("bad p256dh")
	}
	if a, err := b64.DecodeString(s.Keys.Auth); err != nil || len(a) != 16 {
		return errors.New("bad auth")
	}
	return nil
}

// Message is what a notification shows, and where tapping it goes.
type Message struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
}

// ErrGone means the browser unsubscribed (or the subscription expired): forget it.
var ErrGone = errors.New("the subscription is gone")

// ErrNotService means an endpoint isn't at a push service the game knows: it's never posted to, since anyone can
// send any address as their subscription.
var ErrNotService = errors.New("not a known push service")

// Services are the push services browsers subscribe with (Chrome and its kin, Firefox, Safari, Edge): a host as it
// is, or, starting with a dot, any host under that domain. Nothing else is posted to.
var Services = []string{
	"fcm.googleapis.com", "android.googleapis.com",
	"updates.push.services.mozilla.com", ".push.services.mozilla.com",
	"web.push.apple.com", ".push.apple.com",
	".notify.windows.com",
}

// Sender sends pushes.
type Sender struct {
	Keys *Keys
	// Subject is how a push service can reach whoever runs the game (mailto:…).
	Subject string
	Client  *http.Client
	// Services, when set, replaces the push services the game posts to (the tests' own).
	Services []string
}

// Check says whether a subscription is one a push service gave, at a push service the game posts to.
func (s *Sender) Check(sub Subscription) error {
	if err := sub.Check(); err != nil {
		return err
	}
	u, _ := url.Parse(sub.Endpoint)
	host := strings.ToLower(u.Host) // with the port, if one is given: a known service is at the default one
	services := s.Services
	if services == nil {
		services = Services
	}
	for _, known := range services {
		if host == known || (strings.HasPrefix(known, ".") && strings.HasSuffix(host, known)) {
			return nil
		}
	}
	return ErrNotService
}

// Send encrypts m for a subscription and posts it to its push service. A subscription that isn't at a known push
// service is ErrGone, to be forgotten.
func (s *Sender) Send(ctx context.Context, sub Subscription, m Message) error {
	if err := s.Check(sub); errors.Is(err, ErrNotService) {
		return ErrGone
	}
	payload, _ := json.Marshal(m)
	body, err := encrypt(sub, payload)
	if err != nil {
		return err
	}
	u, err := url.Parse(sub.Endpoint)
	if err != nil {
		return err
	}
	jwt, err := s.vapid(u.Scheme + "://" + u.Host)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("TTL", "43200") // half a day: an old reminder is no use
	req.Header.Set("Urgency", "normal")
	req.Header.Set("Authorization", "vapid t="+jwt+", k="+s.Keys.Public)
	client := http.Client{Timeout: 15 * time.Second}
	if s.Client != nil {
		client = *s.Client
	}
	// A push service answers; it doesn't send the post on elsewhere.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	switch {
	case res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusGone:
		return ErrGone
	case res.StatusCode/100 != 2:
		return fmt.Errorf("push service: %s", res.Status)
	}
	return nil
}

// vapid is the signed claim of who sends (ES256 JWT), for one push service, valid 12 hours.
func (s *Sender) vapid(audience string) (string, error) {
	header := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, _ := json.Marshal(map[string]any{"aud": audience, "exp": time.Now().Add(12 * time.Hour).Unix(), "sub": s.Subject})
	signing := header + "." + b64.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signing))
	r, sig, err := ecdsa.Sign(rand.Reader, s.Keys.private, digest[:])
	if err != nil {
		return "", err
	}
	raw := make([]byte, 64)
	r.FillBytes(raw[:32])
	sig.FillBytes(raw[32:])
	return signing + "." + b64.EncodeToString(raw), nil
}

// recordSize is the record size the body says (one record holds the whole message).
const recordSize = 4096

// encrypt makes a push's body for a subscription (RFC 8291 over RFC 8188's aes128gcm).
func encrypt(sub Subscription, payload []byte) ([]byte, error) {
	if err := sub.Check(); err != nil {
		return nil, err
	}
	uaPub, _ := b64.DecodeString(sub.Keys.P256dh)
	auth, _ := b64.DecodeString(sub.Keys.Auth)
	ua, err := ecdh.P256().NewPublicKey(uaPub)
	if err != nil {
		return nil, err
	}
	as, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	return seal(as, ua, auth, salt, payload)
}

func seal(as *ecdh.PrivateKey, ua *ecdh.PublicKey, auth, salt, payload []byte) ([]byte, error) {
	if len(payload)+1+16 > recordSize-86 {
		return nil, errors.New("too long for one push")
	}
	shared, err := as.ECDH(ua)
	if err != nil {
		return nil, err
	}
	asPub := as.PublicKey().Bytes()
	ikm, err := keyIKM(shared, auth, ua.Bytes(), asPub)
	if err != nil {
		return nil, err
	}
	cek, nonce, err := cekAndNonce(ikm, salt)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	header := make([]byte, 0, 86)
	header = append(header, salt...)
	header = binary.BigEndian.AppendUint32(header, recordSize)
	header = append(header, byte(len(asPub)))
	header = append(header, asPub...)
	plain := append(append([]byte{}, payload...), 0x02) // the last (and only) record's delimiter
	return gcm.Seal(header, nonce, plain, nil), nil
}

// keyIKM mixes the shared secret with the browser's auth secret and both public keys (RFC 8291, 3.4).
func keyIKM(shared, auth, uaPub, asPub []byte) ([]byte, error) {
	prk, err := hkdf.Extract(sha256.New, shared, auth)
	if err != nil {
		return nil, err
	}
	info := "WebPush: info\x00" + string(uaPub) + string(asPub)
	return hkdf.Expand(sha256.New, prk, info, 32)
}

// cekAndNonce derive the content key and nonce from the input keying material and salt (RFC 8188, 2.2–2.3).
func cekAndNonce(ikm, salt []byte) (cek, nonce []byte, err error) {
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, nil, err
	}
	if cek, err = hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16); err != nil {
		return nil, nil, err
	}
	nonce, err = hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	return cek, nonce, err
}
