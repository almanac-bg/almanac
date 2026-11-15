package push

// The game's own app (mobile/) gets its notifications from the phone's maker, not as Web Push: an iPhone through
// Apple's push service (APNs: a request over HTTP/2 with a token signed by the team's key), an Android phone through
// Firebase Cloud Messaging (HTTP v1: an OAuth token for a service account, from Google). The app gives the player's
// device token to the game, which keeps it like a browser's subscription.

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Phones sends notifications to the app, on each platform it has a sender for (nil: none there).
type Phones struct {
	Apple  *Apple
	Google *Google
}

// Platforms are the platforms the game can notify, as the app names them.
func (p *Phones) Platforms() []string {
	var out []string
	if p != nil && p.Apple != nil {
		out = append(out, "ios")
	}
	if p != nil && p.Google != nil {
		out = append(out, "android")
	}
	return out
}

var (
	appleToken  = regexp.MustCompile(`^[0-9a-f]{64,200}$`)
	googleToken = regexp.MustCompile(`^[A-Za-z0-9_:\-]{20,1000}$`) // FCM's are about 160
)

// PhoneToken is a phone's token as the game keeps it: an iPhone's in lower case (Capacitor's plugin gives it in upper
// case, Apple takes either), so that one phone is one row.
func PhoneToken(platform, token string) string {
	if platform == "ios" {
		return strings.ToLower(token)
	}
	return token
}

// CheckPhone says whether a token (as PhoneToken keeps it) is one the platform could have given, on a platform the
// game can notify.
func (p *Phones) CheckPhone(platform, token string) error {
	switch {
	case platform == "ios" && p.Apple != nil && appleToken.MatchString(token):
		return nil
	case platform == "android" && p.Google != nil && googleToken.MatchString(token):
		return nil
	}
	return errors.New("not a device token")
}

// Send sends m to a phone. A token its platform no longer knows is ErrGone, to be forgotten.
func (p *Phones) Send(ctx context.Context, platform, token string, m Message) error {
	switch {
	case platform == "ios" && p.Apple != nil:
		return p.Apple.Send(ctx, token, m)
	case platform == "android" && p.Google != nil:
		return p.Google.Send(ctx, token, m)
	}
	return ErrGone
}

func client(c *http.Client) *http.Client {
	out := http.Client{Timeout: 15 * time.Second}
	if c != nil {
		out = *c
	}
	out.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &out
}

// Apple sends to iPhones through APNs.
type Apple struct {
	teamID, keyID, topic string
	key                  *ecdsa.PrivateKey
	Client               *http.Client
	// Hosts are where pushes go, in turn: Apple's own, then its sandbox (a build from Xcode has a sandbox token,
	// which the first answers is bad). The tests set their own.
	Hosts []string

	mu   sync.Mutex
	jwt  string
	made time.Time
}

// NewApple reads the team's APNs key (the .p8 file Apple gives, with its key id) for the app (topic: its bundle id).
func NewApple(p8 []byte, keyID, teamID, topic string) (*Apple, error) {
	block, _ := pem.Decode(p8)
	if block == nil {
		return nil, errors.New("APNS_KEY_FILE isn't a .p8 key")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("APNS_KEY_FILE: %w", err)
	}
	ec, ok := k.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("APNS_KEY_FILE isn't an EC key")
	}
	if keyID == "" || teamID == "" || topic == "" {
		return nil, errors.New("APNs needs APNS_KEY_ID and APNS_TEAM_ID")
	}
	return &Apple{teamID: teamID, keyID: keyID, topic: topic, key: ec,
		Hosts: []string{"https://api.push.apple.com", "https://api.sandbox.push.apple.com"}}, nil
}

// token is the signed claim of who sends: Apple takes one for up to an hour and wants it renewed no more often than
// every 20 minutes, so it's made again after 40.
func (a *Apple) token() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.jwt != "" && time.Since(a.made) < 40*time.Minute {
		return a.jwt, nil
	}
	header, _ := json.Marshal(map[string]string{"alg": "ES256", "kid": a.keyID})
	claims, _ := json.Marshal(map[string]any{"iss": a.teamID, "iat": time.Now().Unix()})
	signing := b64.EncodeToString(header) + "." + b64.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, a.key, digest[:])
	if err != nil {
		return "", err
	}
	raw := make([]byte, 64)
	r.FillBytes(raw[:32])
	s.FillBytes(raw[32:])
	a.jwt, a.made = signing+"."+b64.EncodeToString(raw), time.Now()
	return a.jwt, nil
}

func (a *Apple) forget() {
	a.mu.Lock()
	a.jwt = ""
	a.mu.Unlock()
}

// Send posts m to an iPhone's token.
func (a *Apple) Send(ctx context.Context, token string, m Message) error {
	if !appleToken.MatchString(token) {
		return ErrGone
	}
	payload, _ := json.Marshal(map[string]any{
		"aps": map[string]any{"alert": map[string]string{"title": m.Title, "body": m.Body}, "sound": "default"},
		"url": m.URL, "kind": m.Kind,
	})
	jwt, err := a.token()
	if err != nil {
		return err
	}
	for _, host := range a.Hosts {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, host+"/3/device/"+token, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "bearer "+jwt)
		req.Header.Set("apns-topic", a.topic)
		req.Header.Set("apns-push-type", "alert")
		req.Header.Set("apns-priority", "10")
		req.Header.Set("apns-expiration", fmt.Sprint(time.Now().Add(12*time.Hour).Unix())) // an old reminder is no use
		res, err := client(a.Client).Do(req)
		if err != nil {
			return err
		}
		var answer struct {
			Reason string `json:"reason"`
		}
		_ = json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&answer)
		res.Body.Close()
		switch {
		case res.StatusCode == http.StatusOK:
			return nil
		case res.StatusCode == http.StatusGone:
			return ErrGone
		case answer.Reason == "BadDeviceToken":
			continue // a token of the other environment: try the next host
		case answer.Reason == "ExpiredProviderToken" || answer.Reason == "InvalidProviderToken":
			a.forget()
		}
		return fmt.Errorf("apns: %s %s", res.Status, answer.Reason)
	}
	return ErrGone // bad on every host
}

// Google sends to Android phones through Firebase Cloud Messaging.
type Google struct {
	project, email, tokenURI string
	key                      *rsa.PrivateKey
	Client                   *http.Client
	// Host is FCM's (the tests set their own).
	Host string

	mu     sync.Mutex
	access string
	until  time.Time
}

// NewGoogle reads a Firebase service account's key (the JSON file Firebase gives).
func NewGoogle(credentials []byte) (*Google, error) {
	var c struct {
		Project  string `json:"project_id"`
		Email    string `json:"client_email"`
		Key      string `json:"private_key"`
		TokenURI string `json:"token_uri"`
	}
	if err := json.Unmarshal(credentials, &c); err != nil {
		return nil, fmt.Errorf("FCM_CREDENTIALS_FILE: %w", err)
	}
	block, _ := pem.Decode([]byte(c.Key))
	if block == nil || c.Project == "" || c.Email == "" {
		return nil, errors.New("FCM_CREDENTIALS_FILE isn't a service account's key")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("FCM_CREDENTIALS_FILE: %w", err)
	}
	rk, ok := k.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("FCM_CREDENTIALS_FILE: not an RSA key")
	}
	if c.TokenURI == "" {
		c.TokenURI = "https://oauth2.googleapis.com/token"
	}
	return &Google{project: c.Project, email: c.Email, tokenURI: c.TokenURI, key: rk, Host: "https://fcm.googleapis.com"}, nil
}

// token is an access token for FCM, asked of Google with a claim signed by the service account (kept until a few
// minutes before it expires).
func (g *Google) token(ctx context.Context) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.access != "" && time.Now().Before(g.until) {
		return g.access, nil
	}
	now := time.Now()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT"})
	claims, _ := json.Marshal(map[string]any{
		"iss": g.email, "scope": "https://www.googleapis.com/auth/firebase.messaging",
		"aud": g.tokenURI, "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
	})
	signing := b64.EncodeToString(header) + "." + b64.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, g.key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {signing + "." + b64.EncodeToString(sig)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.tokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := client(g.Client).Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var out struct {
		Token   string `json:"access_token"`
		Expires int    `json:"expires_in"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<16)).Decode(&out); err != nil || res.StatusCode != http.StatusOK || out.Token == "" {
		return "", fmt.Errorf("fcm token: %s", res.Status)
	}
	g.access, g.until = out.Token, now.Add(time.Duration(out.Expires)*time.Second-5*time.Minute)
	return g.access, nil
}

// Send posts m to an Android phone's token.
func (g *Google) Send(ctx context.Context, token string, m Message) error {
	if !googleToken.MatchString(token) {
		return ErrGone
	}
	access, err := g.token(ctx)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]any{"message": map[string]any{
		"token":        token,
		"notification": map[string]string{"title": m.Title, "body": m.Body},
		"data":         map[string]string{"url": m.URL, "kind": m.Kind},
		"android":      map[string]any{"priority": "HIGH", "ttl": "43200s"},
	}})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.Host+"/v1/projects/"+g.project+"/messages:send", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Content-Type", "application/json")
	res, err := client(g.Client).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var answer struct {
		Error struct {
			Status  string `json:"status"`
			Details []struct {
				ErrorCode string `json:"errorCode"`
			} `json:"details"`
		} `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(res.Body, 1<<16)).Decode(&answer)
	if res.StatusCode == http.StatusOK {
		return nil
	}
	code := answer.Error.Status
	for _, d := range answer.Error.Details {
		if d.ErrorCode != "" {
			code = d.ErrorCode
		}
	}
	switch {
	case code == "UNREGISTERED" || res.StatusCode == http.StatusNotFound:
		return ErrGone
	case code == "INVALID_ARGUMENT" && res.StatusCode == http.StatusBadRequest:
		return ErrGone // the token is all a message here could get wrong
	case res.StatusCode == http.StatusUnauthorized:
		g.mu.Lock()
		g.access = ""
		g.mu.Unlock()
	}
	return fmt.Errorf("fcm: %s %s", res.Status, code)
}
