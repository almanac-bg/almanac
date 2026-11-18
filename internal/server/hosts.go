package server

import (
	"net"
	"net/http"
	"strconv"
	"strings"
)

// hosts answers by the name a request was sent to: the game's own (PUBLIC_URL), www (sent there for good), the mail
// policy's (MTA-STS), and nothing else — the game never answers as some other site.
func (s *Server) hosts(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		host = strings.ToLower(host)
		switch {
		case host == s.host || s.cfg.Dev:
			next.ServeHTTP(w, r)
		case host == "www."+s.host:
			http.Redirect(w, r, s.cfg.PublicURL+r.URL.RequestURI(), http.StatusMovedPermanently)
		case host == "mta-sts."+s.host && len(s.cfg.MTASTS) > 0:
			s.mtaSTS(w, r)
		default:
			http.Error(w, "Not Found", http.StatusNotFound)
		}
	})
}

// mtaSTSMaxAge is how long senders keep the policy, in seconds, by its mode (Config.MTASTSMode takes no other): a
// week while it is only tried (testing: senders report what fails, and deliver all the same), a month once enforced (a
// policy a sender keeps can't be stripped on the way; RFC 8461 asks for weeks or more), a day for none (taking it
// away). A changed policy reaches senders once the _mta-sts TXT record's id changes, not before.
var mtaSTSMaxAge = map[string]int{"testing": 604800, "enforce": 2592000, "none": 86400}

// mtaSTS is the domain's mail policy (RFC 8461): mail to its addresses only over TLS, only to these servers.
func (s *Server) mtaSTS(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/.well-known/mta-sts.txt" {
		http.NotFound(w, r)
		return
	}
	mode := s.cfg.MTASTSMode
	if mode == "" {
		mode = "testing"
	}
	age := mtaSTSMaxAge[mode]
	var b strings.Builder
	b.WriteString("version: STSv1\r\nmode: " + mode + "\r\n")
	for _, mx := range s.cfg.MTASTS {
		b.WriteString("mx: " + mx + "\r\n")
	}
	b.WriteString("max_age: " + strconv.Itoa(age) + "\r\n")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write([]byte(b.String()))
}
