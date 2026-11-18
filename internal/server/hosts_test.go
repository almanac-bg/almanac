package server

import (
	"net/http/httptest"
	"testing"
)

// The mail policy by its mode: kept a week while tried, a month once enforced; a mode it doesn't know refuses to start
// (a typo would serve a policy senders ignore).
func TestMTASTSModes(t *testing.T) {
	t.Parallel()
	for mode, want := range map[string]string{
		"":        "version: STSv1\r\nmode: testing\r\nmx: mail.example\r\nmx: backup.example\r\nmax_age: 604800\r\n",
		"testing": "version: STSv1\r\nmode: testing\r\nmx: mail.example\r\nmx: backup.example\r\nmax_age: 604800\r\n",
		"enforce": "version: STSv1\r\nmode: enforce\r\nmx: mail.example\r\nmx: backup.example\r\nmax_age: 2592000\r\n",
		"none":    "version: STSv1\r\nmode: none\r\nmx: mail.example\r\nmx: backup.example\r\nmax_age: 86400\r\n",
	} {
		s := &Server{cfg: Config{MTASTS: []string{"mail.example", "backup.example"}, MTASTSMode: mode}}
		w := httptest.NewRecorder()
		s.mtaSTS(w, httptest.NewRequest("GET", "https://mta-sts.almanac.bg/.well-known/mta-sts.txt", nil))
		if got := w.Body.String(); w.Code != 200 || got != want {
			t.Errorf("mode %q: %d %q, want %q", mode, w.Code, got, want)
		}
	}
	for _, mode := range []string{"enforced", "Enforce", "on"} {
		if _, err := New(Config{PublicURL: "https://almanac.bg", MTASTSMode: mode}, Deps{}); err == nil {
			t.Errorf("mode %q: started", mode)
		}
	}
}
